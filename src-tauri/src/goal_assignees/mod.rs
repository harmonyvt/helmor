use std::future::Future;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

mod notifications;
mod prompt;
mod report;
mod resolver;
mod storage;

#[cfg(test)]
pub(crate) use notifications::maybe_deliver_assignee_report;
#[cfg(test)]
pub(crate) use notifications::notify_runtime_issue_for_session;
pub(crate) use notifications::{
    maybe_deliver_assignee_report_libsql_with_app,
    maybe_notify_missing_report_after_terminal_with_app, notify_runtime_issue_for_session_with_app,
};
use prompt::format_supervisor_update;
pub use prompt::{assignee_bootstrap_prompt, AssigneeBootstrapPromptInput};
pub use report::AssigneeReportMarker;
use report::{latest_report_marker, message_text};
use resolver::{resolve_assignee, resolve_thread_assignee};
use storage::{persist_assignee_run_prompt, queue_assignee_prompt};

use crate::{pipeline, service, sessions, ui_sync::UiMutationEvent};

fn block_on_goal_assignee_db<T>(future: impl Future<Output = Result<T>>) -> Result<T> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(future)),
        Err(_) => tauri::async_runtime::block_on(future),
    }
}

async fn run_goal_assignee_blocking<F, T>(f: F) -> Result<T>
where
    F: FnOnce() -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|error| anyhow::anyhow!("goal assignee blocking task failed: {error}"))?
}

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
    /// Durable run ID from `goal_assignee_runs`. Supersedes the legacy `pendingSendId` name.
    pub run_id: String,
    pub message: String,
    pub supervisor_message_id: Option<String>,
}

pub(crate) struct PreparedAssigneeMessage {
    pub result: SendAssigneeMessageResult,
    pub send_params: service::SendMessageParams,
    pub goal_workspace_id: String,
    pub run_id: String,
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
    pub persisted_message_count: i64,
    pub persistence_state: String,
    pub last_error: Option<String>,
    pub first_event_received: bool,
    pub terminal_event_seen: bool,
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
pub struct AssigneeRunSummary {
    pub run_id: String,
    pub status: String,
    pub prompt: String,
    pub model_id: Option<String>,
    pub permission_mode: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub last_event_at: Option<String>,
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
    /// Status of the most-recently created run (`queued`, `running`, `completed`, `failed`).
    pub active_run_status: Option<String>,
    /// Error from the last failed run, if any.
    pub last_run_error: Option<String>,
    /// Number of runs in `queued` state for this assignee session.
    pub pending_run_count: i64,
    /// Most-recent durable scheduler/background run for this assignee session.
    pub latest_run: Option<AssigneeRunSummary>,
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
        run_id: queued.pending_send_id,
        message,
        supervisor_message_id: Some(queued.supervisor_message_id),
    })
}

pub(crate) fn prepare_assignee_message(
    request: SendAssigneeMessageRequest,
) -> Result<PreparedAssigneeMessage> {
    let assignee = resolve_assignee_for_send(&request)?;
    let message = format_supervisor_update(&request.message, request.priority.as_deref())?;
    let persisted = persist_assignee_run_prompt(
        &request.goal_workspace_id,
        &assignee,
        &message,
        assignee.session.model.as_deref(),
        Some(assignee.session.permission_mode.as_str()),
    )?;
    let result = SendAssigneeMessageResult {
        queued: true,
        started: false,
        execution_state: "queued".to_string(),
        session_id: assignee.session.id.clone(),
        workspace_id: assignee.workspace_id.clone(),
        run_id: persisted.run_id.clone(),
        message: message.clone(),
        supervisor_message_id: Some(persisted.supervisor_message_id),
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
        goal_workspace_id: request.goal_workspace_id,
        run_id: persisted.run_id,
    })
}

