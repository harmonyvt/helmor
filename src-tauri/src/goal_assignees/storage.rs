use anyhow::{Context, Result};
use rusqlite::params;
use uuid::Uuid;

use super::resolver::ResolvedAssignee;
use crate::{models::db, service};

pub(super) struct QueuedAssigneePrompt {
    pub(super) pending_send_id: String,
    pub(super) supervisor_message_id: String,
}

pub(super) fn queue_assignee_prompt(
    assignee: &ResolvedAssignee,
    message: &str,
) -> Result<QueuedAssigneePrompt> {
    let conn = db::write_conn()?;
    let tx = conn.unchecked_transaction()?;
    let supervisor_message_id = persist_supervisor_message(&tx, &assignee.session.id, message)?;
    let pending_send_id = service::insert_pending_cli_send_on(
        &tx,
        &assignee.workspace_id,
        &assignee.session.id,
        message,
        assignee.session.model.as_deref(),
        Some(assignee.session.permission_mode.as_str()),
    )
    .with_context(|| {
        format!(
            "Failed to insert pending CLI send for assignee session {}",
            assignee.session.id
        )
    })?;
    tx.execute(
        "UPDATE sessions SET last_supervisor_message_id = ?2 WHERE id = ?1",
        params![assignee.session.id, supervisor_message_id],
    )
    .with_context(|| {
        format!(
            "Failed to update supervisor message metadata for session {}",
            assignee.session.id
        )
    })?;
    tx.commit()?;
    Ok(QueuedAssigneePrompt {
        pending_send_id,
        supervisor_message_id,
    })
}

fn persist_supervisor_message(
    conn: &rusqlite::Connection,
    session_id: &str,
    message: &str,
) -> Result<String> {
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
    Ok(user_msg_id)
}
