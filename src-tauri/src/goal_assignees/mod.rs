use anyhow::Result;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

mod prompt;
mod report;
mod resolver;
mod storage;

use prompt::format_supervisor_update;
pub use prompt::{assignee_bootstrap_prompt, AssigneeBootstrapPromptInput};
use report::latest_report_marker;
pub use report::AssigneeReportMarker;
use resolver::resolve_assignee;
use storage::queue_assignee_prompt;

use crate::{pipeline, service, sessions, ui_sync::UiMutationEvent};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAssigneeMessageRequest {
    pub goal_workspace_id: String,
    pub card_id: String,
    pub message: String,
    pub priority: Option<String>,
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
    pub since_message_id: Option<String>,
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
pub struct AssigneeStatusSummary {
    pub card_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub assignee_name: String,
    pub session_status: String,
    pub latest_report: Option<AssigneeReportMarker>,
    pub summary: String,
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
    let assignee = resolve_assignee(&request.goal_workspace_id, &request.card_id)?;
    let message = format_supervisor_update(&request.message, request.priority.as_deref())?;
    let pending_send_id = queue_assignee_prompt(&assignee, &message)?;
    let started = assignee.session.status != "streaming";

    let _ = crate::ui_sync::notify_running_app(UiMutationEvent::PendingCliSendQueued {
        pending_send_id: pending_send_id.clone(),
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
        pending_send_id,
        message,
    })
}

pub(crate) fn prepare_assignee_message(
    request: SendAssigneeMessageRequest,
) -> Result<PreparedAssigneeMessage> {
    let assignee = resolve_assignee(&request.goal_workspace_id, &request.card_id)?;
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

pub fn read_assignee_thread(request: ReadAssigneeThreadRequest) -> Result<AssigneeThreadResult> {
    let assignee = resolve_assignee(&request.goal_workspace_id, &request.card_id)?;
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

pub fn summarize_assignee_status(
    request: SummarizeAssigneeStatusRequest,
) -> Result<AssigneeStatusSummary> {
    let assignee = resolve_assignee(&request.goal_workspace_id, &request.card_id)?;
    let messages = load_assignee_messages(&assignee.session.id, None)?;
    let latest_report = latest_report_marker(&messages);
    let summary = latest_report
        .as_ref()
        .map(|report| format!("{}: {}", report.report_type, report.excerpt))
        .unwrap_or_else(|| "No milestone report found yet.".to_string());

    Ok(AssigneeStatusSummary {
        card_id: assignee.card_id,
        workspace_id: assignee.workspace_id,
        assignee_name: assignee_name(&assignee.session),
        session_id: assignee.session.id,
        session_status: assignee.session.status,
        latest_report,
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
        let messages = load_assignee_messages(&assignee.session.id, None).unwrap_or_default();
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

fn assignee_name(session: &sessions::WorkspaceSessionSummary) -> String {
    session
        .agent_type
        .clone()
        .or_else(|| session.model.clone())
        .unwrap_or_else(|| "assignee".to_string())
}