pub(crate) async fn prepare_assignee_message_async(
    request: SendAssigneeMessageRequest,
) -> Result<PreparedAssigneeMessage> {
    run_goal_assignee_blocking(move || prepare_assignee_message(request)).await
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
    let model = request.model_id.or(assignee.session.model.clone());
    let permission_mode = request
        .permission_mode
        .or(Some(assignee.session.permission_mode.clone()));
    let persisted = persist_assignee_run_prompt(
        &request.goal_workspace_id,
        &assignee,
        &message,
        model.as_deref(),
        permission_mode.as_deref(),
    )?;
    let result = SendAssigneeMessageResult {
        queued: true,
        started: false,
        execution_state: "queued".to_string(),
        session_id: assignee.session.id.clone(),
        workspace_id: assignee.workspace_id.clone(),
        run_id: persisted.run_id.clone(),
        message: message.clone(),
        supervisor_message_id: Some(persisted.supervisor_message_id),
    };
    let send_params = service::SendMessageParams {
        workspace_ref: assignee.workspace_id,
        session_id: Some(assignee.session.id),
        prompt: message,
        model,
        permission_mode,
        linked_directories: Vec::new(),
        delegate_to_running_app: false,
    };

    Ok(PreparedAssigneeMessage {
        result,
        send_params,
        goal_workspace_id: request.goal_workspace_id,
        run_id: persisted.run_id,
    })
}

pub(crate) async fn prepare_thread_message_async(
    request: SendThreadMessageRequest,
) -> Result<PreparedAssigneeMessage> {
    run_goal_assignee_blocking(move || prepare_thread_message(request)).await
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
    block_on_goal_assignee_db(read_assignee_thread_async(request))
}

pub async fn read_assignee_thread_async(
    request: ReadAssigneeThreadRequest,
) -> Result<AssigneeThreadResult> {
    let goal_workspace_id = request.goal_workspace_id.clone();
    let card_id = request.card_id.clone();
    let thread_id = request.thread_id.clone();
    let assignee = run_goal_assignee_blocking(move || match thread_id.as_deref() {
        Some(thread_id) if !thread_id.trim().is_empty() => {
            resolve_thread_assignee(&goal_workspace_id, &card_id, thread_id)
        }
        _ => resolve_assignee(&goal_workspace_id, &card_id),
    })
    .await?;
    let messages =
        load_assignee_messages_async(&assignee.session.id, request.since_message_id.as_deref())
            .await?;
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
    block_on_goal_assignee_db(get_thread_runtime_status_async(request))
}

pub async fn get_thread_runtime_status_async(
    request: ThreadRuntimeStatusRequest,
) -> Result<ThreadRuntimeStatus> {
    let goal_workspace_id = request.goal_workspace_id.clone();
    let workspace_id = request.workspace_id.clone();
    let thread_id = request.thread_id.clone();
    let assignee = run_goal_assignee_blocking(move || {
        resolve_thread_assignee(&goal_workspace_id, &workspace_id, &thread_id)
    })
    .await?;
    let runtime = crate::background_agents::get_runtime_status(&assignee.session.id);
    let last_persisted_message_at = last_persisted_message_at_async(&assignee.session.id)
        .await
        .unwrap_or(None);
    let persisted_message_count = persisted_message_count_async(&assignee.session.id)
        .await
        .unwrap_or(0);
    let stalled_seconds = streaming_stall_seconds(
        &assignee.session,
        runtime.last_sidecar_event_at.as_deref(),
        last_persisted_message_at.as_deref(),
    );
    let persistence_state = classify_persistence_state(
        &assignee.session.status,
        &runtime.process_state,
        runtime.terminal_event_seen,
        runtime.last_error.as_deref(),
        persisted_message_count,
    );

    Ok(ThreadRuntimeStatus {
        thread_id: assignee.session.id,
        workspace_id: assignee.workspace_id,
        status: assignee.session.status,
        model: assignee.session.model,
        permission_mode: assignee.session.permission_mode,
        pending_send_id: runtime.pending_send_id,
        provider_session_id: assignee.session.provider_session_id.clone(),
        provider_session_path: provider_session_path(
            assignee.session.provider_session_id.as_deref(),
        ),
        process_state: runtime.process_state,
        last_sidecar_event_at: runtime.last_sidecar_event_at,
        last_persisted_message_at,
        persisted_message_count,
        persistence_state,
        last_error: runtime.last_error,
        first_event_received: runtime.first_event_received,
        terminal_event_seen: runtime.terminal_event_seen,
        stalled_seconds,
    })
}

