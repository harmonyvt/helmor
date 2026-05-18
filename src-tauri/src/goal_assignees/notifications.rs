use anyhow::{Context, Result};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use uuid::Uuid;

use crate::pipeline::{
    types::{HistoricalRecord, MessageRole},
    MessagePipeline,
};
use crate::ui_sync::UiMutationEvent;

use super::report::{excerpt, message_text, report_marker_from_text, AssigneeReportMarker};

#[derive(Debug, Clone)]
struct AssigneeNotificationTarget {
    goal_workspace_id: String,
    card_workspace_id: String,
    card_title: String,
    supervisor_session_id: Option<String>,
    supervisor_model: Option<String>,
    supervisor_permission_mode: Option<String>,
}

#[derive(Debug, Clone)]
struct NotificationRecord {
    id: String,
    delivered_to_session_id: Option<String>,
    created_at: String,
}

pub(crate) fn maybe_deliver_assignee_report(
    conn: &rusqlite::Connection,
    assignee_session_id: &str,
    message_id: &str,
    role: MessageRole,
    content: &str,
) -> Result<()> {
    if role != MessageRole::Assistant {
        return Ok(());
    }
    let Some(target) = resolve_notification_target(conn, assignee_session_id)? else {
        return Ok(());
    };
    let Some(marker) = report_marker_from_persisted_turn(
        message_id,
        role,
        content,
        message_created_at(conn, message_id)?,
    ) else {
        return Ok(());
    };

    conn.execute(
        "UPDATE sessions SET last_milestone_report_id = ?2 WHERE id = ?1",
        params![assignee_session_id, message_id],
    )
    .with_context(|| {
        format!(
            "Failed to update milestone report marker for assignee session {assignee_session_id}"
        )
    })?;

    ensure_delivered_report_notification(conn, &target, assignee_session_id, &marker)
}

pub(crate) fn maybe_notify_missing_report_after_terminal(
    session_id: &str,
) -> Result<Option<String>> {
    let conn = crate::models::db::write_conn()?;
    let Some(target) = resolve_notification_target(&conn, session_id)? else {
        return Ok(None);
    };
    if session_has_milestone_report(&conn, session_id)? {
        return Ok(None);
    }
    notify_runtime_issue_on(
        &conn,
        &target,
        session_id,
        "missing_milestone_report",
        "Provider completed, but no milestone report was persisted.",
    )
}

pub(crate) fn notify_runtime_issue_for_session(
    session_id: &str,
    issue_kind: &str,
    issue: &str,
) -> Result<Option<String>> {
    let conn = crate::models::db::write_conn()?;
    let Some(target) = resolve_notification_target(&conn, session_id)? else {
        return Ok(None);
    };
    notify_runtime_issue_on(&conn, &target, session_id, issue_kind, issue)
}

fn report_marker_from_persisted_turn(
    message_id: &str,
    role: MessageRole,
    content: &str,
    created_at: Option<String>,
) -> Option<AssigneeReportMarker> {
    let parsed_content = serde_json::from_str::<Value>(content).ok();
    let records = [HistoricalRecord {
        id: message_id.to_string(),
        role,
        content: content.to_string(),
        parsed_content,
        created_at: created_at.unwrap_or_default(),
    }];
    MessagePipeline::convert_historical(&records)
        .into_iter()
        .find(|message| message.role == MessageRole::Assistant)
        .and_then(|message| {
            let text = message_text(&message);
            report_marker_from_text(Some(message_id.to_string()), message.created_at, &text)
        })
}

fn session_has_milestone_report(conn: &rusqlite::Connection, session_id: &str) -> Result<bool> {
    let mut statement = conn
        .prepare(
            "SELECT id, role, content, created_at
             FROM session_messages
             WHERE session_id = ?1 AND role = 'assistant'
             ORDER BY sent_at, created_at",
        )
        .with_context(|| format!("Failed to prepare report scan for session {session_id}"))?;
    let rows = statement
        .query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, MessageRole>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows.into_iter().any(|(id, role, content, created_at)| {
        report_marker_from_persisted_turn(&id, role, &content, created_at).is_some()
    }))
}

