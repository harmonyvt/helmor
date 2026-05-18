use std::future::Future;
use std::path::Path;
use std::sync::mpsc::RecvTimeoutError;
use std::time::{Duration, Instant};

/// Maximum time we wait between sidecar events before declaring the sidecar
/// dead. The sidecar emits a `heartbeat` event every 15s for every active
/// stream; 45s = 3× heartbeat interval tolerates a single missed tick from
/// GC / busy system without false positives. A long-running tool call (e.g.
/// `bash: pytest` for 20 minutes) is fine because heartbeats keep flowing
/// regardless of what the AI is doing.
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(45);

mod actions;
mod active_streams;
mod bridges;
mod cleanup;
mod context_usage;
mod params;
mod pi_assignee_models;
mod pi_tools;
mod session_id;
mod state;

#[cfg(test)]
mod event_loop_tests;

pub(crate) use active_streams::ActiveStreamHandle;
pub use active_streams::{abort_all_active_streams_blocking, ActiveStreams};
pub use bridges::{
    bridge_aborted_event, bridge_deferred_tool_use_event, bridge_done_event,
    bridge_elicitation_request_event, bridge_error_event, bridge_permission_request_event,
    bridge_user_input_request_event, convert_elicitation_content_to_codex_answers,
};
pub(crate) use cleanup::cleanup_abnormal_stream_exit;
pub use params::{
    build_send_message_params, lookup_workspace_linked_directories, BuildSendMessageParamsInput,
};
use session_id::should_adopt_provider_session_id;

use anyhow::Context;
use serde_json::{json, Value};
use tauri::{ipc::Channel, AppHandle, Manager};
use uuid::Uuid;

use crate::pipeline::types::{
    ExtendedMessagePart, MessagePart, MessageRole, PlanAllowedPrompt, ThreadMessageLike,
};

use super::persistence::{
    finalize_session_metadata_libsql, persist_error_message_libsql,
    persist_exit_plan_message_libsql, persist_result_and_finalize_libsql,
    persist_stream_start_metadata_libsql, persist_turn_messages_libsql_with_app,
    persist_user_message_libsql,
};
use super::{AgentSendRequest, AgentStreamEvent, CmdResult, ExchangeContext};

fn block_on_streaming_db<T>(future: impl Future<Output = anyhow::Result<T>>) -> anyhow::Result<T> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(future)),
        Err(_) => tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .context("Failed to build streaming DB runtime")?
            .block_on(future),
    }
}

fn clone_exchange_context(ctx: &ExchangeContext) -> ExchangeContext {
    ExchangeContext {
        helmor_session_id: ctx.helmor_session_id.clone(),
        model_id: ctx.model_id.clone(),
        model_provider: ctx.model_provider.clone(),
        user_message_id: ctx.user_message_id.clone(),
    }
}

fn persist_available_turns_libsql(
    app: &AppHandle,
    pipeline_state: &crate::pipeline::MessagePipeline,
    ctx: &ExchangeContext,
    persisted_turn_count: &mut usize,
) -> Option<anyhow::Error> {
    let start = *persisted_turn_count;
    let end = pipeline_state.accumulator.turns_len();
    if start >= end {
        return None;
    }

    let turns: Vec<_> = (start..end)
        .map(|index| pipeline_state.accumulator.turn_at(index).clone())
        .collect();
    let model = pipeline_state.accumulator.resolved_model().to_string();
    let ctx = clone_exchange_context(ctx);
    let app = app.clone();
    match block_on_streaming_db(crate::models::db::libsql_write_async(|conn| async move {
        let (persisted, error) =
            persist_turn_messages_libsql_with_app(&conn, &app, &ctx, &turns, &model).await;
        Ok((persisted, error))
    })) {
        Ok((persisted, error)) => {
            *persisted_turn_count += persisted;
            error
        }
        Err(error) => Some(error),
    }
}

async fn read_resume_session_context_libsql(
    helmor_session_id: String,
) -> anyhow::Result<Option<(Option<String>, Option<String>, Option<String>)>> {
    let conn = crate::models::db::libsql_conn_async().await?;
    let mut rows = conn
        .query(
            "SELECT provider_session_id, agent_type, model FROM sessions WHERE id = ?1",
            [helmor_session_id],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Ok(None);
    };
    Ok(Some((
        row.get(0).context("Failed to read provider_session_id")?,
        row.get(1).context("Failed to read agent_type")?,
        row.get(2).context("Failed to read model")?,
    )))
}

fn persist_provider_session_id_via_libsql(
    rid: String,
    helmor_session_id: String,
    provider_session_id: String,
    provider: String,
) {
    tauri::async_runtime::spawn(async move {
        match crate::models::db::libsql_write_async(|connection| async move {
            connection
                .execute(
                    "UPDATE sessions SET provider_session_id = ?2, agent_type = ?3 WHERE id = ?1",
                    libsql::params![helmor_session_id, provider_session_id, provider],
                )
                .await?;
            Ok(())
        })
        .await
        {
            Ok(()) => {
                tracing::debug!(rid = %rid, "Session ID persisted");
            }
            Err(error) => {
                tracing::error!(rid = %rid, "Failed to persist session id: {error}");
            }
        }
    });
}

fn execute_delegation_tool_call(
    app: AppHandle,
    sidecar: &crate::sidecar::ManagedSidecar,
    tool_call_id: &str,
    parent_session_id: Option<&str>,
    parent_provider: &str,
    parent_prompt_prefix: Option<&str>,
    args: Value,
) -> anyhow::Result<Value> {
    let parent_session_id = parent_session_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            anyhow::anyhow!("delegate_agent requires a persisted Helmor parent session")
        })?;
    let mut payload = match args {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    payload.insert(
        "parentSessionId".to_string(),
        Value::String(parent_session_id.to_string()),
    );
    payload.insert(
        "parentProvider".to_string(),
        Value::String(parent_provider.to_string()),
    );
    let request: super::delegation::DelegateAgentRequest =
        serde_json::from_value(Value::Object(payload)).map_err(|error| {
            anyhow::anyhow!("Invalid delegate_agent arguments for {tool_call_id}: {error}")
        })?;
    let response =
        super::delegation::delegate_agent_blocking(app, sidecar, request, parent_prompt_prefix)?;
    Ok(serde_json::to_value(response)?)
}