pub fn set_card_assignee_thread(
    request: SetCardAssigneeThreadRequest,
) -> Result<SetCardAssigneeThreadResult> {
    block_on_goal_assignee_db(set_card_assignee_thread_async(request))
}

pub async fn set_card_assignee_thread_async(
    request: SetCardAssigneeThreadRequest,
) -> Result<SetCardAssigneeThreadResult> {
    let request_for_resolve = request.clone();
    let (new_assignee, previous_assignee) = run_goal_assignee_blocking(move || {
        let new_assignee = resolve_thread_assignee(
            &request_for_resolve.goal_workspace_id,
            &request_for_resolve.card_id,
            &request_for_resolve.thread_id,
        )?;
        let previous_assignee = resolve_assignee(
            &request_for_resolve.goal_workspace_id,
            &request_for_resolve.card_id,
        )
        .ok();
        Ok((new_assignee, previous_assignee))
    })
    .await?;
    let superseded_thread_id = request
        .supersedes_thread_id
        .clone()
        .or_else(|| {
            previous_assignee
                .as_ref()
                .map(|assignee| assignee.session.id.clone())
        })
        .filter(|thread_id| thread_id != &new_assignee.session.id);

    let workspace_id = new_assignee.workspace_id.clone();
    let session_id = new_assignee.session.id.clone();
    let superseded_thread_id_for_write = superseded_thread_id.clone();
    let reason = request.reason.clone();
    crate::models::db::libsql_write_async(|connection| async move {
        let tx = connection
            .transaction_with_behavior(libsql::TransactionBehavior::Immediate)
            .await?;
        tx.execute(
            "UPDATE workspaces SET active_session_id = ?2 WHERE id = ?1",
            libsql::params![workspace_id.clone(), session_id.clone()],
        )
        .await
        .with_context(|| {
            format!("Failed to set active assignee thread for workspace {workspace_id}")
        })?;
        tx.execute(
            "UPDATE sessions SET thread_role = 'assignee', thread_status = 'active', stale_reason = NULL WHERE id = ?1",
            libsql::params![session_id.clone()],
        )
        .await
        .with_context(|| format!("Failed to mark thread {session_id} active"))?;
        if let Some(thread_id) = superseded_thread_id_for_write.as_deref() {
            tx.execute(
                "UPDATE sessions SET thread_status = 'superseded', stale_reason = ?2 WHERE id = ?1",
                libsql::params![thread_id, reason],
            )
            .await
            .with_context(|| format!("Failed to mark thread {thread_id} superseded"))?;
            tx.execute(
                "UPDATE sessions SET supersedes_thread_id = ?2 WHERE id = ?1",
                libsql::params![session_id.clone(), thread_id],
            )
            .await
            .with_context(|| format!("Failed to link superseded thread {thread_id}"))?;
        }
        tx.commit().await?;
        Ok(())
    })
    .await?;

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
    block_on_goal_assignee_db(summarize_assignee_status_async(request))
}

