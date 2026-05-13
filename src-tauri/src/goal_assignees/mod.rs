use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

mod prompt;
mod report;
mod resolver;
mod storage;

use prompt::format_supervisor_update;
pub use prompt::{assignee_bootstrap_prompt, AssigneeBootstrapPromptInput};
pub use report::AssigneeReportMarker;
use report::{latest_report_marker, message_text};
use resolver::{resolve_assignee, resolve_thread_assignee};
use storage::queue_assignee_prompt;

use crate::{pipeline, service, sessions, ui_sync::UiMutationEvent};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAssigneeMessageRequest {
    pub goal_workspace_id: String,
    pub card_id: String,
    pub message: String,
    pub priority: Option<String>,
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendThreadMessageRequest {
    pub goal_workspace_id: String,
    pub workspace_id: String,
    pub thread_id: String,
    pub message: String,
    pub priority: Option<String>,
    pub model_id: Option<String>,
    pub permission_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAssigneeMessageResult {
    pub queued: bool,
    pub started: bool,
    pub execution_state: String,
    pub session_id: String,
    pub workspace_id: String,
    pub pending_send_id: String,
    pub message: String,
    pub supervisor_message_id: Option<String>,
}

pub(crate) struct PreparedAssigneeMessage {
    pub result: SendAssigneeMessageResult,
    pub send_params: service::SendMessageParams,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAssigneeThreadRequest {
    pub goal_workspace_id: String,
    pub card_id: String,
    pub thread_id: Option<String>,
    pub since_message_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRuntimeStatusRequest {
    pub goal_workspace_id: String,
    pub workspace_id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCardAssigneeThreadRequest {
    pub goal_workspace_id: String,
    pub card_id: String,
    pub thread_id: String,
    pub reason: Option<String>,
    pub supersedes_thread_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarizeAssigneeStatusRequest {
    pub goal_workspace_id: String,
    pub card_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAssigneesRequest {
    pub goal_workspace_id: String,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssigneeThreadResult {
    pub card_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub messages: Vec<pipeline::types::ThreadMessageLike>,
    pub latest_report: Option<AssigneeReportMarker>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRuntimeStatus {
    pub thread_id: String,
    pub workspace_id: String,
    pub status: String,
    pub model: Option<String>,
    pub permission_mode: String,
    pub pending_send_id: Option<String>,
    pub provider_session_id: Option<String>,
    pub provider_session_path: Option<String>,
    pub process_state: String,
    pub last_sidecar_event_at: Option<String>,
    pub last_persisted_message_at: Option<String>,
    pub last_error: Option<String>,
    pub first_event_received: bool,
    pub stalled_seconds: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssigneeStatusSummary {
    pub card_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub active_thread_id: String,
    pub thread_count: usize,
    pub assignee_name: String,
    pub session_status: String,
    pub effective_status: String,
    pub latest_report: Option<AssigneeReportMarker>,
    pub stale_threads: Vec<StaleThreadSummary>,
    pub recommended_action: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleThreadSummary {
    pub thread_id: String,
    pub reason: String,
    pub last_message_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCardAssigneeThreadResult {
    pub card_id: String,
    pub workspace_id: String,
    pub active_thread_id: String,
    pub superseded_thread_id: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssigneeSummary {
    pub card_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub title: String,
    pub assignee_name: String,
    pub session_status: String,
    pub latest_report: Option<AssigneeReportMarker>,
}

pub fn send_assignee_message(
    request: SendAssigneeMessageRequest,
) -> Result<SendAssigneeMessageResult> {
    let assignee = resolve_assignee_for_send(&request)?;
    let message = format_supervisor_update(&request.message, request.priority.as_deref())?;
    let queued = queue_assignee_prompt(&assignee, &message)?;
    let started = assignee.session.status != "streaming";

    let _ = crate::ui_sync::notify_running_app(UiMutationEvent::PendingCliSendQueued {
        pending_send_id: queued.pending_send_id.clone(),
        workspace_id: assignee.workspace_id.clone(),
        session_id: assignee.session.id.clone(),
        prompt: message.clone(),
        model_id: assignee.session.model.clone(),
        permission_mode: Some(assignee.session.permission_mode.clone()),
    });

    Ok(SendAssigneeMessageResult {
        queued: true,
        started,
        execution_state: if started { "spawned" } else { "queued" }.to_string(),
        session_id: assignee.session.id,
        workspace_id: assignee.workspace_id,
        pending_send_id: queued.pending_send_id,
        message,
        supervisor_message_id: Some(queued.supervisor_message_id),
    })
}

pub(crate) fn prepare_assignee_message(
    request: SendAssigneeMessageRequest,
) -> Result<PreparedAssigneeMessage> {
    let assignee = resolve_assignee_for_send(&request)?;
    let message = format_supervisor_update(&request.message, request.priority.as_deref())?;
    let task_id = Uuid::new_v4().to_string();
    let result = SendAssigneeMessageResult {
        queued: true,
        started: assignee.session.status != "streaming",
        execution_state: if assignee.session.status == "streaming" {
            "queued"
        } else {
            "spawned"
        }
        .to_string(),
        session_id: assignee.session.id.clone(),
        workspace_id: assignee.workspace_id.clone(),
        pending_send_id: task_id,
        message: message.clone(),
        supervisor_message_id: None,
    };
    let send_params = service::SendMessageParams {
        workspace_ref: assignee.workspace_id,
        session_id: Some(assignee.session.id),
        prompt: message,
        model: assignee.session.model,
        permission_mode: Some(assignee.session.permission_mode),
        linked_directories: Vec::new(),
        delegate_to_running_app: false,
    };

    Ok(PreparedAssigneeMessage {
        result,
        send_params,
    })
}

pub(crate) fn prepare_thread_message(
    request: SendThreadMessageRequest,
) -> Result<PreparedAssigneeMessage> {
    let assignee = resolve_thread_assignee(
        &request.goal_workspace_id,
        &request.workspace_id,
        &request.thread_id,
    )?;
    let message = format_supervisor_update(&request.message, request.priority.as_deref())?;
    let task_id = Uuid::new_v4().to_string();
    let result = SendAssigneeMessageResult {
        queued: true,
        started: assignee.session.status != "streaming",
        execution_state: if assignee.session.status == "streaming" {
            "queued"
        } else {
            "spawned"
        }
        .to_string(),
        session_id: assignee.session.id.clone(),
        workspace_id: assignee.workspace_id.clone(),
        pending_send_id: task_id,
        message: message.clone(),
        supervisor_message_id: None,
    };
    let send_params = service::SendMessageParams {
        workspace_ref: assignee.workspace_id,
        session_id: Some(assignee.session.id),
        prompt: message,
        model: request.model_id.or(assignee.session.model),
        permission_mode: request
            .permission_mode
            .or(Some(assignee.session.permission_mode)),
        linked_directories: Vec::new(),
        delegate_to_running_app: false,
    };

    Ok(PreparedAssigneeMessage {
        result,
        send_params,
    })
}

fn resolve_assignee_for_send(
    request: &SendAssigneeMessageRequest,
) -> Result<resolver::ResolvedAssignee> {
    match request.thread_id.as_deref() {
        Some(thread_id) if !thread_id.trim().is_empty() => {
            resolve_thread_assignee(&request.goal_workspace_id, &request.card_id, thread_id)
        }
        _ => resolve_assignee(&request.goal_workspace_id, &request.card_id),
    }
}

pub fn read_assignee_thread(request: ReadAssigneeThreadRequest) -> Result<AssigneeThreadResult> {
    let assignee = match request.thread_id.as_deref() {
        Some(thread_id) if !thread_id.trim().is_empty() => {
            resolve_thread_assignee(&request.goal_workspace_id, &request.card_id, thread_id)?
        }
        _ => resolve_assignee(&request.goal_workspace_id, &request.card_id)?,
    };
    let messages =
        load_assignee_messages(&assignee.session.id, request.since_message_id.as_deref())?;
    let latest_report = latest_report_marker(&messages);
    Ok(AssigneeThreadResult {
        card_id: assignee.card_id,
        workspace_id: assignee.workspace_id,
        session_id: assignee.session.id,
        messages,
        latest_report,
    })
}

pub fn get_thread_runtime_status(
    request: ThreadRuntimeStatusRequest,
) -> Result<ThreadRuntimeStatus> {
    let assignee = resolve_thread_assignee(
        &request.goal_workspace_id,
        &request.workspace_id,
        &request.thread_id,
    )?;
    let runtime = crate::background_agents::get_runtime_status(&assignee.session.id);
    let conn = crate::models::db::read_conn()?;
    let last_persisted_message_at: Option<String> = conn
        .query_row(
            "SELECT MAX(created_at) FROM session_messages WHERE session_id = ?1",
            rusqlite::params![assignee.session.id],
            |row| row.get(0),
        )
        .unwrap_or(None);
    let stalled_seconds = streaming_stall_seconds(
        &assignee.session,
        runtime.last_sidecar_event_at.as_deref(),
        last_persisted_message_at.as_deref(),
    );

    Ok(ThreadRuntimeStatus {
        thread_id: assignee.session.id,
        workspace_id: assignee.workspace_id,
        status: assignee.session.status,
        model: assignee.session.model,
        permission_mode: assignee.session.permission_mode,
        pending_send_id: runtime.pending_send_id,
        provider_session_id: assignee.session.provider_session_id.clone(),
        provider_session_path: assignee
            .session
            .provider_session_id
            .as_ref()
            .map(|id| format!("~/.pi/agent/sessions/.../{id}.jsonl")),
        process_state: runtime.process_state,
        last_sidecar_event_at: runtime.last_sidecar_event_at,
        last_persisted_message_at,
        last_error: runtime.last_error,
        first_event_received: runtime.first_event_received,
        stalled_seconds,
    })
}

pub fn set_card_assignee_thread(
    request: SetCardAssigneeThreadRequest,
) -> Result<SetCardAssigneeThreadResult> {
    let new_assignee = resolve_thread_assignee(
        &request.goal_workspace_id,
        &request.card_id,
        &request.thread_id,
    )?;
    let previous_assignee = resolve_assignee(&request.goal_workspace_id, &request.card_id).ok();
    let superseded_thread_id = request
        .supersedes_thread_id
        .clone()
        .or_else(|| {
            previous_assignee
                .as_ref()
                .map(|assignee| assignee.session.id.clone())
        })
        .filter(|thread_id| thread_id != &new_assignee.session.id);

    let conn = crate::models::db::write_conn()?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE workspaces SET active_session_id = ?2 WHERE id = ?1",
        rusqlite::params![new_assignee.workspace_id, new_assignee.session.id],
    )
    .with_context(|| {
        format!(
            "Failed to set active assignee thread for workspace {}",
            new_assignee.workspace_id
        )
    })?;
    tx.execute(
        "UPDATE sessions SET thread_role = 'assignee', thread_status = 'active', stale_reason = NULL WHERE id = ?1",
        rusqlite::params![new_assignee.session.id],
    )
    .with_context(|| format!("Failed to mark thread {} active", new_assignee.session.id))?;
    if let Some(thread_id) = superseded_thread_id.as_deref() {
        tx.execute(
            "UPDATE sessions SET thread_status = 'superseded', stale_reason = ?2 WHERE id = ?1",
            rusqlite::params![thread_id, request.reason],
        )
        .with_context(|| format!("Failed to mark thread {thread_id} superseded"))?;
        tx.execute(
            "UPDATE sessions SET supersedes_thread_id = ?2 WHERE id = ?1",
            rusqlite::params![new_assignee.session.id, thread_id],
        )
        .with_context(|| format!("Failed to link superseded thread {thread_id}"))?;
    }
    tx.commit()?;

    Ok(SetCardAssigneeThreadResult {
        card_id: new_assignee.card_id,
        workspace_id: new_assignee.workspace_id,
        active_thread_id: new_assignee.session.id,
        superseded_thread_id,
        reason: request.reason,
    })
}

pub fn summarize_assignee_status(
    request: SummarizeAssigneeStatusRequest,
) -> Result<AssigneeStatusSummary> {
    let assignee = resolve_assignee(&request.goal_workspace_id, &request.card_id)?;
    let sessions = sessions::list_workspace_sessions(&assignee.workspace_id)?;
    let messages = load_assignee_messages(&assignee.session.id, None)?;
    let latest_report = latest_report_marker(&messages);
    let stale_threads = detect_stale_threads(&sessions, &assignee.session.id)?;
    let effective_status = latest_report
        .as_ref()
        .map(|report| report.report_type.clone())
        .or_else(|| assignee.session.thread_status.clone())
        .unwrap_or_else(|| assignee.session.status.clone());
    let recommended_action = if effective_status == "blocked" {
        "Read the blocker and either answer it or start a replacement thread if the issue is unrecoverable."
            .to_string()
    } else if !stale_threads.is_empty() {
        "Continue supervising the active thread and avoid sending follow-ups to stale or superseded threads."
            .to_string()
    } else if latest_report.is_none() {
        "Inspect the active thread before reporting progress; no milestone report has been posted yet."
            .to_string()
    } else {
        "Continue normal supervision on the active assignee thread.".to_string()
    };
    let summary = latest_report
        .as_ref()
        .map(|report| format!("{}: {}", report.report_type, report.excerpt))
        .unwrap_or_else(|| "No milestone report found yet.".to_string());

    Ok(AssigneeStatusSummary {
        card_id: assignee.card_id,
        workspace_id: assignee.workspace_id,
        assignee_name: assignee_name(&assignee.session),
        active_thread_id: assignee.session.id.clone(),
        session_id: assignee.session.id,
        thread_count: sessions.len(),
        session_status: assignee.session.status,
        effective_status,
        latest_report,
        stale_threads,
        recommended_action,
        summary,
    })
}

pub fn list_assignees(request: ListAssigneesRequest) -> Result<Vec<AssigneeSummary>> {
    let workspaces = crate::workspaces::list_goal_child_workspaces(&request.goal_workspace_id)?;
    let status_filter = request
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let mut out = Vec::new();

    for workspace in workspaces {
        let Ok(assignee) = resolve_assignee(&request.goal_workspace_id, &workspace.id) else {
            continue;
        };
        let messages = load_assignee_messages(&assignee.session.id, None).with_context(|| {
            format!(
                "Failed to load assignee messages for session {}",
                assignee.session.id
            )
        })?;
        let latest_report = latest_report_marker(&messages);
        let effective_status = latest_report
            .as_ref()
            .map(|report| report.report_type.as_str())
            .unwrap_or(assignee.session.status.as_str())
            .to_lowercase();

        if let Some(filter) = status_filter.as_deref() {
            if effective_status != filter && assignee.session.status.to_lowercase() != filter {
                continue;
            }
        }

        out.push(AssigneeSummary {
            card_id: workspace.id.clone(),
            workspace_id: assignee.workspace_id,
            session_id: assignee.session.id.clone(),
            title: workspace.title,
            assignee_name: assignee_name(&assignee.session),
            session_status: assignee.session.status,
            latest_report,
        });
    }

    Ok(out)
}

fn load_assignee_messages(
    session_id: &str,
    since_message_id: Option<&str>,
) -> Result<Vec<pipeline::types::ThreadMessageLike>> {
    let historical = sessions::list_session_historical_records(session_id)?;
    let mut messages = pipeline::MessagePipeline::convert_historical(&historical);
    if let Some(since_message_id) = since_message_id {
        if let Some(index) = messages
            .iter()
            .position(|message| message.id.as_deref() == Some(since_message_id))
        {
            messages = messages.into_iter().skip(index + 1).collect();
        }
    }
    Ok(messages)
}

fn streaming_stall_seconds(
    session: &sessions::WorkspaceSessionSummary,
    last_sidecar_event_at: Option<&str>,
    last_persisted_message_at: Option<&str>,
) -> Option<i64> {
    if session.status != "streaming" || last_sidecar_event_at.is_some() {
        return None;
    }
    let started_at = session
        .last_user_message_at
        .as_deref()
        .or(last_persisted_message_at)
        .or(Some(session.updated_at.as_str()))?;
    let started_at = chrono::DateTime::parse_from_rfc3339(started_at)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))?;
    Some((chrono::Utc::now() - started_at).num_seconds().max(0))
}

fn detect_stale_threads(
    sessions: &[sessions::WorkspaceSessionSummary],
    active_thread_id: &str,
) -> Result<Vec<StaleThreadSummary>> {
    let mut stale_threads = Vec::new();
    for session in sessions {
        let messages = load_assignee_messages(&session.id, None)?;
        let explicit_reason = match session.thread_status.as_deref() {
            Some("stale" | "superseded" | "blocked") => session
                .stale_reason
                .clone()
                .or_else(|| session.thread_status.clone()),
            _ => None,
        };
        let detected_reason = detect_stale_reason(session, &messages, active_thread_id);
        if let Some(reason) = explicit_reason.or(detected_reason) {
            stale_threads.push(StaleThreadSummary {
                thread_id: session.id.clone(),
                reason,
                last_message_at: messages
                    .last()
                    .and_then(|message| message.created_at.clone())
                    .or_else(|| session.last_user_message_at.clone())
                    .or_else(|| Some(session.updated_at.clone())),
            });
        }
    }
    Ok(stale_threads)
}

fn detect_stale_reason(
    session: &sessions::WorkspaceSessionSummary,
    messages: &[pipeline::types::ThreadMessageLike],
    active_thread_id: &str,
) -> Option<String> {
    if session.id != active_thread_id && session.thread_status.as_deref() == Some("active") {
        return Some("superseded by active assignee thread".to_string());
    }
    let latest_assistant_text = messages
        .iter()
        .rev()
        .find(|message| message.role == pipeline::types::MessageRole::Assistant)
        .map(message_text)
        .unwrap_or_default()
        .to_lowercase();
    for needle in [
        "model access",
        "model not found",
        "provider auth",
        "authentication failed",
        "permission denied",
        "startup failure",
        "failed to start",
    ] {
        if latest_assistant_text.contains(needle) {
            return Some(format!("latest assistant response indicates {needle}"));
        }
    }
    if session.status == "failed" {
        return Some("session failed".to_string());
    }
    None
}

fn assignee_name(session: &sessions::WorkspaceSessionSummary) -> String {
    session
        .agent_type
        .clone()
        .or_else(|| session.model.clone())
        .unwrap_or_else(|| "assignee".to_string())
}