fn send_pi_tool_result(
    sidecar: &crate::sidecar::ManagedSidecar,
    tool_call_id: &str,
    result: Value,
    is_error: bool,
) -> anyhow::Result<()> {
    let request = crate::sidecar::SidecarRequest {
        id: Uuid::new_v4().to_string(),
        method: "kanbanToolResult".to_string(),
        params: serde_json::json!({
            "toolCallId": tool_call_id,
            "result": result,
            "isError": is_error,
        }),
    };
    sidecar.send(&request)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn stream_via_sidecar(
    app: AppHandle,
    on_event: Channel<AgentStreamEvent>,
    sidecar: &crate::sidecar::ManagedSidecar,
    active_streams: &ActiveStreams,
    stream_id: &str,
    model: &super::ResolvedModel,
    prompt: &str,
    request: &AgentSendRequest,
    working_directory: &Path,
) -> CmdResult<()> {
    let request_id = stream_id.to_string();

    tracing::info!(
        stream_id = %stream_id,
        provider = %model.provider,
        model_id = %model.id,
        resolved_cli_model = %model.cli_model,
        codex_profile = ?model.codex_profile,
        cwd = %working_directory.display(),
        prompt_len = prompt.len(),
        has_prompt_prefix = request.prompt_prefix.as_deref().is_some_and(|prefix| !prefix.trim().is_empty()),
        resume_only = request.resume_only,
        session_id = ?request.session_id,
        helmor_session_id = ?request.helmor_session_id,
        permission_mode = ?request.permission_mode,
        effort_level = ?request.effort_level,
        fast_mode = ?request.fast_mode,
        file_count = request.files.as_ref().map_or(0, Vec::len),
        image_count = request.images.as_ref().map_or(0, Vec::len),
        "stream_via_sidecar starting"
    );
    tracing::debug!(
        provider = %model.provider,
        model = %model.cli_model,
        cwd = %working_directory.display(),
        prompt_len = prompt.len(),
        "stream_via_sidecar"
    );

    let resume_session_id = request.session_id.clone().or_else(|| {
        request.helmor_session_id.as_deref().and_then(|hsid| {
            let (stored_sid, stored_provider, stored_model_id) = match block_on_streaming_db(
                read_resume_session_context_libsql(hsid.to_string()),
            ) {
                Ok(Some(context)) => context,
                Ok(None) => return None,
                Err(error) => {
                    tracing::warn!(
                        helmor_session_id = %hsid,
                        error = ?error,
                        "Failed to read stored provider session resume context"
                    );
                    return None;
                }
            };
            let sid = stored_sid?;
            if can_resume_provider_session_for_model(
                stored_provider.as_deref(),
                stored_model_id.as_deref(),
                model,
            ) {
                Some(sid)
            } else {
                tracing::info!(
                    helmor_session_id = %hsid,
                    stored_provider = ?stored_provider,
                    stored_model_id = ?stored_model_id,
                    requested_provider = %model.provider,
                    requested_model_id = %model.id,
                    requested_codex_profile = ?model.codex_profile,
                    "Skipping stored provider session resume because session metadata no longer matches requested model"
                );
                None
            }
        })
    });

    tracing::debug!(
        resume_session_id = ?resume_session_id,
        helmor_session_id = ?request.helmor_session_id,
        provider = %model.provider,
        "Session resume context"
    );
    tracing::info!(
        stream_id = %stream_id,
        resume_session_id = ?resume_session_id,
        helmor_session_id = ?request.helmor_session_id,
        provider = %model.provider,
        "stream_via_sidecar resume context"
    );

    let helmor_session_id = request.helmor_session_id.clone();
    let sidecar_session_id = helmor_session_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // Combine the optional hidden preamble with the user's prompt. Only
    // the wire payload sees the combined string — `prompt` (user text
    // only) is what gets persisted in `persist_user_message` below, so
    // the chat bubble + DB stay free of the preference prefix.
    let prefix_trimmed = request
        .prompt_prefix
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty());
    let combined_prompt = match prefix_trimmed {
        Some(prefix) => format!("{prefix}\n\nUser request:\n{prompt}"),
        None => prompt.to_string(),
    };

    let images_for_wire = request.images.clone().unwrap_or_default();
    tracing::info!(
        stream_id = %stream_id,
        provider = %model.provider,
        model = %model.cli_model,
        codex_profile = ?model.codex_profile,
        combined_prompt_len = combined_prompt.len(),
        prompt_prefix_len = prefix_trimmed.map_or(0, str::len),
        image_count = images_for_wire.len(),
        "stream_via_sidecar wire payload prepared"
    );
    let params = build_send_message_params(BuildSendMessageParamsInput {
        sidecar_session_id: &sidecar_session_id,
        prompt: &combined_prompt,
        cli_model: &model.cli_model,
        cwd: &working_directory.display().to_string(),
        resume_session_id: resume_session_id.as_deref(),
        provider: &model.provider,
        effort_level: request.effort_level.as_deref(),
        permission_mode: request.permission_mode.as_deref(),
        fast_mode: request.fast_mode.unwrap_or(false),
        helmor_session_id: request.helmor_session_id.as_deref(),
        claude_base_url: model.claude_base_url.as_deref(),
        claude_auth_token: model.claude_auth_token.as_deref(),
        codex_profile: model.codex_profile.as_deref(),
        codex_model_provider: model.codex_model_provider.as_deref(),
        images: &images_for_wire,
        kanban_workspace_id: request.kanban_workspace_id.as_deref(),
        kanban_snapshot: request.kanban_snapshot.as_deref(),
        goal_title: request.goal_title.as_deref(),
        goal_description: request.goal_description.as_deref(),
    });

    // Surface the `/add-dir` decision in logs — we often debug linked-
    // directory issues by asking "did the path actually make it to the
    // sidecar?" and this answers that without grepping the sidecar
    // wire-format later.
    if let Some(arr) = params
        .get("additionalDirectories")
        .and_then(|v| v.as_array())
    {
        tracing::info!(
            count = arr.len(),
            dirs = ?arr,
            helmor_session_id = ?request.helmor_session_id,
            "sendMessage with linked additionalDirectories"
        );
    } else {
        tracing::info!(
            helmor_session_id = ?request.helmor_session_id,
            "sendMessage without linked additionalDirectories (none configured)"
        );
    }

    let sidecar_req = crate::sidecar::SidecarRequest {
        id: request_id.clone(),
        method: "sendMessage".to_string(),
        params,
    };

    let rx = sidecar.subscribe(&request_id);

    if let Err(error) = sidecar.send(&sidecar_req) {
        sidecar.unsubscribe(&request_id);
        return Err(anyhow::anyhow!("Sidecar send failed: {error}").into());
    }

    active_streams.register(ActiveStreamHandle {
        request_id: request_id.clone(),
        sidecar_session_id: sidecar_session_id.clone(),
        provider: model.provider.to_string(),
    });

    let model_id = model.id.clone();
    let provider = model.provider.clone();
    let model_copy = model.clone();
    let prompt_copy = prompt.to_string();
    let working_dir_str = working_directory.display().to_string();
    let hsid_copy = helmor_session_id;
    let effort_copy = request.effort_level.clone();
    let permission_mode_initial = request.permission_mode.clone();
    let parent_prompt_prefix = request.prompt_prefix.clone();
    let fast_mode = request.fast_mode.unwrap_or(false);
    let user_message_id_copy = request.user_message_id.clone();
    let files_copy = request.files.clone().unwrap_or_default();
    let images_copy = request.images.clone().unwrap_or_default();
    let resume_only = request.resume_only;
    let sidecar_session_id_copy = sidecar_session_id.clone();
    let rid = request_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let stream_started_at = Instant::now();
        tracing::info!(
            rid = %rid,
            helmor_session_id = ?hsid_copy,
            sidecar_session_id = %sidecar_session_id_copy,
            provider = %provider,
            model = %model_copy.cli_model,
            codex_profile = ?model_copy.codex_profile,
            resume_only,
            "stream: event loop starting"
        );

        let sidecar_state: tauri::State<'_, crate::sidecar::ManagedSidecar> = app.state();
        let active_streams_state: tauri::State<'_, ActiveStreams> = app.state();
        let mut resolved_session_id: Option<String> = resume_session_id.clone();
        let context_key = rid.clone();
        let pipeline_session_id = hsid_copy.clone().unwrap_or_else(|| context_key.clone());
        let mut pipeline = hsid_copy.as_ref().map(|_| {
            crate::pipeline::MessagePipeline::new(
                provider.as_str(),
                &model_copy.cli_model,
                &context_key,
                &pipeline_session_id,
            )
        });
        let mut event_count: u64 = 0;
        let mut heartbeat_count: u64 = 0;

        let mut exchange_ctx: Option<ExchangeContext> = None;
        // `persisted_turn_count` lives in this local rather than in
        // `turn_session.ctx` because the inline DB-write loops in each
        // arm need shared `&mut` access alongside the pipeline's
        // `accumulator.turn_at()`. Once the persist loop migrates
        // behind `Action::PersistTurnRange`, this can move into ctx.
        let mut persisted_turn_count: usize = 0;

        // Short-borrow only. The single-writer pool (max_size=1) is shared
        // with every other write in the app; a long-held handle here would
        // block pin/unpin/mark-read/rename for the entire turn.
        if let Some(hsid) = &hsid_copy {
            let ctx = ExchangeContext {
                helmor_session_id: hsid.clone(),
                model_id: model_copy.id.to_string(),
                model_provider: model_copy.provider.to_string(),
                user_message_id: user_message_id_copy
                    .clone()
                    .unwrap_or_else(|| Uuid::new_v4().to_string()),
            };

            let now = crate::models::db::current_timestamp()
                .map(Some)
                .unwrap_or_else(|error| {
                    tracing::warn!(
                        rid = %rid,
                        error = %error,
                        "Failed to build stream-start timestamp"
                    );
                    None
                });
            let ctx_for_db = clone_exchange_context(&ctx);
            let permission_mode_for_db = permission_mode_initial.clone();
            match block_on_streaming_db(crate::models::db::libsql_write_async(|conn| async move {
                let metadata_error = persist_stream_start_metadata_libsql(
                    &conn,
                    &ctx_for_db,
                    fast_mode,
                    permission_mode_for_db.as_deref(),
                    now.as_deref(),
                )
                .await
                .err()
                .map(|error| error.to_string());

                let user_error = if resume_only {
                    None
                } else {
                    persist_user_message_libsql(
                        &conn,
                        &ctx_for_db,
                        &prompt_copy,
                        &files_copy,
                        &images_copy,
                    )
                    .await
                    .err()
                    .map(|error| error.to_string())
                };

                Ok((metadata_error, user_error))
            })) {
                Ok((metadata_error, user_error)) => {
                    if let Some(error) = metadata_error {
                        tracing::error!(
                            rid = %rid,
                            "Failed to update stream-start session metadata: {error}"
                        );
                    }
                    if let Some(error) = user_error {
                        tracing::error!(rid = %rid, "Failed to persist user message: {error}");
                    } else {
                        if !resume_only {
                            tracing::debug!(rid = %rid, "User message persisted to DB");
                        }
                        exchange_ctx = Some(ctx);
                    }
                }
                Err(e) => {
                    tracing::error!(rid = %rid, "Failed to run initial libSQL persist: {e}");
                }
            }
        }

        tracing::debug!(rid = %rid, "Waiting for sidecar events...");

        // State machine session — iteration 4 onwards. Each migrated
        // event arm dispatches through `turn_session.handle_*`; the
        // remaining arms still drive the legacy flow. ctx fields here
        // are a snapshot at session-start; events that mutate them
        // (e.g., `permissionModeChanged`) mirror the change back into
        // the legacy local vars until those readers migrate too.
        let apply_ctx = actions::ApplyContext {
            on_event: &on_event,
            app: &app,
        };
        let mut turn_session = state::TurnSession::new(state::TurnContext {
            provider: provider.clone(),
            model_id: model_id.clone(),
            working_directory: working_dir_str.clone(),
            effort_level: effort_copy.clone(),
            permission_mode: permission_mode_initial.clone(),
            fast_mode,
            helmor_session_id: hsid_copy.clone(),
            resolved_session_id: resolved_session_id.clone(),
            resolved_model: model_copy.cli_model.to_string(),
            persisted_turn_count: 0,
            persisted_exit_plan_review: None,
        });

        loop {
            let event = match rx.recv_timeout(HEARTBEAT_TIMEOUT) {
                Ok(ev) => ev,
                Err(err @ (RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected)) => {
                    let kind = match err {
                        RecvTimeoutError::Timeout => state::AbnormalExit::HeartbeatTimeout,
                        RecvTimeoutError::Disconnected => state::AbnormalExit::SidecarDisconnected,
                    };
                    let (reason_log, user_message, should_stop_sidecar) = match kind {
                        state::AbnormalExit::HeartbeatTimeout => (
                            format!(
                                "heartbeat lost for {:?} — treating stream as dead",
                                HEARTBEAT_TIMEOUT
                            ),
                            format!(
                                "Sidecar stopped responding (no heartbeat for {:?}). You can retry the request.",
                                HEARTBEAT_TIMEOUT,
                            ),
                            true,
                        ),
                        state::AbnormalExit::SidecarDisconnected => (
                            "sidecar channel disconnected".to_string(),
                            "Sidecar connection was lost. You can retry the request.".to_string(),
                            // Channel already closed — stopSession would most
                            // likely fail, and if the sidecar already died
                            // the request isn't running anyway.
                            false,
                        ),
                    };
                    tracing::error!(rid = %rid, "{reason_log}");

                    if should_stop_sidecar {
                        let stop_req = crate::sidecar::SidecarRequest {
                            id: Uuid::new_v4().to_string(),
                            method: "stopSession".to_string(),
                            params: serde_json::json!({
                                "sessionId": sidecar_session_id_copy.clone(),
                                "provider": provider.clone(),
                            }),
                        };
                        if let Err(e) = sidecar_state.send(&stop_req) {
                            tracing::warn!(rid = %rid, "stopSession during abnormal exit failed: {e}");
                        }
                        tracing::warn!(
                            rid = %rid,
                            sidecar_session_id = %sidecar_session_id_copy,
                            provider = %provider,
                            "heartbeat timeout reached; restarting sidecar after stopSession"
                        );
                        sidecar_state.restart_after_unresponsive_stop("stream heartbeat timeout");
                    }

                    let resolved_model = pipeline
                        .as_ref()
                        .map(|p| p.accumulator.resolved_model().to_string())
                        .unwrap_or_else(|| model_copy.cli_model.to_string());
                    let persisted = cleanup_abnormal_stream_exit(
                        &rid,
                        exchange_ctx.as_ref(),
                        &resolved_model,
                        &user_message,
                        effort_copy.as_deref(),
                        turn_session.ctx.permission_mode.as_deref(),
                    );

                    tracing::info!(
                        rid = %rid,
                        event_count,
                        heartbeat_count,
                        elapsed_ms = stream_started_at.elapsed().as_millis(),
                        persisted,
                        has_exchange_ctx = exchange_ctx.is_some(),
                        "stream: abnormal exit — finalized"
                    );

                    match turn_session.handle_abnormal_exit(kind, user_message, persisted) {
                        Ok(actions) => {
                            for action in actions {
                                actions::apply_action(action, &apply_ctx);
                            }
                        }
                        Err(err) => {
                            tracing::error!(
                                rid = %rid,
                                error = ?err,
                                "abnormal exit transition rejected",
                            );
                        }
                    }
                    break;
                }
            };

            // Heartbeats are keepalives only — do not advance pipeline state.
            if event.event_type() == "heartbeat" {
                heartbeat_count += 1;
                tracing::trace!(rid = %rid, heartbeat_count, "heartbeat");
                continue;
            }

            // Older sidecars may forward Codex app-server retry notices as
            // `type:error` events while preserving the structured
            // `willRetry=true` bit. Treat only those explicit retry markers as
            // liveness pings; message-only errors are terminal and must not be
            // converted into a successful `end` if the sidecar's finally block
            // emits one immediately after.
            if model_copy.provider == "codex"
                && event.event_type() == "error"
                && bridges::is_retryable_sidecar_error(&event.raw)
            {
                heartbeat_count += 1;
                let message = event
                    .raw
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("retryable sidecar error");
                tracing::debug!(rid = %rid, heartbeat_count, "Forwarding retryable sidecar error as notice: {message}");

                if let Some(pipeline_state) = pipeline.as_mut() {
                    let notice = bridges::retry_notice_event_from_error(&event.raw);
                    let line = serde_json::to_string(&notice).unwrap_or_default();
                    let emit = pipeline_state.push_event(&notice, &line);
                    match turn_session.handle_stream_event(emit) {
                        Ok(actions) => {
                            for action in actions {
                                actions::apply_action(action, &apply_ctx);
                            }
                        }
                        Err(err) => {
                            tracing::error!(
                                rid = %rid,
                                error = ?err,
                                "retry_notice transition rejected",
                            );
                        }
                    }
                }
                continue;
            }

            event_count += 1;

            // Claude's authoritative session_id comes only from `system.init`.
            // Earlier events — notably SessionStart:resume hook notifications —
            // carry a transient session_id that does NOT map to any real
            // conversation jsonl. Adopting them poisons the next resume with
            // "No conversation found". Codex flattens every notification with
            // its real thread_id, so any event is safe.
            let is_provider_session_marker = match model_copy.provider.as_str() {
                "claude" => event.is_claude_session_init(),
                _ => true,
            };
            if is_provider_session_marker {
                if let Some(sid) = event.session_id() {
                    if should_adopt_provider_session_id(
                        resolved_session_id.as_deref(),
                        sid,
                        hsid_copy.as_deref(),
                        model_copy.provider.as_str() == "codex",
                    ) {
                        resolved_session_id = Some(sid.to_string());
                        if resume_only {
                            tracing::debug!(
                                rid = %rid,
                                provider_session_id = sid,
                                "Skipping provider session persistence for resume-only stream"
                            );
                        } else if let Some(ctx) = &exchange_ctx {
                            persist_provider_session_id_via_libsql(
                                rid.clone(),
                                ctx.helmor_session_id.clone(),
                                sid.to_string(),
                                ctx.model_provider.clone(),
                            );
                        }
                    }
                }
            }

            match event.event_type() {
                "end" | "aborted" => {
                    // Infrastructure-side prep stays inline because it
                    // needs owned access to the pipeline and the
                    // single-writer DB pool. The state machine handles
                    // the terminal transition + the Update + Done|Aborted
                    // emit pair (and appends the persisted exit-plan
                    // review row when one was captured earlier).
                    let is_aborted = event.event_type() == "aborted";
                    let reason = if is_aborted {
                        Some(
                            event
                                .raw
                                .get("reason")
                                .and_then(Value::as_str)
                                .unwrap_or("user_requested")
                                .to_string(),
                        )
                    } else {
                        None
                    };
                    let status = if is_aborted { "aborted" } else { "idle" };

                    // Tracks whether the FINAL finalize (persist_result_and_finalize
                    // for end, finalize_session_metadata for aborted) succeeded.
                    // Turn-message failures don't flip this back to false — the
                    // frontend uses `persisted` as "end state is durable in DB".
                    let mut persisted = false;
                    let mut resolved_model = model_copy.cli_model.to_string();
                    let mut final_messages: Vec<ThreadMessageLike> = Vec::new();

                    if let Some(mut pipeline_state) = pipeline.take() {
                        if is_aborted {
                            pipeline_state.accumulator.mark_pending_tools_aborted();
                        }

                        pipeline_state.accumulator.flush_pending();

                        if is_aborted {
                            pipeline_state.accumulator.flush_codex_in_progress();
                            pipeline_state.materialize_partial();
                            pipeline_state.accumulator.append_aborted_notice();
                        }

                        // Persist remaining turns and then terminal metadata
                        // under one libSQL writer lock so DB row order stays
                        // aligned with the live stream.
                        let turn_start = persisted_turn_count;
                        let pending_turns = (turn_start..pipeline_state.accumulator.turns_len())
                            .map(|idx| pipeline_state.accumulator.turn_at(idx).clone())
                            .collect::<Vec<_>>();
                        let model_str = pipeline_state.accumulator.resolved_model().to_string();
                        let output = pipeline_state
                            .accumulator
                            .drain_output(resolved_session_id.as_deref());
                        if !output.assistant_text.is_empty() {
                            resolved_model = output.resolved_model.clone();
                        }
                        let preassigned = if is_aborted {
                            None
                        } else {
                            pipeline_state.accumulator.take_result_id()
                        };
                        if let Some(ctx) = exchange_ctx.as_ref() {
                            let ctx_for_db = clone_exchange_context(ctx);
                            let effort_for_db = effort_copy.clone();
                            let permission_mode_for_db = turn_session.ctx.permission_mode.clone();
                            let status_for_db = status.to_string();
                            let output_resolved_model = output.resolved_model.clone();
                            let assistant_text = output.assistant_text.clone();
                            let usage = output.usage.clone();
                            let result_json = output.result_json.clone();
                            let app_for_db = app.clone();
                            match block_on_streaming_db(crate::models::db::libsql_write_async(
                                |conn| async move {
                                    let (turns_persisted, turn_error) =
                                        persist_turn_messages_libsql_with_app(
                                            &conn,
                                            &app_for_db,
                                            &ctx_for_db,
                                            &pending_turns,
                                            &model_str,
                                        )
                                        .await;

                                    let final_error = if is_aborted {
                                        finalize_session_metadata_libsql(
                                            &conn,
                                            &ctx_for_db,
                                            &status_for_db,
                                            effort_for_db.as_deref(),
                                            permission_mode_for_db.as_deref(),
                                        )
                                        .await
                                        .err()
                                    } else {
                                        persist_result_and_finalize_libsql(
                                            &conn,
                                            &ctx_for_db,
                                            &output_resolved_model,
                                            &assistant_text,
                                            effort_for_db.as_deref(),
                                            permission_mode_for_db.as_deref(),
                                            &usage,
                                            result_json.as_deref(),
                                            &status_for_db,
                                            preassigned,
                                        )
                                        .await
                                        .map(|_| ())
                                        .err()
                                    };

                                    Ok((
                                        turns_persisted,
                                        turn_error.map(|error| error.to_string()),
                                        final_error.map(|error| error.to_string()),
                                    ))
                                },
                            )) {
                                Ok((turns_persisted, turn_error, final_error)) => {
                                    persisted_turn_count += turns_persisted;
                                    if let Some(error) = turn_error {
                                        tracing::error!(
                                            rid = %rid,
                                            turn = persisted_turn_count,
                                            "Failed to persist turn: {error}"
                                        );
                                    }
                                    if let Some(error) = final_error {
                                        tracing::error!(rid = %rid, "Failed to finalize exchange: {error}");
                                    } else {
                                        persisted = true;
                                    }
                                }
                                Err(error) => {
                                    tracing::error!(
                                        rid = %rid,
                                        "Failed to run terminal libSQL persistence: {error}"
                                    );
                                }
                            }
                        } else if exchange_ctx.is_some() {
                            tracing::error!(
                                rid = %rid,
                                "Failed to borrow writer for finalize — reporting persisted=false"
                            );
                        }

                        // Final render with DB-synced IDs so the frontend
                        // cache matches what the historical loader returns.
                        final_messages = pipeline_state.finish();
                    }

                    tracing::info!(
                        rid = %rid,
                        outcome = if is_aborted { "aborted" } else { "done" },
                        event_count,
                        heartbeat_count,
                        persisted_turn_count,
                        elapsed_ms = stream_started_at.elapsed().as_millis(),
                        persisted,
                        "stream: terminal event received"
                    );

                    match turn_session.handle_end_or_aborted(
                        is_aborted,
                        reason,
                        &resolved_model,
                        final_messages,
                        persisted,
                    ) {
                        Ok(actions) => {
                            for action in actions {
                                actions::apply_action(action, &apply_ctx);
                            }
                        }
                        Err(err) => {
                            tracing::error!(
                                rid = %rid,
                                error = ?err,
                                outcome = if is_aborted { "aborted" } else { "done" },
                                "end/aborted transition rejected",
                            );
                        }
                    }
                    break;
                }
                "permissionRequest" => {
                    // Routed through `TurnSession::handle_permission_request`
                    // — the first event arm migrated to the state machine.
                    // Late events (after Terminated) are surfaced as a
                    // tracing error rather than silently dropped.
                    let raw = event.raw.clone();
                    if let AgentStreamEvent::PermissionRequest {
                        permission_id,
                        tool_name,
                        ..
                    } = bridge_permission_request_event(&raw)
                    {
                        tracing::debug!(
                            rid = %rid,
                            tool = %tool_name,
                            permission_id = %permission_id,
                            "Permission request",
                        );
                    }
                    match turn_session.handle_permission_request(&raw) {
                        Ok(actions) => {
                            for action in actions {
                                actions::apply_action(action, &apply_ctx);
                            }
                        }
                        Err(err) => {
                            tracing::error!(
                                rid = %rid,
                                error = ?err,
                                "permissionRequest transition rejected",
                            );
                        }
                    }
                }
                "planCaptured" => {
                    // Infrastructure-side prep (DB writes + pipeline flush)
                    // stays inline because it needs owned access to the
                    // single-writer DB pool and `&mut MessagePipeline`.
                    // Once prepared, `turn_session.handle_plan_captured`
                    // owns the state mutation (`persisted_exit_plan_review`)
                    // and the Update + PlanCaptured emit sequence.
                    let tool_use_id = event
                        .raw
                        .get("toolUseId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let plan_value = event.raw.get("plan").cloned().unwrap_or(Value::Null);
                    let tool_input = json!({ "plan": plan_value });
                    tracing::debug!(rid = %rid, tool_use_id = %tool_use_id, "Plan captured");

                    if let Some(pipeline_state) = pipeline.as_mut() {
                        pipeline_state.accumulator.flush_pending();

                        let resolved_model =
                            pipeline_state.accumulator.resolved_model().to_string();
                        let pending_turns = (persisted_turn_count
                            ..pipeline_state.accumulator.turns_len())
                            .map(|idx| pipeline_state.accumulator.turn_at(idx).clone())
                            .collect::<Vec<_>>();
                        let persisted_metadata = if let Some(ctx) = exchange_ctx.as_ref() {
                            let ctx_for_db = clone_exchange_context(ctx);
                            let resolved_model_for_db = resolved_model.clone();
                            let tool_use_id_for_db = tool_use_id.clone();
                            let tool_input_for_db = tool_input.clone();
                            let app_for_db = app.clone();
                            match block_on_streaming_db(crate::models::db::libsql_write_async(
                                |conn| async move {
                                    let (turns_persisted, turn_error) =
                                        persist_turn_messages_libsql_with_app(
                                            &conn,
                                            &app_for_db,
                                            &ctx_for_db,
                                            &pending_turns,
                                            &resolved_model_for_db,
                                        )
                                        .await;
                                    let metadata = persist_exit_plan_message_libsql(
                                        &conn,
                                        &ctx_for_db,
                                        &resolved_model_for_db,
                                        &tool_use_id_for_db,
                                        "ExitPlanMode",
                                        &tool_input_for_db,
                                    )
                                    .await;
                                    Ok((
                                        turns_persisted,
                                        turn_error.map(|error| error.to_string()),
                                        metadata.map_err(|error| error.to_string()),
                                    ))
                                },
                            )) {
                                Ok((turns_persisted, turn_error, metadata_result)) => {
                                    persisted_turn_count += turns_persisted;
                                    if let Some(error) = turn_error {
                                        tracing::error!(
                                            rid = %rid,
                                            turn = persisted_turn_count,
                                            "Failed to persist turn: {error}"
                                        );
                                    }
                                    match metadata_result {
                                        Ok(metadata) => Some(metadata),
                                        Err(error) => {
                                            tracing::error!(
                                                rid = %rid,
                                                "Failed to persist exit-plan message: {error}"
                                            );
                                            None
                                        }
                                    }
                                }
                                Err(error) => {
                                    tracing::error!(
                                        rid = %rid,
                                        "Failed to run plan-capture libSQL persistence: {error}"
                                    );
                                    None
                                }
                            }
                        } else {
                            None
                        };
                        let (msg_id, created_at) = persisted_metadata.unwrap_or_default();
                        let plan_message = build_exit_plan_review_message(
                            (!msg_id.is_empty()).then_some(msg_id),
                            (!created_at.is_empty()).then_some(created_at),
                            &tool_use_id,
                            "ExitPlanMode",
                            &tool_input,
                        );

                        let final_messages = pipeline_state.finish();

                        match turn_session.handle_plan_captured(plan_message, final_messages) {
                            Ok(actions) => {
                                for action in actions {
                                    actions::apply_action(action, &apply_ctx);
                                }
                            }
                            Err(err) => {
                                tracing::error!(
                                    rid = %rid,
                                    error = ?err,
                                    "planCaptured transition rejected",
                                );
                            }
                        }
                    } else {
                        // Pipeline was already taken (e.g., terminal
                        // event arrived first). The frontend still gets
                        // the bare PlanCaptured marker so its overlay
                        // doesn't get stuck waiting on it.
                        let _ = on_event.send(AgentStreamEvent::PlanCaptured {});
                    }
                }
                "deferredToolUse" => {
                    // Infrastructure-side prep stays inline (DB writes +
                    // pipeline ownership). The state machine owns the
                    // terminal transition + the Update + DeferredToolUse
                    // emit pair.
                    let mut resolved_model = model_copy.cli_model.to_string();
                    let mut final_messages: Vec<ThreadMessageLike> = Vec::new();

                    if let Some(mut pipeline_state) = pipeline.take() {
                        pipeline_state.accumulator.flush_pending();

                        // Deferred pause is terminal for this stream from the
                        // frontend's perspective. IDs are already stable by
                        // construction (same UUID in `collected[]` and
                        // `CollectedTurn`), so no post-hoc sync is needed.
                        resolved_model = pipeline_state.accumulator.resolved_model().to_string();
                        let pending_turns = (persisted_turn_count
                            ..pipeline_state.accumulator.turns_len())
                            .map(|idx| pipeline_state.accumulator.turn_at(idx).clone())
                            .collect::<Vec<_>>();
                        final_messages = pipeline_state.finish();

                        if let Some(ctx) = exchange_ctx.as_ref() {
                            let ctx_for_db = clone_exchange_context(ctx);
                            let resolved_model_for_db = resolved_model.clone();
                            let effort_for_db = effort_copy.clone();
                            let permission_mode_for_db = turn_session.ctx.permission_mode.clone();
                            let app_for_db = app.clone();
                            match block_on_streaming_db(crate::models::db::libsql_write_async(
                                |conn| async move {
                                    let (turns_persisted, turn_error) =
                                        persist_turn_messages_libsql_with_app(
                                            &conn,
                                            &app_for_db,
                                            &ctx_for_db,
                                            &pending_turns,
                                            &resolved_model_for_db,
                                        )
                                        .await;
                                    let final_error = finalize_session_metadata_libsql(
                                        &conn,
                                        &ctx_for_db,
                                        "idle",
                                        effort_for_db.as_deref(),
                                        permission_mode_for_db.as_deref(),
                                    )
                                    .await
                                    .err()
                                    .map(|error| error.to_string());
                                    Ok((
                                        turns_persisted,
                                        turn_error.map(|error| error.to_string()),
                                        final_error,
                                    ))
                                },
                            )) {
                                Ok((turns_persisted, turn_error, final_error)) => {
                                    persisted_turn_count += turns_persisted;
                                    if let Some(error) = turn_error {
                                        tracing::error!(
                                            rid = %rid,
                                            turn = persisted_turn_count,
                                            "Failed to persist turn: {error}"
                                        );
                                    }
                                    if let Some(error) = final_error {
                                        tracing::error!(
                                            rid = %rid,
                                            "Failed to finalize deferred exchange: {error}"
                                        );
                                    }
                                }
                                Err(error) => {
                                    tracing::error!(
                                        rid = %rid,
                                        "Failed to run deferred libSQL persistence: {error}"
                                    );
                                }
                            }
                        }
                    }

                    match turn_session.handle_deferred_tool_use(
                        &event.raw,
                        &resolved_model,
                        final_messages,
                    ) {
                        Ok(actions) => {
                            for action in actions {
                                actions::apply_action(action, &apply_ctx);
                            }
                        }
                        Err(err) => {
                            tracing::error!(
                                rid = %rid,
                                error = ?err,
                                "deferredToolUse transition rejected",
                            );
                        }
                    }
                    break;
                }
                "permissionModeChanged" => {
                    match turn_session.handle_permission_mode_changed(&event.raw) {
                        Ok(actions) => {
                            for action in actions {
                                actions::apply_action(action, &apply_ctx);
                            }
                        }
                        Err(err) => {
                            tracing::error!(
                                rid = %rid,
                                error = ?err,
                                "permissionModeChanged transition rejected",
                            );
                        }
                    }
                }
                "contextUsageUpdated" => {
                    match turn_session.handle_context_usage_updated(&event.raw) {
                        Ok(actions) => {
                            for action in actions {
                                actions::apply_action(action, &apply_ctx);
                            }
                        }
                        Err(err) => {
                            tracing::error!(
                                rid = %rid,
                                error = ?err,
                                "contextUsageUpdated transition rejected",
                            );
                        }
                    }
                }
                "elicitationRequest" => {
                    let resolved_model = pipeline
                        .as_ref()
                        .map(|state| state.accumulator.resolved_model().to_string())
                        .unwrap_or_else(|| model_copy.cli_model.to_string());
                    match turn_session.handle_elicitation_request(&event.raw, &resolved_model) {
                        Ok(actions) => {
                            for action in actions {
                                actions::apply_action(action, &apply_ctx);
                            }
                        }
                        Err(err) => {
                            tracing::error!(
                                rid = %rid,
                                error = ?err,
                                "elicitationRequest transition rejected",
                            );
                        }
                    }
                }
                "userInputRequest" => {
                    let resolved_model = pipeline
                        .as_ref()
                        .map(|state| state.accumulator.resolved_model().to_string())
                        .unwrap_or_else(|| model_copy.cli_model.to_string());
                    match turn_session.handle_user_input_request(&event.raw, &resolved_model) {
                        Ok(actions) => {
                            for action in actions {
                                actions::apply_action(action, &apply_ctx);
                            }
                        }
                        Err(err) => {
                            tracing::error!(
                                rid = %rid,
                                error = ?err,
                                "userInputRequest transition rejected",
                            );
                        }
                    }
                }
                "kanban_tool_call" => {
                    // Pi Kanban custom tool called — forward directly to
                    // the frontend so the Goals AI panel can execute the
                    // corresponding Tauri IPC and respond via
                    // `send_kanban_tool_result`.
                    let tool_call_id = event
                        .raw
                        .get("toolCallId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let tool = event
                        .raw
                        .get("tool")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let workspace_id = event
                        .raw
                        .get("workspaceId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let args = event.raw.get("args").cloned().unwrap_or(Value::Null);
                    tracing::debug!(
                        rid = %rid,
                        tool = %tool,
                        tool_call_id = %tool_call_id,
                        "Pi custom tool call",
                    );
                    if tool == "delegate_agent" {
                        let (tool_result, is_error) = match execute_delegation_tool_call(
                            app.clone(),
                            sidecar_state.inner(),
                            &tool_call_id,
                            hsid_copy.as_deref(),
                            &provider,
                            parent_prompt_prefix.as_deref(),
                            args,
                        ) {
                            Ok(value) => (value, false),
                            Err(error) => (serde_json::json!({ "error": error.to_string() }), true),
                        };
                        if let Err(error) = send_pi_tool_result(
                            sidecar_state.inner(),
                            &tool_call_id,
                            tool_result,
                            is_error,
                        ) {
                            let user_message = format!(
                                "Failed to complete delegate_agent tool call {tool_call_id}. The parent stream was stopped; you can retry the request."
                            );
                            tracing::error!(
                                rid = %rid,
                                tool_call_id = %tool_call_id,
                                error = ?error,
                                "Failed to send delegate_agent tool result",
                            );
                            let resolved_model = pipeline
                                .as_ref()
                                .map(|p| p.accumulator.resolved_model().to_string())
                                .unwrap_or_else(|| model_copy.cli_model.to_string());
                            let persisted = cleanup_abnormal_stream_exit(
                                &rid,
                                exchange_ctx.as_ref(),
                                &resolved_model,
                                &user_message,
                                effort_copy.as_deref(),
                                turn_session.ctx.permission_mode.as_deref(),
                            );
                            match turn_session.handle_abnormal_exit(
                                state::AbnormalExit::SidecarDisconnected,
                                user_message,
                                persisted,
                            ) {
                                Ok(actions) => {
                                    for action in actions {
                                        actions::apply_action(action, &apply_ctx);
                                    }
                                }
                                Err(err) => {
                                    tracing::error!(
                                        rid = %rid,
                                        error = ?err,
                                        "delegate_agent result failure transition rejected",
                                    );
                                }
                            }
                            break;
                        }
                    } else {
                        // All non-delegate_agent Pi tools are handled in the
                        // backend — no frontend round-trip required.
                        let (tool_result, is_error) = match pi_tools::execute_pi_tool_call(
                            app.clone(),
                            &tool,
                            &args,
                            &workspace_id,
                        ) {
                            Ok(value) => (value, false),
                            Err(error) => {
                                tracing::warn!(
                                    rid = %rid,
                                    tool = %tool,
                                    tool_call_id = %tool_call_id,
                                    error = ?error,
                                    "Pi tool call failed",
                                );
                                (serde_json::json!({ "error": error.to_string() }), true)
                            }
                        };
                        if let Err(error) = send_pi_tool_result(
                            sidecar_state.inner(),
                            &tool_call_id,
                            tool_result,
                            is_error,
                        ) {
                            tracing::error!(
                                rid = %rid,
                                tool_call_id = %tool_call_id,
                                error = ?error,
                                "Failed to send Pi tool result — sidecar may have disconnected",
                            );
                        }
                    }
                }
                "pi_ui_request" => {
                    // Pi extension interactive UI request — forward to the
                    // frontend so the shared conversation surface can render
                    // a picker/input/confirm card and respond via
                    // `respond_to_pi_ui`.
                    let interaction_id = event
                        .raw
                        .get("interactionId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let kind = event
                        .raw
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let payload = event
                        .raw
                        .get("payload")
                        .cloned()
                        .unwrap_or(Value::Object(serde_json::Map::new()));
                    tracing::debug!(
                        rid = %rid,
                        kind = %kind,
                        interaction_id = %interaction_id,
                        "Pi UI request",
                    );
                    let _ = on_event.send(AgentStreamEvent::PiUiRequest {
                        interaction_id,
                        ui_kind: kind,
                        payload,
                    });
                }
                "error" => {
                    // Pre-compute (message, internal) for tracing and DB
                    // writes. Final emit goes through the state machine
                    // so the Terminated transition is recorded; a stray
                    // event after this point is now rejected loudly.
                    let preview = bridge_error_event(&event.raw, false);
                    let (message, internal) = match &preview {
                        AgentStreamEvent::Error {
                            message, internal, ..
                        } => (message.clone(), *internal),
                        _ => unreachable!("bridge_error_event returns Error variant"),
                    };
                    tracing::debug!(rid = %rid, internal, "Sidecar error: {message}");
                    let mut persisted = false;

                    if let Some(ctx) = exchange_ctx.as_ref() {
                        let resolved_model = pipeline
                            .as_ref()
                            .map(|pipeline_state| {
                                pipeline_state.accumulator.resolved_model().to_string()
                            })
                            .unwrap_or_else(|| model_copy.cli_model.to_string());
                        let ctx_for_db = clone_exchange_context(ctx);
                        let effort_for_db = effort_copy.clone();
                        let permission_mode_for_db = turn_session.ctx.permission_mode.clone();
                        match block_on_streaming_db(crate::models::db::libsql_write_async(
                            |conn| async move {
                                let error_persisted = match persist_error_message_libsql(
                                    &conn,
                                    &ctx_for_db,
                                    &resolved_model,
                                    &message,
                                )
                                .await
                                {
                                    Ok(_) => Ok(true),
                                    Err(error) => Err(error.to_string()),
                                };
                                let final_error = finalize_session_metadata_libsql(
                                    &conn,
                                    &ctx_for_db,
                                    "idle",
                                    effort_for_db.as_deref(),
                                    permission_mode_for_db.as_deref(),
                                )
                                .await
                                .err()
                                .map(|error| error.to_string());
                                Ok((error_persisted, final_error))
                            },
                        )) {
                            Ok((error_persisted, final_error)) => {
                                match error_persisted {
                                    Ok(true) => persisted = true,
                                    Ok(false) => {}
                                    Err(error) => {
                                        tracing::error!(
                                            rid = %rid,
                                            "Failed to persist error message: {error}"
                                        );
                                    }
                                }
                                if let Some(error) = final_error {
                                    tracing::error!(rid = %rid, "Failed to finalize error exchange: {error}");
                                }
                            }
                            Err(error) => {
                                tracing::error!(
                                    rid = %rid,
                                    "Failed to run error libSQL persistence: {error}"
                                );
                            }
                        }
                    }

                    tracing::info!(
                        rid = %rid,
                        event_count,
                        heartbeat_count,
                        elapsed_ms = stream_started_at.elapsed().as_millis(),
                        persisted,
                        internal,
                        "stream: error event — finalized"
                    );

                    match turn_session.handle_error(&event.raw, persisted) {
                        Ok(actions) => {
                            for action in actions {
                                actions::apply_action(action, &apply_ctx);
                            }
                        }
                        Err(err) => {
                            tracing::error!(
                                rid = %rid,
                                error = ?err,
                                "error transition rejected",
                            );
                        }
                    }
                    break;
                }
                _ => {
                    // Default arm — covers `stream_event`, `assistant`,
                    // `result`, `system`, etc. The pipeline accumulator
                    // owns the dispatch by event type; the state machine
                    // takes its `PipelineEmit` and decides what to send.
                    let line = serde_json::to_string(&event.raw).unwrap_or_default();
                    if !line.is_empty() && line != "{}" {
                        if let Some(pipeline_state) = pipeline.as_mut() {
                            let emit = pipeline_state.push_event(&event.raw, &line);

                            if let Some(ctx) = exchange_ctx.as_ref() {
                                if let Some(error) = persist_available_turns_libsql(
                                    &app,
                                    pipeline_state,
                                    ctx,
                                    &mut persisted_turn_count,
                                ) {
                                    tracing::error!(
                                        rid = %rid,
                                        turn = persisted_turn_count,
                                        "Failed to persist turn: {error}"
                                    );
                                }
                            }

                            match turn_session.handle_stream_event(emit) {
                                Ok(actions) => {
                                    for action in actions {
                                        actions::apply_action(action, &apply_ctx);
                                    }
                                }
                                Err(err) => {
                                    tracing::error!(
                                        rid = %rid,
                                        error = ?err,
                                        "stream_event transition rejected",
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }

        tracing::info!(
            rid = %rid,
            event_count,
            heartbeat_count,
            persisted_turn_count,
            elapsed_ms = stream_started_at.elapsed().as_millis(),
            "stream: event loop exited, cleaning up subscription"
        );
        sidecar_state.unsubscribe(&rid);
        active_streams_state.unregister(&rid);
    });

    Ok(())
}

fn can_resume_provider_session_for_model(
    stored_provider: Option<&str>,
    stored_model_id: Option<&str>,
    model: &super::ResolvedModel,
) -> bool {
    if stored_provider.unwrap_or_default() != model.provider {
        return false;
    }

    if model.provider != "codex" {
        return true;
    }

    match stored_model_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(stored_model_id) => {
            let stored_model = super::resolve_model(stored_model_id);
            stored_model.provider == "codex"
                && stored_model.codex_profile.as_deref() == model.codex_profile.as_deref()
        }
        None => model.codex_profile.is_none(),
    }
}

fn build_exit_plan_review_message(
    id: Option<String>,
    created_at: Option<String>,
    tool_use_id: &str,
    tool_name: &str,
    tool_input: &Value,
) -> ThreadMessageLike {
    let plan = tool_input
        .get("plan")
        .and_then(Value::as_str)
        .map(str::to_string);
    let plan_file_path = tool_input
        .get("planFilePath")
        .and_then(Value::as_str)
        .map(str::to_string);
    let allowed_prompts = tool_input
        .get("allowedPrompts")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let tool = entry.get("tool").and_then(Value::as_str)?;
                    let prompt = entry.get("prompt").and_then(Value::as_str)?;
                    Some(PlanAllowedPrompt {
                        tool: tool.to_string(),
                        prompt: prompt.to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    ThreadMessageLike {
        role: MessageRole::Assistant,
        id,
        created_at,
        content: vec![ExtendedMessagePart::Basic(MessagePart::PlanReview {
            tool_use_id: tool_use_id.to_string(),
            tool_name: tool_name.to_string(),
            plan,
            plan_file_path,
            allowed_prompts,
        })],
        status: None,
        streaming: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_resume_reuses_default_thread_for_default_model() {
        let model = super::super::resolve_model("gpt-5.5");

        assert!(can_resume_provider_session_for_model(
            Some("codex"),
            Some("gpt-5.4"),
            &model,
        ));
    }

    #[test]
    fn codex_resume_rejects_default_thread_for_profile_model() {
        let model = super::super::resolve_model("codex:azure:gpt-5.5");

        assert!(!can_resume_provider_session_for_model(
            Some("codex"),
            Some("gpt-5.5"),
            &model,
        ));
    }

    #[test]
    fn codex_resume_reuses_profile_thread_for_same_profile() {
        let model = super::super::resolve_model("codex:azure:gpt-5.5");

        assert!(can_resume_provider_session_for_model(
            Some("codex"),
            Some("codex:azure:gpt-5.4"),
            &model,
        ));
    }

    #[test]
    fn codex_resume_rejects_profile_thread_for_different_profile() {
        let model = super::super::resolve_model("codex:azure:gpt-5.5");

        assert!(!can_resume_provider_session_for_model(
            Some("codex"),
            Some("codex:openai:gpt-5.5"),
            &model,
        ));
    }

    #[test]
    fn codex_resume_rejects_legacy_unknown_model_for_profile_model() {
        let model = super::super::resolve_model("codex:azure:gpt-5.5");

        assert!(!can_resume_provider_session_for_model(
            Some("codex"),
            None,
            &model,
        ));
    }

    #[test]
    fn non_codex_resume_still_keys_by_provider() {
        let model = super::super::resolve_model("sonnet");

        assert!(can_resume_provider_session_for_model(
            Some("claude"),
            Some("gpt-5.5"),
            &model,
        ));
        assert!(!can_resume_provider_session_for_model(
            Some("codex"),
            Some("sonnet"),
            &model,
        ));
    }
}