fn resolve_notification_target(
    conn: &rusqlite::Connection,
    assignee_session_id: &str,
) -> Result<Option<AssigneeNotificationTarget>> {
    if !table_exists(conn, "sessions")?
        || !table_exists(conn, "workspaces")?
        || !table_exists(conn, "goal_cards")?
    {
        return Ok(None);
    }

    conn.query_row(
        r#"
        SELECT
          w.goal_workspace_id,
          w.id,
          COALESCE(NULLIF(gc.title, ''), NULLIF(s.title, ''), w.directory_name, w.id),
          goal.active_session_id,
          supervisor.model,
          supervisor.permission_mode
        FROM sessions s
        JOIN workspaces w ON w.id = s.workspace_id
        JOIN workspaces goal ON goal.id = w.goal_workspace_id
        LEFT JOIN sessions supervisor ON supervisor.id = goal.active_session_id
        LEFT JOIN goal_cards gc
          ON gc.goal_workspace_id = w.goal_workspace_id
         AND (gc.child_workspace_id = w.id OR gc.id = w.id)
        WHERE s.id = ?1
          AND w.goal_workspace_id IS NOT NULL
          AND COALESCE(w.workspace_kind, 'code') = 'code'
          AND (
            w.active_session_id = s.id
            OR COALESCE(s.thread_status, '') = 'active'
            OR COALESCE(s.thread_role, '') = 'assignee'
          )
        LIMIT 1
        "#,
        [assignee_session_id],
        |row| {
            Ok(AssigneeNotificationTarget {
                goal_workspace_id: row.get(0)?,
                card_workspace_id: row.get(1)?,
                card_title: row.get(2)?,
                supervisor_session_id: row.get(3)?,
                supervisor_model: row.get(4)?,
                supervisor_permission_mode: row.get(5)?,
            })
        },
    )
    .optional()
    .with_context(|| {
        format!("Failed to resolve goal supervisor notification target for session {assignee_session_id}")
    })
}

fn table_exists(conn: &rusqlite::Connection, table: &str) -> Result<bool> {
    conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1")
        .and_then(|mut stmt| stmt.exists([table]))
        .with_context(|| format!("Failed to check whether table {table} exists"))
}

fn ensure_delivered_report_notification(
    conn: &rusqlite::Connection,
    target: &AssigneeNotificationTarget,
    assignee_session_id: &str,
    marker: &AssigneeReportMarker,
) -> Result<()> {
    let message_id = marker.message_id.as_deref().unwrap_or("unknown");
    let notification = ensure_notification(
        conn,
        target,
        assignee_session_id,
        message_id,
        &marker.report_type,
        &marker.excerpt,
    )?;
    if notification.delivered_to_session_id.is_some() {
        return Ok(());
    }
    let Some(supervisor_session_id) = target.supervisor_session_id.as_deref() else {
        return Ok(());
    };

    let reported_at = marker
        .created_at
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(notification.created_at.as_str());
    let recommended_action =
        "Auto-resume is enabled by default: Helmor queued a supervisor follow-up turn to review this report, update the card lane if appropriate, and summarize any blockers or completion back to the user.";
    let report_text = marker.full_text.trim();
    let message = format!(
        "## Assignee Report Received\n\nCard: {}\nCard workspace: {}\nAssignee thread: {}\nReport type: {}\nReported at: {}\nAuto-resume: enabled\n\nExcerpt:\n{}\n\nRecommended supervisor action:\n{}",
        target.card_title,
        target.card_workspace_id,
        assignee_session_id,
        marker.report_type,
        reported_at,
        report_text,
        recommended_action
    );
    let payload = serde_json::json!({
        "type": "goal_assignee_report",
        "goalWorkspaceId": target.goal_workspace_id,
        "cardWorkspaceId": target.card_workspace_id,
        "assigneeSessionId": assignee_session_id,
        "messageId": message_id,
        "reportType": marker.report_type,
        "title": "Assignee Report Received",
        "excerpt": marker.excerpt,
        "fullText": report_text,
        "recommendedAction": recommended_action,
        "message": message,
    });
    deliver_notification_message(
        conn,
        &notification.id,
        &target.goal_workspace_id,
        supervisor_session_id,
        payload,
    )?;
    queue_supervisor_auto_resume(
        conn,
        target,
        supervisor_session_id,
        assignee_session_id,
        message_id,
        &marker.report_type,
    )
}

