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

pub fn enqueue(app: AppHandle, params: SendMessageParams) -> Result<BackgroundSendReceipt> {
    let workspace_id = service::resolve_workspace_ref(&params.workspace_ref)?;
    let session_id = params
        .session_id
        .clone()
        .context("Background agent sends require an explicit session_id")?;
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

    let streaming = session_is_streaming(&session_id).unwrap_or(false);
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

        publish_session_changed(&app, &send.workspace_id, &send.session_id);

        let workspace_id = send.workspace_id.clone();
        let session_id = send.session_id.clone();
        let mut on_event = |event: &AgentStreamEvent| {
            publish_event(&app, &workspace_id, &session_id, event);
        };

        if let Err(error) = service::send_message(send.params, &mut on_event) {
            tracing::error!(
                task_id = %send.task_id,
                workspace_id = %workspace_id,
                session_id = %session_id,
                error = ?error,
                "background agent send failed"
            );
            publish_session_changed(&app, &workspace_id, &session_id);
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
        publish_session_changed(app, workspace_id, session_id);
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
