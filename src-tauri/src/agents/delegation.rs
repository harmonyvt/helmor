use std::path::Path;
use std::sync::mpsc::RecvTimeoutError;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use crate::models::delegations::{self, CreateDelegationInput, DelegationRecord};
use crate::pipeline::PipelineEmit;
use crate::ui_sync::{self, UiMutationEvent};

use super::persistence::{
    finalize_session_metadata, persist_error_message, persist_result_and_finalize,
    persist_turn_message, persist_user_message,
};
use super::streaming::{build_send_message_params, BuildSendMessageParamsInput};
use super::{resolve_model, ExchangeContext};

const CHILD_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegateAgentRequest {
    pub parent_session_id: String,
    pub task: String,
    pub provider: String,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub effort_level: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub output_schema: Value,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub parent_provider: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegateAgentResponse {
    pub delegation: DelegationRecord,
    pub child_session_id: String,
    pub result: Value,
}

pub(crate) fn delegate_agent_blocking(
    app: AppHandle,
    sidecar: &crate::sidecar::ManagedSidecar,
    request: DelegateAgentRequest,
) -> Result<DelegateAgentResponse> {
    let task = request.task.trim();
    if task.is_empty() {
        bail!("delegate_agent task cannot be empty");
    }
    if !request.output_schema.is_object() {
        bail!("delegate_agent outputSchema must be a JSON object schema");
    }

    let model_id = request
        .model_id
        .clone()
        .unwrap_or_else(|| default_model_id_for_provider(&request.provider));
    let model = resolve_model(&model_id);
    if model.provider != request.provider {
        bail!(
            "Model {} does not belong to provider {}",
            model_id,
            request.provider
        );
    }

    if request.parent_provider.as_deref() == Some(model.provider.as_str()) {
        bail!("delegate_agent cannot delegate to the same provider in this version");
    }

    let created = delegations::create_delegation_anchor(CreateDelegationInput {
        parent_session_id: request.parent_session_id.clone(),
        provider: model.provider.clone(),
        model_id: Some(model.id.clone()),
        title: request.title.clone(),
        output_schema: request.output_schema.clone(),
    })?;
    publish_delegation_updates(
        &app,
        &created.workspace_id,
        &created.parent_session_id,
        &created.child_session_id,
    );

    let working_directory = resolve_session_working_directory(&created.child_session_id)?;
    let timeout = request
        .timeout_ms
        .map(Duration::from_millis)
        .unwrap_or_else(|| Duration::from_secs(30 * 60));
    let schema_text = serde_json::to_string_pretty(&request.output_schema)?;
    let prompt = format!(
        "{task}\n\nReturn only JSON that validates against this JSON Schema. Do not wrap it in Markdown.\n\nJSON Schema:\n{schema_text}"
    );

    let first = run_child_turn(
        &app,
        sidecar,
        &created,
        &model,
        &prompt,
        &working_directory,
        request.effort_level.as_deref(),
        request.permission_mode.as_deref(),
        timeout,
        None,
    );

    let mut final_output = match first {
        Ok(output) => output,
        Err(error) => {
            let record = delegations::update_delegation_status(
                &created.id,
                status_for_error(&error),
                None,
                Some(&error.to_string()),
            )?;
            publish_delegation_updates(
                &app,
                &created.workspace_id,
                &created.parent_session_id,
                &created.child_session_id,
            );
            return Err(error).with_context(|| format!("Delegation {} failed", record.id));
        }
    };

    let parsed = parse_structured_json(&final_output.assistant_text).or_else(|_| {
        let repair_prompt = format!(
            "Your previous response was not valid JSON for the required schema. Return only repaired JSON, no Markdown.\n\nSchema:\n{schema_text}\n\nPrevious response:\n{}",
            final_output.assistant_text
        );
        final_output = run_child_turn(
            &app,
            sidecar,
            &created,
            &model,
            &repair_prompt,
            &working_directory,
            request.effort_level.as_deref(),
            request.permission_mode.as_deref(),
            timeout,
            final_output.provider_session_id.as_deref(),
        )?;
        parse_structured_json(&final_output.assistant_text)
    });

    let result = match parsed {
        Ok(value) => value,
        Err(error) => {
            let record = delegations::update_delegation_status(
                &created.id,
                "failed",
                None,
                Some(&format!("Invalid structured JSON: {error}")),
            )?;
            publish_delegation_updates(
                &app,
                &created.workspace_id,
                &created.parent_session_id,
                &created.child_session_id,
            );
            return Err(anyhow::anyhow!(
                "Delegation {} returned invalid JSON",
                record.id
            ));
        }
    };

    let delegation =
        delegations::update_delegation_status(&created.id, "succeeded", Some(&result), None)?;
    restore_parent_active_if_child_selected(
        &created.workspace_id,
        &created.parent_session_id,
        &created.child_session_id,
    );
    publish_delegation_updates(
        &app,
        &created.workspace_id,
        &created.parent_session_id,
        &created.child_session_id,
    );

    Ok(DelegateAgentResponse {
        child_session_id: created.child_session_id,
        delegation,
        result,
    })
}

#[derive(Debug)]
struct ChildTurnOutput {
    assistant_text: String,
    provider_session_id: Option<String>,
}

#[allow(clippy::too_many_arguments)]
fn run_child_turn(
    app: &AppHandle,
    sidecar: &crate::sidecar::ManagedSidecar,
    created: &delegations::CreatedDelegation,
    model: &super::ResolvedModel,
    prompt: &str,
    working_directory: &Path,
    effort_level: Option<&str>,
    permission_mode: Option<&str>,
    timeout: Duration,
    resume_session_id: Option<&str>,
) -> Result<ChildTurnOutput> {
    let request_id = Uuid::new_v4().to_string();
    let params = build_send_message_params(BuildSendMessageParamsInput {
        sidecar_session_id: &created.child_session_id,
        prompt,
        cli_model: &model.cli_model,
        cwd: &working_directory.display().to_string(),
        resume_session_id,
        provider: &model.provider,
        effort_level,
        permission_mode,
        fast_mode: false,
        helmor_session_id: Some(&created.child_session_id),
        claude_base_url: model.claude_base_url.as_deref(),
        claude_auth_token: model.claude_auth_token.as_deref(),
        images: &[],
        kanban_workspace_id: None,
        kanban_snapshot: None,
        goal_title: None,
        goal_description: None,
    });
    let request = crate::sidecar::SidecarRequest {
        id: request_id.clone(),
        method: "sendMessage".to_string(),
        params,
    };
    let rx = sidecar.subscribe(&request_id);
    sidecar.send(&request)?;

    let ctx = ExchangeContext {
        helmor_session_id: created.child_session_id.clone(),
        model_id: model.id.clone(),
        model_provider: model.provider.clone(),
        user_message_id: Uuid::new_v4().to_string(),
    };
    {
        let conn = crate::models::db::write_conn()?;
        persist_user_message(&conn, &ctx, prompt, &[], &[])?;
    }

    let mut pipeline = crate::pipeline::MessagePipeline::new(
        &model.provider,
        &model.cli_model,
        &request_id,
        &created.child_session_id,
    );
    let mut persisted_turn_count = 0usize;
    let started = Instant::now();
    let mut resolved_session_id = resume_session_id.map(str::to_string);

    loop {
        if started.elapsed() > timeout {
            let _ = stop_sidecar_session(sidecar, &created.child_session_id, &model.provider);
            finalize_child_error(&ctx, model, "Delegation timed out")?;
            return Err(anyhow::anyhow!("Delegation timed out"));
        }
        let remaining = timeout.saturating_sub(started.elapsed());
        let wait_for = remaining.min(CHILD_HEARTBEAT_TIMEOUT);
        let event = match rx.recv_timeout(wait_for) {
            Ok(event) => event,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                finalize_child_error(&ctx, model, "Sidecar disconnected during delegation")?;
                return Err(anyhow::anyhow!("Sidecar disconnected during delegation"));
            }
        };

        if let Some(session_id) = event.session_id() {
            resolved_session_id = Some(session_id.to_string());
            if let Ok(conn) = crate::models::db::write_conn() {
                let _ = conn.execute(
                    "UPDATE sessions SET provider_session_id = ?2, agent_type = ?3 WHERE id = ?1",
                    params![&created.child_session_id, session_id, &model.provider],
                );
            }
        }

        match event.event_type() {
            "heartbeat" => continue,
            "end" | "aborted" => {
                let is_aborted = event.event_type() == "aborted";
                if is_aborted {
                    pipeline.accumulator.mark_pending_tools_aborted();
                    pipeline.accumulator.flush_codex_in_progress();
                    pipeline.materialize_partial();
                    pipeline.accumulator.append_aborted_notice();
                }
                pipeline.accumulator.flush_pending();
                persist_pending_turns(&mut pipeline, &ctx, &mut persisted_turn_count)?;
                let output = pipeline
                    .accumulator
                    .drain_output(resolved_session_id.as_deref());
                let assistant_text = output.assistant_text.clone();
                let conn = crate::models::db::write_conn()?;
                if is_aborted {
                    finalize_session_metadata(
                        &conn,
                        &ctx,
                        "aborted",
                        effort_level,
                        permission_mode,
                    )?;
                    return Err(anyhow::anyhow!("Delegation was cancelled"));
                }
                persist_result_and_finalize(
                    &conn,
                    &ctx,
                    &output.resolved_model,
                    &output.assistant_text,
                    effort_level,
                    permission_mode,
                    &output.usage,
                    output.result_json.as_deref(),
                    "idle",
                    pipeline.accumulator.take_result_id(),
                )?;
                restore_parent_active_if_child_selected(
                    &created.workspace_id,
                    &created.parent_session_id,
                    &created.child_session_id,
                );
                publish_delegation_updates(
                    app,
                    &created.workspace_id,
                    &created.parent_session_id,
                    &created.child_session_id,
                );
                sidecar.unsubscribe(&request_id);
                return Ok(ChildTurnOutput {
                    assistant_text,
                    provider_session_id: output.session_id,
                });
            }
            "error" => {
                let message = event
                    .raw
                    .get("message")
                    .and_then(Value::as_str)
                    .or_else(|| event.raw.get("error").and_then(Value::as_str))
                    .unwrap_or("Delegated child stream failed")
                    .to_string();
                finalize_child_error(&ctx, model, &message)?;
                sidecar.unsubscribe(&request_id);
                return Err(anyhow::anyhow!(message));
            }
            _ => {
                let line = serde_json::to_string(&event.raw).unwrap_or_default();
                if line.is_empty() || line == "{}" {
                    continue;
                }
                match pipeline.push_event(&event.raw, &line) {
                    PipelineEmit::Full(_) | PipelineEmit::Partial(_) => {
                        publish_delegation_updates(
                            app,
                            &created.workspace_id,
                            &created.parent_session_id,
                            &created.child_session_id,
                        );
                    }
                    PipelineEmit::None => {}
                }
                persist_pending_turns(&mut pipeline, &ctx, &mut persisted_turn_count)?;
            }
        }
    }
}