fn notify_runtime_issue_on(
    conn: &rusqlite::Connection,
    target: &AssigneeNotificationTarget,
    assignee_session_id: &str,
    issue_kind: &str,
    issue: &str,
) -> Result<Option<String>> {
    let message_id = format!("runtime_issue:{issue_kind}");
    let issue_excerpt = excerpt(issue);
    let notification = ensure_notification(
        conn,
        target,
        assignee_session_id,
        &message_id,
        "runtime_issue",
        &issue_excerpt,
    )?;
    if notification.delivered_to_session_id.is_some() {
        return Ok(Some(notification.id));
    }
    let Some(supervisor_session_id) = target.supervisor_session_id.as_deref() else {
        return Ok(Some(notification.id));
    };

    let recommended_action =
        "Auto-resume is enabled by default: Helmor queued a supervisor follow-up turn to inspect runtime status and provider session logs, then retry or create a replacement thread if needed.";
    let message = format!(
        "## Assignee Runtime Issue\n\nCard: {}\nAssignee thread: {}\nAuto-resume: enabled\nIssue: {}\n\nRecommended supervisor action:\n{}",
        target.card_title, assignee_session_id, issue, recommended_action
    );
    let payload = serde_json::json!({
        "type": "goal_assignee_runtime_issue",
        "goalWorkspaceId": target.goal_workspace_id,
        "cardWorkspaceId": target.card_workspace_id,
        "assigneeSessionId": assignee_session_id,
        "messageId": message_id,
        "reportType": "runtime_issue",
        "title": "Assignee Runtime Issue",
        "excerpt": issue_excerpt,
        "recommendedAction": recommended_action,
        "message": message,
    });
    deliver_notification_message(
        conn,
        &notification.id,
        &target.goal_workspace_id,
        supervisor_session_id,
        payload,
    )?;
    queue_supervisor_auto_resume(
        conn,
        target,
        supervisor_session_id,
        assignee_session_id,
        &message_id,
        "runtime_issue",
    )?;
    Ok(Some(notification.id))
}

fn queue_supervisor_auto_resume(
    conn: &rusqlite::Connection,
    target: &AssigneeNotificationTarget,
    supervisor_session_id: &str,
    assignee_session_id: &str,
    message_id: &str,
    report_type: &str,
) -> Result<()> {
    let notification_kind = if report_type == "runtime_issue" {
        "a runtime issue"
    } else {
        "an assignee report"
    };
    let prompt = format!(
        "Auto-resume from Helmor Goals: {notification_kind} was delivered for card \"{}\".\n\nReview the latest Assignee Report Received or Assignee Runtime Issue system message in this supervisor thread. Report type: {report_type}. Assignee thread: {assignee_session_id}. Source message: {message_id}.\n\nUpdate the card lane if appropriate, inspect blockers or verification notes, and summarize the outcome back to the user.",
        target.card_title
    );
    let pending_send_id = crate::service::insert_pending_cli_send_on(
        conn,
        &target.goal_workspace_id,
        supervisor_session_id,
        &prompt,
        target.supervisor_model.as_deref(),
        target.supervisor_permission_mode.as_deref(),
    )
    .with_context(|| {
        format!("Failed to queue supervisor auto-resume for assignee session {assignee_session_id}")
    })?;

    let _ = crate::ui_sync::notify_running_app(UiMutationEvent::PendingCliSendQueued {
        pending_send_id,
        workspace_id: target.goal_workspace_id.clone(),
        session_id: supervisor_session_id.to_string(),
        prompt,
        model_id: target.supervisor_model.clone(),
        permission_mode: target.supervisor_permission_mode.clone(),
    });
    Ok(())
}

