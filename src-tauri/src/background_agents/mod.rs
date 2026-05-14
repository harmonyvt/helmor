use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Mutex, OnceLock};

use anyhow::{Context, Result};
use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::AppHandle;
use uuid::Uuid;

use crate::{
    agents::AgentStreamEvent,
    service::{self, SendMessageParams},
    ui_sync::{self, UiMutationEvent},
};

static SESSION_QUEUES: OnceLock<Mutex<HashMap<String, VecDeque<QueuedSend>>>> = OnceLock::new();
static SESSION_RUNNING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static SESSION_WAITING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static SESSION_RUNTIME: OnceLock<Mutex<HashMap<String, RuntimeTelemetry>>> = OnceLock::new();
mod progress;

#[derive(Debug, Clone)]
struct QueuedSend {
    task_id: String,
    workspace_id: String,
    session_id: String,
    params: SendMessageParams,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundSendReceipt {
    pub task_id: String,
    pub started: bool,
    pub execution_state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundRuntimeStatus {
    pub pending_send_id: Option<String>,
    pub process_state: String,
    pub last_sidecar_event_at: Option<String>,
    pub first_event_received: bool,
    pub terminal_event_seen: bool,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone)]
struct RuntimeTelemetry {
    pending_send_id: Option<String>,
    process_state: String,
    last_sidecar_event_at: Option<String>,
    first_event_received: bool,
    terminal_event_seen: bool,
    last_error: Option<String>,
}

pub fn enqueue(app: AppHandle, params: SendMessageParams) -> Result<BackgroundSendReceipt> {
    let workspace_id = service::resolve_workspace_ref(&params.workspace_ref)?;
    let session_id = params
        .session_id
        .clone()
        .context("Background agent sends require an explicit session_id")?;
    let streaming = session_is_streaming(&session_id).unwrap_or(false);
    let send_model_id = params.model.clone();
    let send_permission_mode = params.permission_mode.clone();
    let task_id = Uuid::new_v4().to_string();
    let queued = QueuedSend {
        task_id: task_id.clone(),
        workspace_id,
        session_id: session_id.clone(),
        params: SendMessageParams {
            delegate_to_running_app: false,
            ..params
        },
    };

    let should_start = {
        let queues = SESSION_QUEUES.get_or_init(|| Mutex::new(HashMap::new()));
        let running = SESSION_RUNNING.get_or_init(|| Mutex::new(HashSet::new()));
        let mut running = running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut queues = queues
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let queue = queues.entry(session_id.clone()).or_default();
        let should_start = queue.is_empty() && !running.contains(&session_id) && !streaming;
        queue.push_back(queued);
        if should_start {
            running.insert(session_id.clone());
        }
        should_start
    };

    if should_start {
        let model_id = send_model_id.unwrap_or_else(|| {
            crate::models::sessions::get_session_model(&session_id)
                .ok()
                .flatten()
                .unwrap_or_else(|| "default".to_string())
        });
        let model = crate::agents::resolve_model(&model_id);
        if let Err(error) = crate::models::sessions::record_session_send_start_metadata(
            &session_id,
            &model.id,
            &model.provider,
            send_permission_mode.as_deref(),
        ) {
            remove_queued_send(&session_id, &task_id);
            return Err(error);
        }
    }

    remember_runtime(
        &session_id,
        RuntimeTelemetry {
            pending_send_id: Some(task_id.clone()),
            process_state: if should_start { "spawned" } else { "queued" }.to_string(),
            last_sidecar_event_at: None,
            first_event_received: false,
            terminal_event_seen: false,
            last_error: None,
        },
    );

    if should_start {
        spawn_next(app, task_id.clone());
    } else if streaming {
        spawn_when_idle(app, session_id);
    }

    Ok(BackgroundSendReceipt {
        task_id,
        started: should_start,
        execution_state: if should_start { "spawned" } else { "queued" },
    })
}

fn spawn_when_idle(app: AppHandle, session_id: String) {
    let should_spawn_waiter = {
        let waiting = SESSION_WAITING.get_or_init(|| Mutex::new(HashSet::new()));
        let mut waiting = waiting
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        waiting.insert(session_id.clone())
    };
    if !should_spawn_waiter {
        return;
    }

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if session_is_streaming(&session_id).unwrap_or(false) {
                continue;
            }

            let next_task_id = {
                let queues = SESSION_QUEUES.get_or_init(|| Mutex::new(HashMap::new()));
                let running = SESSION_RUNNING.get_or_init(|| Mutex::new(HashSet::new()));
                let mut running = running
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if running.contains(&session_id) {
                    continue;
                }
                let queues = queues
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let next = queues
                    .get(&session_id)
                    .and_then(|queue| queue.front())
                    .map(|send| send.task_id.clone());
                if next.is_some() {
                    running.insert(session_id.clone());
                }
                next
            };

            let waiting = SESSION_WAITING.get_or_init(|| Mutex::new(HashSet::new()));
            waiting
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&session_id);

