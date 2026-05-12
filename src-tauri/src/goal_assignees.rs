use anyhow::{bail, Context, Result};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    models::{db, workspaces as workspace_models},
    pipeline, service, sessions,
    ui_sync::UiMutationEvent,
    workspace_kind::WorkspaceKind,
};

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
    pub session_id: String,
    pub workspace_id: String,
    pub pending_send_id: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssigneeReportMarker {
    pub report_type: String,
    pub message_id: Option<String>,
    pub created_at: Option<String>,
    pub excerpt: String,
}

pub struct AssigneeBootstrapPromptInput<'a> {
    pub goal_title: Option<&'a str>,
    pub goal_description: Option<&'a str>,
    pub card_title: &'a str,
    pub card_description: Option<&'a str>,
    pub assigned_name: Option<&'a str>,
    pub workspace_id: &'a str,
    pub branch: &'a str,
    pub initial_task: &'a str,
}

struct ResolvedAssignee {
    card_id: String,
    workspace_id: String,
    session: sessions::WorkspaceSessionSummary,
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
        prompt: message,
        model_id: assignee.session.model.clone(),
        permission_mode: Some(assignee.session.permission_mode.clone()),
    });

    Ok(SendAssigneeMessageResult {
        queued: true,
        started,
        session_id: assignee.session.id,
        workspace_id: assignee.workspace_id,
        pending_send_id,
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

fn resolve_assignee(goal_workspace_id: &str, card_id: &str) -> Result<ResolvedAssignee> {
    let goal_workspace_id = service::resolve_workspace_ref(goal_workspace_id)?;
    let workspace_id = resolve_child_workspace_id(&goal_workspace_id, card_id)?;
    let record = workspace_models::load_workspace_record_by_id(&workspace_id)?
        .with_context(|| format!("Goal child workspace not found: {workspace_id}"))?;

    if record.workspace_kind != WorkspaceKind::Code
        || record.goal_workspace_id.as_deref() != Some(goal_workspace_id.as_str())
    {
        bail!("Workspace {workspace_id} is not a child of Goal workspace {goal_workspace_id}");
    }

    let sessions = sessions::list_workspace_sessions(&workspace_id)?;
    let session = sessions
        .iter()
        .find(|session| Some(session.id.as_str()) == record.active_session_id.as_deref())
        .or_else(|| sessions.iter().find(|session| session.active))
        .or_else(|| sessions.first())
        .cloned()
        .with_context(|| format!("Goal child workspace {workspace_id} has no assignee session"))?;

    Ok(ResolvedAssignee {
        card_id: card_id.to_string(),
        workspace_id,
        session,
    })
}

fn resolve_child_workspace_id(goal_workspace_id: &str, card_id: &str) -> Result<String> {
    if let Some(record) = workspace_models::load_workspace_record_by_id(card_id)? {
        if record.goal_workspace_id.as_deref() == Some(goal_workspace_id) {
            return Ok(record.id);
        }
    }

    let connection = db::read_conn()?;
    let linked: Option<String> = connection
        .query_row(
            r#"
            SELECT child_workspace_id
            FROM goal_cards
            WHERE id = ?1 AND goal_workspace_id = ?2
            "#,
            params![card_id, goal_workspace_id],
            |row| row.get(0),
        )
        .optional()
        .context("Failed to resolve goal card child workspace")?;

    linked
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("Goal card {card_id} has no assigned child workspace"))
}

fn queue_assignee_prompt(assignee: &ResolvedAssignee, message: &str) -> Result<String> {
    db::write_transaction(|tx| {
        persist_user_prompt_on(tx, &assignee.session.id, message)?;
        service::insert_pending_cli_send_on(
            tx,
            &assignee.workspace_id,
            &assignee.session.id,
            message,
            assignee.session.model.as_deref(),
            Some(assignee.session.permission_mode.as_str()),
        )
    })
}

fn persist_user_prompt_on(
    conn: &rusqlite::Connection,
    session_id: &str,
    message: &str,
) -> Result<()> {
    let timestamp = db::current_timestamp()?;
    let user_msg_id = Uuid::new_v4().to_string();
    let user_content = serde_json::json!({
        "type": "user_prompt",
        "text": message,
    })
    .to_string();
    conn.execute(
        r#"INSERT INTO session_messages
           (id, session_id, role, content, created_at, sent_at)
           VALUES (?1, ?2, 'user', ?3, ?4, ?4)"#,
        params![user_msg_id, session_id, user_content, timestamp],
    )
    .with_context(|| format!("Failed to persist supervisor update for session {session_id}"))?;
    Ok(())
}

fn format_supervisor_update(message: &str, priority: Option<&str>) -> Result<String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        bail!("Assignee message is required");
    }
    let priority = priority
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("normal");
    Ok(format!(
        "Supervisor update from Goals Pi (priority: {priority}):\n\n{trimmed}\n\nReport blockers and completion in this thread. Use clear headings: Progress, Blocked, Completed, Handoff. Do not assume Pi saw your work until you write a milestone report."
    ))
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