fn ensure_notification(
    conn: &rusqlite::Connection,
    target: &AssigneeNotificationTarget,
    assignee_session_id: &str,
    message_id: &str,
    report_type: &str,
    notification_excerpt: &str,
) -> Result<NotificationRecord> {
    let notification_id = Uuid::new_v4().to_string();
    conn.execute(
        r#"
        INSERT OR IGNORE INTO goal_supervisor_notifications (
          id, goal_workspace_id, card_workspace_id, assignee_session_id,
          message_id, report_type, excerpt
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
        params![
            notification_id,
            target.goal_workspace_id,
            target.card_workspace_id,
            assignee_session_id,
            message_id,
            report_type,
            notification_excerpt,
        ],
    )
    .with_context(|| {
        format!(
            "Failed to persist supervisor notification for assignee session {assignee_session_id}"
        )
    })?;

    conn.query_row(
        r#"
        SELECT id, delivered_to_session_id, created_at
        FROM goal_supervisor_notifications
        WHERE goal_workspace_id = ?1
          AND card_workspace_id = ?2
          AND assignee_session_id = ?3
          AND message_id = ?4
        "#,
        params![
            target.goal_workspace_id,
            target.card_workspace_id,
            assignee_session_id,
            message_id
        ],
        |row| {
            Ok(NotificationRecord {
                id: row.get(0)?,
                delivered_to_session_id: row.get(1)?,
                created_at: row.get(2)?,
            })
        },
    )
    .with_context(|| {
        format!("Failed to load supervisor notification for assignee session {assignee_session_id}")
    })
}

fn deliver_notification_message(
    conn: &rusqlite::Connection,
    notification_id: &str,
    goal_workspace_id: &str,
    supervisor_session_id: &str,
    payload: Value,
) -> Result<()> {
    let now = crate::models::db::current_timestamp()?;
    let supervisor_message_id = Uuid::new_v4().to_string();
    conn.execute(
        r#"
        INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at)
        VALUES (?1, ?2, 'system', ?3, ?4, ?4)
        "#,
        params![
            supervisor_message_id,
            supervisor_session_id,
            payload.to_string(),
            now
        ],
    )
    .with_context(|| {
        format!(
            "Failed to deliver assignee notification to supervisor session {supervisor_session_id}"
        )
    })?;
    conn.execute(
        r#"
        UPDATE goal_supervisor_notifications
        SET delivered_to_session_id = ?2, delivered_at = ?3
        WHERE id = ?1
        "#,
        params![notification_id, supervisor_session_id, now],
    )
    .with_context(|| {
        format!("Failed to mark supervisor notification {notification_id} delivered")
    })?;

    let _ = crate::ui_sync::notify_running_app(UiMutationEvent::SessionMessagesChanged {
        workspace_id: goal_workspace_id.to_string(),
        session_id: supervisor_session_id.to_string(),
    });
    let _ = crate::ui_sync::notify_running_app(UiMutationEvent::WorkspaceChanged {
        workspace_id: goal_workspace_id.to_string(),
    });
    Ok(())
}

fn message_created_at(conn: &rusqlite::Connection, message_id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT created_at FROM session_messages WHERE id = ?1",
        [message_id],
        |row| row.get(0),
    )
    .optional()
    .with_context(|| format!("Failed to load created_at for message {message_id}"))
}