            if let Some(task_id) = next_task_id {
                spawn_next(app, task_id);
            }
            break;
        }
    });
}

fn spawn_next(app: AppHandle, expected_task_id: String) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(send) = pop_expected(&expected_task_id) else {
            return;
        };

        remember_runtime(
            &send.session_id,
            RuntimeTelemetry {
                pending_send_id: Some(send.task_id.clone()),
                process_state: "running".to_string(),
                last_sidecar_event_at: None,
                first_event_received: false,
                terminal_event_seen: false,
                last_error: None,
            },
        );

        publish_session_changed(&app, &send.workspace_id, &send.session_id);

        let workspace_id = send.workspace_id.clone();
        let session_id = send.session_id.clone();
        let mut on_event = |event: &AgentStreamEvent| {
            remember_runtime_event(&session_id, event);
            publish_event(&app, &workspace_id, &session_id, event);
        };

        match service::send_message(send.params, &mut on_event) {
            Ok(result) => {
                if !result.persisted {
                    let _ = crate::goal_assignees::notify_runtime_issue_for_session(
                        &session_id,
                        "persist_failed",
                        "Provider completed, but one or more Helmor DB writes failed.",
                    );
                } else if result.agent_started {
                    let _ = crate::goal_assignees::maybe_notify_missing_report_after_terminal(
                        &session_id,
                    );
                }
            }
            Err(error) => {
                remember_runtime_error(&session_id, &error.to_string());
                let _ = crate::goal_assignees::notify_runtime_issue_for_session(
                    &session_id,
                    "background_send_failed",
                    &format!("Background agent send failed: {error}"),
                );
                tracing::error!(
                    task_id = %send.task_id,
                    workspace_id = %workspace_id,
                    session_id = %session_id,
                    error = ?error,
                    "background agent send failed"
                );
                publish_session_changed(&app, &workspace_id, &session_id);
            }
        }

        maybe_spawn_followup(app, session_id);
    });
}

fn pop_expected(expected_task_id: &str) -> Option<QueuedSend> {
    let queues = SESSION_QUEUES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut queues = queues
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let session_id = queues.iter().find_map(|(session_id, queue)| {
        queue
            .front()
            .is_some_and(|send| send.task_id == expected_task_id)
            .then(|| session_id.clone())
    })?;
    queues.get_mut(&session_id)?.pop_front()
}

fn remove_queued_send(session_id: &str, task_id: &str) {
    let queues = SESSION_QUEUES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut queues = queues
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(queue) = queues.get_mut(session_id) {
        queue.retain(|send| send.task_id != task_id);
        if queue.is_empty() {
            queues.remove(session_id);
        }
    }
    drop(queues);

    let running = SESSION_RUNNING.get_or_init(|| Mutex::new(HashSet::new()));
    running
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(session_id);
}

fn maybe_spawn_followup(app: AppHandle, session_id: String) {
    let next_task_id = {
        let queues = SESSION_QUEUES.get_or_init(|| Mutex::new(HashMap::new()));
        let mut queues = queues
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(queue) = queues.get_mut(&session_id) else {
            return;
        };
        let next = queue.front().map(|send| send.task_id.clone());
        if queue.is_empty() {
            queues.remove(&session_id);
        }
        next
    };

    if let Some(task_id) = next_task_id {
        spawn_next(app, task_id);
    } else {
        let running = SESSION_RUNNING.get_or_init(|| Mutex::new(HashSet::new()));
        let mut running = running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        running.remove(&session_id);
        settle_runtime_after_send(&session_id);
    }
}

pub fn get_runtime_status(session_id: &str) -> BackgroundRuntimeStatus {
    let runtime = SESSION_RUNTIME.get_or_init(|| Mutex::new(HashMap::new()));
    let telemetry = runtime
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(session_id)
        .cloned();
    let process_state = telemetry
        .as_ref()
        .map(|status| status.process_state.clone())
        .unwrap_or_else(|| "unknown".to_string());
    BackgroundRuntimeStatus {
        pending_send_id: telemetry
            .as_ref()
            .and_then(|status| status.pending_send_id.clone()),
        process_state,
        last_sidecar_event_at: telemetry
            .as_ref()
            .and_then(|status| status.last_sidecar_event_at.clone()),
        first_event_received: telemetry
            .as_ref()
            .is_some_and(|status| status.first_event_received),
        terminal_event_seen: telemetry
            .as_ref()
            .is_some_and(|status| status.terminal_event_seen),
        last_error: telemetry.and_then(|status| status.last_error),
    }
}

fn remember_runtime(session_id: &str, telemetry: RuntimeTelemetry) {
    let runtime = SESSION_RUNTIME.get_or_init(|| Mutex::new(HashMap::new()));
    runtime
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(session_id.to_string(), telemetry);
}

