use std::future::Future;
use std::path::Path;
use std::sync::mpsc::RecvTimeoutError;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
#[cfg(test)]
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use crate::models::delegations::{self, CreateDelegationInput, DelegationRecord};
use crate::pipeline::PipelineEmit;
use crate::ui_sync::{self, UiMutationEvent};

use super::persistence::{
    finalize_session_metadata_libsql, persist_error_message_libsql,
    persist_result_and_finalize_libsql, persist_turn_message_libsql_with_app,
    persist_user_message_libsql,
};
use super::streaming::{build_send_message_params, BuildSendMessageParamsInput};
use super::{resolve_model, ExchangeContext};

// Historical compatibility: Pi no longer receives the generic `delegate_agent`
// tool. Keep this backend/read path for existing delegation records until the
// later backend-pruning phase removes `session_delegations` and anchors.

const CHILD_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(45);

fn block_on_delegation_db<T>(future: impl Future<Output = Result<T>>) -> Result<T> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(future)),
        Err(_) => tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .context("Failed to build delegation DB runtime")?
            .block_on(future),
    }
}

fn persist_child_provider_session_id_via_libsql(
    child_session_id: String,
    provider_session_id: String,
    provider: String,
) {
    if let Err(error) = block_on_delegation_db(crate::models::db::libsql_write_async(
        |connection| async move {
            connection
                .execute(
                    "UPDATE sessions SET provider_session_id = ?2, agent_type = ?3 WHERE id = ?1",
                    libsql::params![child_session_id, provider_session_id, provider],
                )
                .await?;
            Ok(())
        },
    )) {
        tracing::warn!(
            error = ?error,
            "Failed to persist delegation child provider session id"
        );
    }
}

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
    parent_prompt_prefix: Option<&str>,
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

    let created = create_delegation_anchor(CreateDelegationInput {
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
    let delegated_debug_prefix = debug_prompt_prefix_for_delegation(parent_prompt_prefix);
    let prompt = build_delegation_wire_prompt(task, &schema_text);

    let first = run_child_turn(
        &app,
        sidecar,
        &created,
        &model,
        &prompt,
        task,
        &working_directory,
        request.effort_level.as_deref(),
        request.permission_mode.as_deref(),
        timeout,
        None,
        delegated_debug_prefix.as_deref(),
    );

    let mut final_output = match first {
        Ok(output) => output,
        Err(error) => {
            let record = update_delegation_status(
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
        let repair_visible_prompt =
            "Repair the previous response so it matches the required structured output.";
        final_output = run_child_turn(
            &app,
            sidecar,
            &created,
            &model,
            &repair_prompt,
            repair_visible_prompt,
            &working_directory,
            request.effort_level.as_deref(),
            request.permission_mode.as_deref(),
            timeout,
            final_output.provider_session_id.as_deref(),
            delegated_debug_prefix.as_deref(),
        )?;
        parse_structured_json(&final_output.assistant_text)
    });

    let result = match parsed {
        Ok(value) => value,
        Err(error) => {
            let record = update_delegation_status(
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

    let delegation = update_delegation_status(&created.id, "succeeded", Some(&result), None)?;
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

struct SidecarSubscription<'a> {
    sidecar: &'a crate::sidecar::ManagedSidecar,
    request_id: String,
}

impl<'a> SidecarSubscription<'a> {
    fn new(sidecar: &'a crate::sidecar::ManagedSidecar, request_id: String) -> Self {
        Self {
            sidecar,
            request_id,
        }
    }
}

impl Drop for SidecarSubscription<'_> {
    fn drop(&mut self) {
        self.sidecar.unsubscribe(&self.request_id);
    }
}

#[allow(clippy::too_many_arguments)]
fn run_child_turn(
    app: &AppHandle,
    sidecar: &crate::sidecar::ManagedSidecar,
    created: &delegations::CreatedDelegation,
    model: &super::ResolvedModel,
    wire_prompt: &str,
    visible_prompt: &str,
    working_directory: &Path,
    effort_level: Option<&str>,
    permission_mode: Option<&str>,
    timeout: Duration,
    resume_session_id: Option<&str>,
    hidden_prompt_prefix: Option<&str>,
) -> Result<ChildTurnOutput> {
    let request_id = Uuid::new_v4().to_string();
    let wire_prompt = match hidden_prompt_prefix
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(prefix) => format!("{prefix}\n\nDelegated task:\n{wire_prompt}"),
        None => wire_prompt.to_string(),
    };
    let params = build_send_message_params(BuildSendMessageParamsInput {
        sidecar_session_id: &created.child_session_id,
        prompt: &wire_prompt,
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
        codex_profile: model.codex_profile.as_deref(),
        codex_model_provider: model.codex_model_provider.as_deref(),
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
    let _subscription = SidecarSubscription::new(sidecar, request_id.clone());
    sidecar.send(&request)?;

    let ctx = ExchangeContext {
        helmor_session_id: created.child_session_id.clone(),
        model_id: model.id.clone(),
        model_provider: model.provider.clone(),
        user_message_id: Uuid::new_v4().to_string(),
    };
    let user_ctx = ctx.clone();
    let visible_prompt = visible_prompt.to_string();
    block_on_delegation_db(crate::models::db::libsql_write_async(|conn| async move {
        persist_user_message_libsql(&conn, &user_ctx, &visible_prompt, &[], &[]).await
    }))?;

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
            persist_child_provider_session_id_via_libsql(
                created.child_session_id.clone(),
                session_id.to_string(),
                model.provider.clone(),
            );
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
                persist_pending_turns(app, &mut pipeline, &ctx, &mut persisted_turn_count)?;
                let output = pipeline
                    .accumulator
                    .drain_output(resolved_session_id.as_deref());
                if is_aborted {
                    let finalize_ctx = ctx.clone();
                    block_on_delegation_db(crate::models::db::libsql_write_async(
                        |conn| async move {
                            finalize_session_metadata_libsql(
                                &conn,
                                &finalize_ctx,
                                "aborted",
                                effort_level,
                                permission_mode,
                            )
                            .await
                        },
                    ))?;
                    return Err(anyhow::anyhow!("Delegation was cancelled"));
                }
                let assistant_text = output.assistant_text.clone();
                let assistant_text_for_persist = assistant_text.clone();
                let result_ctx = ctx.clone();
                let resolved_model = output.resolved_model.clone();
                let usage = output.usage.clone();
                let result_json = output.result_json.clone();
                let result_id = pipeline.accumulator.take_result_id();
                block_on_delegation_db(crate::models::db::libsql_write_async(|conn| async move {
                    persist_result_and_finalize_libsql(
                        &conn,
                        &result_ctx,
                        &resolved_model,
                        &assistant_text_for_persist,
                        effort_level,
                        permission_mode,
                        &usage,
                        result_json.as_deref(),
                        "idle",
                        result_id,
                    )
                    .await
                    .map(|_| ())
                }))?;
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
                return Err(anyhow::anyhow!(message));
            }
            _ => {
                let line = serde_json::to_string(&event.raw).unwrap_or_default();
                if line.is_empty() || line == "{}" {
                    continue;
                }
                match pipeline.push_event(&event.raw, &line) {
                    PipelineEmit::Full(_) | PipelineEmit::Partial(_) | PipelineEmit::Delta(_) => {
                        publish_delegation_updates(
                            app,
                            &created.workspace_id,
                            &created.parent_session_id,
                            &created.child_session_id,
                        );
                    }
                    PipelineEmit::None => {}
                }
                persist_pending_turns(app, &mut pipeline, &ctx, &mut persisted_turn_count)?;
            }
        }
    }
}

fn create_delegation_anchor(
    input: CreateDelegationInput,
) -> Result<delegations::CreatedDelegation> {
    block_on_delegation_db(delegations::create_delegation_anchor_async(input))
}

fn update_delegation_status(
    delegation_id: &str,
    status: &str,
    structured_result: Option<&Value>,
    error: Option<&str>,
) -> Result<DelegationRecord> {
    block_on_delegation_db(delegations::update_delegation_status_async(
        delegation_id,
        status,
        structured_result.cloned(),
        error.map(str::to_string),
    ))
}

fn debug_prompt_prefix_for_delegation(parent_prompt_prefix: Option<&str>) -> Option<String> {
    let prefix = parent_prompt_prefix?.trim();
    let debug_start = prefix.find("[DEBUG MODE ACTIVE]")?;
    let debug_prefix = prefix[debug_start..].trim();
    if debug_prefix.is_empty() {
        None
    } else {
        Some(debug_prefix.to_string())
    }
}

fn build_delegation_wire_prompt(task: &str, schema_text: &str) -> String {
    format!(
        "{task}\n\nReturn only JSON that validates against this JSON Schema. Do not wrap it in Markdown.\n\nJSON Schema:\n{schema_text}"
    )
}

fn persist_pending_turns(
    app: &AppHandle,
    pipeline: &mut crate::pipeline::MessagePipeline,
    ctx: &ExchangeContext,
    persisted_turn_count: &mut usize,
) -> Result<()> {
    let model = pipeline.accumulator.resolved_model().to_string();
    block_on_delegation_db(crate::models::db::libsql_write_async(|conn| async move {
        while *persisted_turn_count < pipeline.accumulator.turns_len() {
            let turn = pipeline.accumulator.turn_at(*persisted_turn_count).clone();
            persist_turn_message_libsql_with_app(&conn, app, ctx, &turn, &model).await?;
            *persisted_turn_count += 1;
        }
        Ok(())
    }))
}

fn finalize_child_error(
    ctx: &ExchangeContext,
    model: &super::ResolvedModel,
    message: &str,
) -> Result<()> {
    let ctx = ctx.clone();
    let model = model.cli_model.clone();
    let message = message.to_string();
    block_on_delegation_db(crate::models::db::libsql_write_async(|conn| async move {
        persist_error_message_libsql(&conn, &ctx, &model, &message).await?;
        finalize_session_metadata_libsql(&conn, &ctx, "idle", None, None).await
    }))
}

fn resolve_session_working_directory(session_id: &str) -> Result<std::path::PathBuf> {
    block_on_delegation_db(resolve_session_working_directory_async(session_id))
}

async fn resolve_session_working_directory_async(session_id: &str) -> Result<std::path::PathBuf> {
    let connection = crate::models::db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            r#"
        SELECT r.name, w.directory_name
        FROM sessions s
        JOIN workspaces w ON w.id = s.workspace_id
        JOIN repos r ON r.id = w.repository_id
        WHERE s.id = ?1
        "#,
            [session_id.to_string()],
        )
        .await
        .context("Delegation session workspace not found")?;
    let Some(row) = rows
        .next()
        .await
        .context("Delegation session workspace not found")?
    else {
        bail!("Delegation session workspace not found");
    };
    let repo_name: String = row.get(0).context("Failed to read repository name")?;
    let directory_name: String = row
        .get(1)
        .context("Failed to read workspace directory name")?;
    crate::data_dir::workspace_dir(&repo_name, &directory_name)
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
    let result = block_on_delegation_db(restore_parent_active_if_child_selected_async(
        workspace_id,
        parent_session_id,
        child_session_id,
    ));
    match result {
        Ok(()) => {}
        Err(error) => {
            tracing::warn!(
                error = ?error,
                "Failed to restore parent active session after delegation"
            );
        }
    }
}

async fn restore_parent_active_if_child_selected_async(
    workspace_id: &str,
    parent_session_id: &str,
    child_session_id: &str,
) -> Result<()> {
    let workspace_id = workspace_id.to_string();
    let parent_session_id = parent_session_id.to_string();
    let child_session_id = child_session_id.to_string();
    crate::models::db::libsql_write_async(|connection| async move {
        connection
            .execute(
                "UPDATE workspaces SET active_session_id = ?2 WHERE id = ?1 AND active_session_id = ?3",
                libsql::params![workspace_id, parent_session_id, child_session_id],
            )
            .await?;
        Ok(())
    })
    .await
}

#[cfg(test)]
fn restore_parent_active_if_child_selected_on(
    conn: &Connection,
    workspace_id: &str,
    parent_session_id: &str,
    child_session_id: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE workspaces SET active_session_id = ?2 WHERE id = ?1 AND active_session_id = ?3",
        params![workspace_id, parent_session_id, child_session_id],
    )?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_debug_prompt_prefix_for_delegated_agents() {
        let parent_prefix = "Repo preference\n\n[DEBUG MODE ACTIVE]\nUse evidence.\n\n[DEBUG INGEST SERVER]\nThis is a live telemetry receiver.\n\nEndpoint: http://127.0.0.1:4321/ingest?token=t";

        let prefix = debug_prompt_prefix_for_delegation(Some(parent_prefix)).unwrap();

        assert!(prefix.starts_with("[DEBUG MODE ACTIVE]"));
        assert!(prefix.contains("http://127.0.0.1:4321/ingest?token=t"));
        assert!(!prefix.contains("Repo preference"));
    }

    #[test]
    fn omits_delegated_debug_prefix_when_parent_is_not_debug() {
        assert_eq!(
            debug_prompt_prefix_for_delegation(Some("Repo preference")),
            None
        );
        assert_eq!(debug_prompt_prefix_for_delegation(None), None);
    }

    #[test]
    fn delegation_wire_prompt_keeps_schema_out_of_visible_prompt() {
        let task = "Write one original joke.";
        let schema = r#"{"type":"object","properties":{"joke":{"type":"string"}}}"#;
        let visible_prompt = task;

        let wire_prompt = build_delegation_wire_prompt(task, schema);

        assert!(wire_prompt.starts_with(task));
        assert!(wire_prompt.contains("JSON Schema:"));
        assert!(wire_prompt.contains(schema));
        assert!(!visible_prompt.contains("JSON Schema:"));
        assert!(!visible_prompt.contains(schema));
    }

    #[test]
    fn resolve_session_working_directory_uses_helmor_workspace_dir() {
        let _env = crate::testkit::TestEnv::new("delegation-workdir");
        let conn = Connection::open(crate::data_dir::db_path().unwrap()).unwrap();
        conn.execute(
            "INSERT INTO repos (id, name, default_branch, root_path) VALUES ('repo-1', 'demo-repo', 'main', '/source/demo-repo')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspaces (id, repository_id, directory_name, state, status) VALUES ('workspace-1', 'repo-1', 'delegate-ws', 'ready', 'in-progress')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, status) VALUES ('session-1', 'workspace-1', 'idle')",
            [],
        )
        .unwrap();

        let resolved = resolve_session_working_directory("session-1").unwrap();
        let expected = crate::data_dir::workspace_dir("demo-repo", "delegate-ws").unwrap();

        assert_eq!(resolved, expected);
        assert_ne!(
            resolved,
            std::path::PathBuf::from("/source/demo-repo/delegate-ws")
        );
    }

    #[test]
    fn restore_parent_active_session_reuses_existing_writer() {
        let _env = crate::testkit::TestEnv::new("delegation-restore-active");
        let conn = Connection::open(crate::data_dir::db_path().unwrap()).unwrap();
        conn.execute(
            "INSERT INTO workspaces (id, active_session_id) VALUES ('workspace-1', 'child-session')",
            [],
        )
        .unwrap();

        restore_parent_active_if_child_selected_on(
            &conn,
            "workspace-1",
            "parent-session",
            "child-session",
        )
        .unwrap();

        let active_session_id: String = conn
            .query_row(
                "SELECT active_session_id FROM workspaces WHERE id = 'workspace-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(active_session_id, "parent-session");
    }
}