fn persist_pending_turns(
    pipeline: &mut crate::pipeline::MessagePipeline,
    ctx: &ExchangeContext,
    persisted_turn_count: &mut usize,
) -> Result<()> {
    let conn = crate::models::db::write_conn()?;
    let model = pipeline.accumulator.resolved_model().to_string();
    while *persisted_turn_count < pipeline.accumulator.turns_len() {
        persist_turn_message(
            &conn,
            ctx,
            pipeline.accumulator.turn_at(*persisted_turn_count),
            &model,
        )?;
        *persisted_turn_count += 1;
    }
    Ok(())
}

fn finalize_child_error(
    ctx: &ExchangeContext,
    model: &super::ResolvedModel,
    message: &str,
) -> Result<()> {
    let conn = crate::models::db::write_conn()?;
    persist_error_message(&conn, ctx, &model.cli_model, message)?;
    finalize_session_metadata(&conn, ctx, "idle", None, None)?;
    Ok(())
}

fn resolve_session_working_directory(session_id: &str) -> Result<std::path::PathBuf> {
    let conn = crate::models::db::read_conn()?;
    let path: String = conn.query_row(
        r#"
        SELECT COALESCE(r.root_path || '/' || w.directory_name, w.directory_name)
        FROM sessions s
        JOIN workspaces w ON w.id = s.workspace_id
        LEFT JOIN repos r ON r.id = w.repository_id
        WHERE s.id = ?1
        "#,
        [session_id],
        |row| row.get(0),
    )?;
    Ok(std::path::PathBuf::from(path))
}