pub async fn summarize_assignee_status_async(
    request: SummarizeAssigneeStatusRequest,
) -> Result<AssigneeStatusSummary> {
    let goal_workspace_id = request.goal_workspace_id.clone();
    let card_id = request.card_id.clone();
    let assignee =
        run_goal_assignee_blocking(move || resolve_assignee(&goal_workspace_id, &card_id)).await?;
    let sessions = sessions::list_workspace_sessions_async(&assignee.workspace_id).await?;
    let messages = load_assignee_messages_async(&assignee.session.id, None).await?;
    let latest_report = latest_report_marker(&messages);
    let stale_threads = detect_stale_threads_async(&sessions, &assignee.session.id).await?;
    let runtime = crate::background_agents::get_runtime_status(&assignee.session.id);
    let persisted_message_count = persisted_message_count_async(&assignee.session.id)
        .await
        .unwrap_or(0);
    let persistence_state = classify_persistence_state(
        &assignee.session.status,
        &runtime.process_state,
        runtime.terminal_event_seen,
        runtime.last_error.as_deref(),
        persisted_message_count,
    );
    let persistence_problem = matches!(
        persistence_state.as_str(),
        "failed_persist" | "provider_completed_db_missing"
    );
    let effective_status = if persistence_problem {
        persistence_state.clone()
    } else {
        latest_report
            .as_ref()
            .map(|report| report.report_type.clone())
            .or_else(|| assignee.session.thread_status.clone())
            .unwrap_or_else(|| assignee.session.status.clone())
    };
    let recommended_action = if effective_status == "blocked" {
        "Read the blocker and either answer it or start a replacement thread if the issue is unrecoverable."
            .to_string()
    } else if persistence_problem {
        "Check the thread runtime status and retry after DB persistence is healthy; provider output may exist outside Helmor's durable thread.".to_string()
    } else if !stale_threads.is_empty() {
        "Continue supervising the active thread and avoid sending follow-ups to stale or superseded threads."
            .to_string()
    } else if latest_report.is_none() {
        "Inspect the active thread before reporting progress; no milestone report has been posted yet."
            .to_string()
    } else {
        "Continue normal supervision on the active assignee thread.".to_string()
    };
    let summary = if persistence_problem {
        format!(
            "{}: provider terminal state and Helmor DB persistence diverged.",
            persistence_state
        )
    } else {
        latest_report
            .as_ref()
            .map(|report| format!("{}: {}", report.report_type, report.excerpt))
            .unwrap_or_else(|| "No milestone report found yet.".to_string())
    };

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
    block_on_goal_assignee_db(list_assignees_async(request))
}

pub async fn list_assignees_async(request: ListAssigneesRequest) -> Result<Vec<AssigneeSummary>> {
    let goal_workspace_id = request.goal_workspace_id.clone();
    let workspaces = run_goal_assignee_blocking(move || {
        crate::workspaces::list_goal_child_workspaces(&goal_workspace_id)
    })
    .await?;
    let status_filter = request
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let mut out = Vec::new();

    for workspace in workspaces {
        let goal_workspace_id = request.goal_workspace_id.clone();
        let card_id = workspace.id.clone();
        let Ok(assignee) =
            run_goal_assignee_blocking(move || resolve_assignee(&goal_workspace_id, &card_id))
                .await
        else {
            continue;
        };
        let latest_report = latest_report_marker_from_notifications_async(
            &request.goal_workspace_id,
            &assignee.workspace_id,
            &assignee.session.id,
        )
        .await
        .with_context(|| {
            format!(
                "Failed to load latest assignee report for session {}",
                assignee.session.id
            )
        })?;
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

        let run_summary = latest_run_summary_async(&assignee.session.id)
            .await
            .unwrap_or_else(|_| LatestRunSummary::default());

        out.push(AssigneeSummary {
            card_id: workspace.id.clone(),
            workspace_id: assignee.workspace_id,
            session_id: assignee.session.id.clone(),
            title: workspace.title,
            assignee_name: assignee_name(&assignee.session),
            session_status: assignee.session.status,
            latest_report,
            active_run_status: run_summary
                .latest_run
                .as_ref()
                .map(|run| run.status.clone()),
            last_run_error: run_summary.latest_run.as_ref().and_then(|run| {
                (run.status == "failed")
                    .then(|| run.error.clone())
                    .flatten()
            }),
            pending_run_count: run_summary.pending_run_count,
            latest_run: run_summary.latest_run,
        });
    }

    Ok(out)
}

async fn latest_report_marker_from_notifications_async(
    goal_workspace_id: &str,
    workspace_id: &str,
    session_id: &str,
) -> Result<Option<AssigneeReportMarker>> {
    let connection = crate::models::db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            r#"
            SELECT message_id, report_type, excerpt, created_at
            FROM goal_supervisor_notifications
            WHERE goal_workspace_id = ?1
              AND card_workspace_id = ?2
              AND assignee_session_id = ?3
            ORDER BY datetime(created_at) DESC, created_at DESC
            LIMIT 1
            "#,
            libsql::params![
                goal_workspace_id.to_string(),
                workspace_id.to_string(),
                session_id.to_string(),
            ],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Ok(None);
    };
    let message_id: String = row.get(0).context("Failed to read report message id")?;
    let report_type: String = row.get(1).context("Failed to read report type")?;
    let excerpt: String = row.get(2).context("Failed to read report excerpt")?;
    let created_at: Option<String> = row.get(3).context("Failed to read report timestamp")?;
    Ok(Some(AssigneeReportMarker {
        report_type,
        message_id: Some(message_id),
        created_at,
        full_text: excerpt.clone(),
        excerpt,
    }))
}