fn latest_report_marker(
    messages: &[pipeline::types::ThreadMessageLike],
) -> Option<AssigneeReportMarker> {
    messages.iter().rev().find_map(|message| {
        if message.role != pipeline::types::MessageRole::Assistant {
            return None;
        }
        let text = message_text(message);
        let report_type = detect_report_type(&text)?;
        Some(AssigneeReportMarker {
            report_type: report_type.to_string(),
            message_id: message.id.clone(),
            created_at: message.created_at.clone(),
            excerpt: excerpt(&text),
        })
    })
}

fn detect_report_type(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase();
    ["blocked", "completed", "handoff", "progress"]
        .into_iter()
        .find(|marker| {
            lower.lines().any(|line| {
                let trimmed = line.trim_start_matches('#').trim();
                trimmed == *marker || trimmed.starts_with(&format!("{marker}:"))
            })
        })
}

fn message_text(message: &pipeline::types::ThreadMessageLike) -> String {
    message
        .content
        .iter()
        .filter_map(|part| match part {
            pipeline::types::ExtendedMessagePart::Basic(pipeline::types::MessagePart::Text {
                text,
                ..
            }) => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn excerpt(text: &str) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    const MAX_LEN: usize = 220;
    if compact.chars().count() <= MAX_LEN {
        compact
    } else {
        let truncated = compact.chars().take(MAX_LEN).collect::<String>();
        format!("{truncated}…")
    }
}

fn assignee_name(session: &sessions::WorkspaceSessionSummary) -> String {
    session
        .agent_type
        .clone()
        .or_else(|| session.model.clone())
        .unwrap_or_else(|| "assignee".to_string())
}

pub fn assignee_bootstrap_prompt(input: AssigneeBootstrapPromptInput<'_>) -> String {
    let mut sections = vec![
        "# Assignee Brief".to_string(),
        format!(
            "Assigned name: {}",
            input.assigned_name.unwrap_or("assignee")
        ),
        format!("Goal: {}", input.goal_title.unwrap_or("Untitled goal")),
    ];
    if let Some(description) = input.goal_description.and_then(non_empty) {
        sections.push(format!("Goal description: {description}"));
    }
    sections.push(format!("Card: {}", input.card_title));
    if let Some(description) = input.card_description.and_then(non_empty) {
        sections.push(format!("Card description: {description}"));
    }
    sections.push(format!("Workspace id: {}", input.workspace_id));
    sections.push(format!("Target branch/workspace: {}", input.branch));
    sections.push("".to_string());
    sections.push("## Initial task from Goals Pi".to_string());
    sections.push(input.initial_task.trim().to_string());
    sections.push("".to_string());
    sections.push("## Reporting expectations".to_string());
    sections.push("Report meaningful milestones in this thread. Use clear headings: Progress, Blocked, Completed, Handoff.".to_string());
    sections.push(
        "Do not assume Goals Pi saw your work until you write a milestone report.".to_string(),
    );
    sections.join("\n")
}

fn non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_heading_based_report_markers() {
        assert_eq!(
            detect_report_type("## Blocked\nNeed an API key"),
            Some("blocked")
        );
        assert_eq!(
            detect_report_type("Completed: ready for review"),
            Some("completed")
        );
        assert_eq!(detect_report_type("Status only"), None);
    }

    #[test]
    fn formats_supervisor_update_with_contract() {
        let message = format_supervisor_update("Use the new endpoint", Some("high")).unwrap();
        assert!(message.starts_with("Supervisor update from Goals Pi"));
        assert!(message.contains("priority: high"));
        assert!(message.contains("Use clear headings: Progress, Blocked, Completed, Handoff"));
    }

    #[test]
    fn excerpt_truncates_on_utf8_character_boundaries() {
        let text = "é".repeat(221);
        let result = excerpt(&text);

        assert_eq!(result.chars().count(), 221);
        assert!(result.ends_with('…'));
    }
}