fn remember_runtime_event(session_id: &str, event: &AgentStreamEvent) {
    let runtime = SESSION_RUNTIME.get_or_init(|| Mutex::new(HashMap::new()));
    let mut runtime = runtime
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let telemetry = runtime
        .entry(session_id.to_string())
        .or_insert_with(|| RuntimeTelemetry {
            pending_send_id: None,
            process_state: "running".to_string(),
            last_sidecar_event_at: None,
            first_event_received: false,
            terminal_event_seen: false,
            last_error: None,
        });
    telemetry.last_sidecar_event_at = crate::models::db::current_timestamp().ok();
    telemetry.first_event_received = true;
    match event {
        AgentStreamEvent::Done { persisted, .. } => {
            telemetry.terminal_event_seen = true;
            if *persisted {
                telemetry.process_state = "provider_completed".to_string();
                telemetry.last_error = None;
            } else {
                telemetry.process_state = "failed_persist".to_string();
                telemetry.last_error = Some(
                    "Provider completed, but one or more Helmor DB writes failed.".to_string(),
                );
            }
        }
        AgentStreamEvent::Aborted { persisted, .. } => {
            telemetry.terminal_event_seen = true;
            telemetry.process_state = if *persisted {
                "aborted".to_string()
            } else {
                "failed_persist".to_string()
            };
            if !*persisted {
                telemetry.last_error =
                    Some("Provider aborted, but one or more Helmor DB writes failed.".to_string());
            } else {
                telemetry.last_error = None;
            }
        }
        AgentStreamEvent::Error { message, .. } => {
            telemetry.terminal_event_seen = true;
            telemetry.process_state = "failed".to_string();
            telemetry.last_error = Some(message.clone());
        }
        _ => telemetry.process_state = "running".to_string(),
    }
}

fn remember_runtime_error(session_id: &str, error: &str) {
    let runtime = SESSION_RUNTIME.get_or_init(|| Mutex::new(HashMap::new()));
    let mut runtime = runtime
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let telemetry = runtime
        .entry(session_id.to_string())
        .or_insert_with(|| RuntimeTelemetry {
            pending_send_id: None,
            process_state: "failed".to_string(),
            last_sidecar_event_at: None,
            first_event_received: false,
            terminal_event_seen: true,
            last_error: None,
        });
    telemetry.process_state = "failed".to_string();
    telemetry.terminal_event_seen = true;
    telemetry.last_error = Some(error.to_string());
}

fn settle_runtime_after_send(session_id: &str) {
    let runtime = SESSION_RUNTIME.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(telemetry) = runtime
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get_mut(session_id)
    {
        if telemetry.process_state == "provider_completed" {
            telemetry.process_state = "completed".to_string();
        } else if !matches!(
            telemetry.process_state.as_str(),
            "completed" | "aborted" | "failed" | "failed_persist"
        ) {
            telemetry.process_state = "idle".to_string();
        }
    }
}

fn session_is_streaming(session_id: &str) -> Result<bool> {
    let conn = crate::models::db::read_conn()?;
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(status.as_deref() == Some("streaming"))
}

fn publish_event(app: &AppHandle, workspace_id: &str, session_id: &str, event: &AgentStreamEvent) {
    if progress::should_publish_event(session_id, event) {
        match event {
            AgentStreamEvent::Update { .. } | AgentStreamEvent::StreamingPartial { .. } => {
                if let Ok(value) = serde_json::to_value(event) {
                    ui_sync::publish(
                        app,
                        UiMutationEvent::SessionStreamEvent {
                            workspace_id: workspace_id.to_string(),
                            session_id: session_id.to_string(),
                            event: value,
                        },
                    );
                }
                publish_session_list_changed(app, workspace_id);
            }
            _ => publish_session_changed(app, workspace_id, session_id),
        }
    }
}

fn publish_session_changed(app: &AppHandle, workspace_id: &str, session_id: &str) {
    ui_sync::publish(
        app,
        UiMutationEvent::SessionMessagesChanged {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
        },
    );
    publish_session_list_changed(app, workspace_id);
}

fn publish_session_list_changed(app: &AppHandle, workspace_id: &str) {
    ui_sync::publish(
        app,
        UiMutationEvent::SessionListChanged {
            workspace_id: workspace_id.to_string(),
        },
    );
    ui_sync::publish(
        app,
        UiMutationEvent::WorkspaceChanged {
            workspace_id: workspace_id.to_string(),
        },
    );
    if let Ok(Some(goal_workspace_id)) = goal_workspace_id_for_child(workspace_id) {
        ui_sync::publish(
            app,
            UiMutationEvent::WorkspaceChanged {
                workspace_id: goal_workspace_id,
            },
        );
    }
}

fn goal_workspace_id_for_child(workspace_id: &str) -> Result<Option<String>> {
    let conn = crate::models::db::read_conn()?;
    Ok(conn
        .query_row(
            "SELECT goal_workspace_id FROM workspaces WHERE id = ?1",
            [workspace_id],
            |row| row.get(0),
        )
        .optional()?)
}