pub(crate) fn mark_assignee_run_started(
    app: &tauri::AppHandle,
    goal_workspace_id: &str,
    workspace_id: &str,
    session_id: &str,
    run_id: &str,
) {
    let goal_workspace_id = goal_workspace_id.to_string();
    let workspace_id = workspace_id.to_string();
    let session_id = session_id.to_string();
    let run_id = run_id.to_string();
    let _ = block_on_goal_assignee_db(crate::models::db::libsql_write_async(|connection| {
        let run_id = run_id.clone();
        async move {
            connection
                .execute(
                    r#"
                        UPDATE goal_assignee_runs
                        SET status = 'running',
                            started_at = COALESCE(started_at, datetime('now')),
                            last_event_at = datetime('now'),
                            error = NULL
                        WHERE id = ?1
                        "#,
                    [run_id],
                )
                .await?;
            Ok(())
        }
    }));
    crate::ui_sync::publish(
        app,
        UiMutationEvent::GoalAssigneeRunChanged {
            goal_workspace_id,
            workspace_id,
            session_id,
            run_id,
        },
    );
}

pub(crate) fn mark_assignee_run_finished(
    app: &tauri::AppHandle,
    goal_workspace_id: &str,
    workspace_id: &str,
    session_id: &str,
    run_id: &str,
    error: Option<&str>,
) {
    let goal_workspace_id = goal_workspace_id.to_string();
    let workspace_id = workspace_id.to_string();
    let session_id = session_id.to_string();
    let run_id = run_id.to_string();
    let status = if error.is_some() {
        "failed"
    } else {
        "completed"
    }
    .to_string();
    let error = error.map(str::to_string);
    let _ = block_on_goal_assignee_db(crate::models::db::libsql_write_async(|connection| {
        let run_id = run_id.clone();
        let status = status.clone();
        let error = error.clone();
        async move {
            connection
                .execute(
                    r#"
                        UPDATE goal_assignee_runs
                        SET status = ?2,
                            completed_at = datetime('now'),
                            last_event_at = datetime('now'),
                            error = ?3
                        WHERE id = ?1
                        "#,
                    libsql::params![run_id, status, error],
                )
                .await?;
            Ok(())
        }
    }));
    crate::ui_sync::publish(
        app,
        UiMutationEvent::GoalAssigneeRunChanged {
            goal_workspace_id,
            workspace_id,
            session_id,
            run_id,
        },
    );
}

async fn load_assignee_messages_async(
    session_id: &str,
    since_message_id: Option<&str>,
) -> Result<Vec<pipeline::types::ThreadMessageLike>> {
    let historical = sessions::list_session_historical_records_async(session_id).await?;
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

async fn persisted_message_count_async(session_id: &str) -> Result<i64> {
    let connection = crate::models::db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            "SELECT COUNT(*) FROM session_messages WHERE session_id = ?1",
            [session_id.to_string()],
        )
        .await?;
    let Some(row) = rows.next().await? else {
        return Ok(0);
    };
    row.get(0).context("Failed to read persisted message count")
}

async fn last_persisted_message_at_async(session_id: &str) -> Result<Option<String>> {
    let connection = crate::models::db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            "SELECT MAX(created_at) FROM session_messages WHERE session_id = ?1",
            [session_id.to_string()],
        )
        .await?;
    match rows.next().await? {
        Some(row) => row
            .get(0)
            .context("Failed to read latest persisted message timestamp"),
        None => Ok(None),
    }
}

