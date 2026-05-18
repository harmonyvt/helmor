use std::future::Future;

use anyhow::{Context, Result};
use uuid::Uuid;

use super::resolver::ResolvedAssignee;
use crate::{models::db, service};

pub(super) struct QueuedAssigneePrompt {
    pub(super) pending_send_id: String,
    pub(super) supervisor_message_id: String,
}

fn block_on_assignee_storage_db<T>(future: impl Future<Output = Result<T>>) -> Result<T> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(future)),
        Err(_) => tauri::async_runtime::block_on(future),
    }
}

pub(super) fn queue_assignee_prompt(
    assignee: &ResolvedAssignee,
    message: &str,
) -> Result<QueuedAssigneePrompt> {
    let workspace_id = assignee.workspace_id.clone();
    let session_id = assignee.session.id.clone();
    let model = assignee.session.model.clone();
    let permission_mode = assignee.session.permission_mode.clone();
    let message = message.to_string();

    block_on_assignee_storage_db(db::libsql_write_async(|connection| async move {
        let tx = connection.transaction().await?;
        let supervisor_message_id =
            persist_supervisor_message_libsql_tx(&tx, &session_id, &message)
                .await
                .with_context(|| {
                    format!("Failed to persist supervisor update for session {session_id}")
                })?;
        let pending_send_id = service::insert_pending_cli_send_on_libsql_tx(
            &tx,
            &workspace_id,
            &session_id,
            &message,
            model.as_deref(),
            Some(permission_mode.as_str()),
        )
        .await
        .with_context(|| {
            format!("Failed to insert pending CLI send for assignee session {session_id}")
        })?;
        tx.execute(
            "UPDATE sessions SET last_supervisor_message_id = ?2 WHERE id = ?1",
            libsql::params![session_id.clone(), supervisor_message_id.clone()],
        )
        .await
        .with_context(|| {
            format!("Failed to update supervisor message metadata for session {session_id}")
        })?;
        tx.commit().await?;
        Ok(QueuedAssigneePrompt {
            pending_send_id,
            supervisor_message_id,
        })
    }))
}

async fn persist_supervisor_message_libsql_tx(
    tx: &libsql::Transaction,
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
    tx.execute(
        r#"INSERT INTO session_messages
           (id, session_id, role, content, created_at, sent_at)
           VALUES (?1, ?2, 'user', ?3, ?4, ?4)"#,
        libsql::params![user_msg_id.clone(), session_id, user_content, timestamp],
    )
    .await?;
    Ok(user_msg_id)
}