fn parse_structured_json(text: &str) -> Result<Value> {
    let trimmed = text.trim();
    if let Ok(value) = serde_json::from_str(trimmed) {
        return Ok(value);
    }
    let stripped = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed);
    serde_json::from_str(stripped).context("assistant response was not valid JSON")
}

fn stop_sidecar_session(
    sidecar: &crate::sidecar::ManagedSidecar,
    session_id: &str,
    provider: &str,
) -> Result<()> {
    sidecar.send(&crate::sidecar::SidecarRequest {
        id: Uuid::new_v4().to_string(),
        method: "stopSession".to_string(),
        params: json!({ "sessionId": session_id, "provider": provider }),
    })
}

fn default_model_id_for_provider(provider: &str) -> String {
    match provider {
        "claude" => "default".to_string(),
        "codex" => "gpt-5.4".to_string(),
        "pi" => "pi:azure-openai-responses/gpt-5.4-mini".to_string(),
        other => other.to_string(),
    }
}

fn status_for_error(error: &anyhow::Error) -> &'static str {
    let text = error.to_string().to_lowercase();
    if text.contains("timed out") {
        "timeout"
    } else if text.contains("cancel") || text.contains("abort") {
        "cancelled"
    } else {
        "failed"
    }
}

fn restore_parent_active_if_child_selected(
    workspace_id: &str,
    parent_session_id: &str,
    child_session_id: &str,
) {
    if let Ok(conn) = crate::models::db::write_conn() {
        let _ = conn.execute(
            "UPDATE workspaces SET active_session_id = ?2 WHERE id = ?1 AND active_session_id = ?3",
            params![workspace_id, parent_session_id, child_session_id],
        );
    }
}

fn publish_delegation_updates(
    app: &AppHandle,
    workspace_id: &str,
    parent_session_id: &str,
    child_session_id: &str,
) {
    ui_sync::publish(
        app,
        UiMutationEvent::SessionMessagesChanged {
            workspace_id: workspace_id.to_string(),
            session_id: parent_session_id.to_string(),
        },
    );
    ui_sync::publish(
        app,
        UiMutationEvent::SessionMessagesChanged {
            workspace_id: workspace_id.to_string(),
            session_id: child_session_id.to_string(),
        },
    );
    ui_sync::publish(
        app,
        UiMutationEvent::SessionListChanged {
            workspace_id: workspace_id.to_string(),
        },
    );
}