fn provider_session_path(provider_session_id: Option<&str>) -> Option<String> {
    let id = provider_session_id?.trim();
    if id.is_empty() {
        return None;
    }
    if id.starts_with('/') || id.starts_with("~/") || id.ends_with(".jsonl") {
        return Some(id.to_string());
    }
    Some(format!("~/.pi/agent/sessions/.../{id}.jsonl"))
}

fn classify_persistence_state(
    session_status: &str,
    process_state: &str,
    terminal_event_seen: bool,
    last_error: Option<&str>,
    persisted_message_count: i64,
) -> String {
    if process_state == "failed_persist" {
        return "failed_persist".to_string();
    }
    if last_error.is_some() {
        return "runtime_error".to_string();
    }
    if terminal_event_seen && persisted_message_count == 0 {
        return "provider_completed_db_missing".to_string();
    }
    if session_status == "streaming" && persisted_message_count == 0 {
        return "provider_streaming_db_pending".to_string();
    }
    if terminal_event_seen {
        return "completed".to_string();
    }
    "synced".to_string()
}

async fn detect_stale_threads_async(
    sessions: &[sessions::WorkspaceSessionSummary],
    active_thread_id: &str,
) -> Result<Vec<StaleThreadSummary>> {
    let mut stale_threads = Vec::new();
    for session in sessions {
        let messages = load_assignee_messages_async(&session.id, None).await?;
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

#[derive(Default)]
struct LatestRunSummary {
    latest_run: Option<AssigneeRunSummary>,
    pending_run_count: i64,
}

async fn latest_run_summary_async(session_id: &str) -> Result<LatestRunSummary> {
    let connection = crate::models::db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            r#"
            SELECT id, status, prompt, model_id, permission_mode, error,
                   created_at, started_at, completed_at, last_event_at
            FROM goal_assignee_runs
            WHERE session_id = ?1
            ORDER BY datetime(created_at) DESC, created_at DESC
            LIMIT 1
            "#,
            [session_id.to_string()],
        )
        .await?;
    let latest_run = match rows.next().await? {
        Some(row) => Some(AssigneeRunSummary {
            run_id: row.get(0).context("Failed to read assignee run id")?,
            status: row.get(1).context("Failed to read assignee run status")?,
            prompt: row.get(2).context("Failed to read assignee run prompt")?,
            model_id: row.get(3).ok().flatten(),
            permission_mode: row.get(4).ok().flatten(),
            error: row.get(5).ok().flatten(),
            created_at: row
                .get(6)
                .context("Failed to read assignee run created_at")?,
            started_at: row.get(7).ok().flatten(),
            completed_at: row.get(8).ok().flatten(),
            last_event_at: row.get(9).ok().flatten(),
        }),
        None => None,
    };
    let mut count_rows = connection
        .query(
            "SELECT COUNT(*) FROM goal_assignee_runs WHERE session_id = ?1 AND status = 'queued'",
            [session_id.to_string()],
        )
        .await?;
    let pending_run_count: i64 = match count_rows.next().await? {
        Some(row) => row.get(0).unwrap_or(0),
        None => 0,
    };
    Ok(LatestRunSummary {
        latest_run,
        pending_run_count,
    })
}

fn assignee_name(session: &sessions::WorkspaceSessionSummary) -> String {
    session
        .agent_type
        .clone()
        .or_else(|| session.model.clone())
        .unwrap_or_else(|| "assignee".to_string())
}

#[cfg(test)]
mod tests {
    use super::{classify_persistence_state, provider_session_path};

    #[test]
    fn provider_session_path_preserves_absolute_pi_jsonl_path() {
        assert_eq!(
            provider_session_path(Some("/Users/harmony/.pi/agent/sessions/run.jsonl")).as_deref(),
            Some("/Users/harmony/.pi/agent/sessions/run.jsonl")
        );
    }

    #[test]
    fn persistence_state_reports_terminal_without_durable_rows() {
        assert_eq!(
            classify_persistence_state("idle", "completed", true, None, 0),
            "provider_completed_db_missing"
        );
        assert_eq!(
            classify_persistence_state("idle", "failed_persist", true, None, 2),
            "failed_persist"
        );
    }
}
