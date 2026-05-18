use std::future::Future;

use anyhow::{Context, Result};
use uuid::Uuid;

use super::resolver::ResolvedAssignee;
use crate::{models::db, service};

pub(super) struct QueuedAssigneePrompt {
    pub(super) pending_send_id: String,
    pub(super) supervisor_message_id: String,
}

pub(super) struct PersistedAssigneeRun {
    pub(super) run_id: String,
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
        let tx = connection
            .transaction_with_behavior(libsql::TransactionBehavior::Immediate)
            .await?;
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

pub(super) fn persist_assignee_run_prompt(
    goal_workspace_id: &str,
    assignee: &ResolvedAssignee,
    message: &str,
    model_id: Option<&str>,
    permission_mode: Option<&str>,
) -> Result<PersistedAssigneeRun> {
    let run_id = Uuid::new_v4().to_string();
    let goal_workspace_id = goal_workspace_id.to_string();
    let workspace_id = assignee.workspace_id.clone();
    let session_id = assignee.session.id.clone();
    let message = message.to_string();
    let model_id = model_id.map(str::to_string);
    let permission_mode = permission_mode.map(str::to_string);

    block_on_assignee_storage_db(db::libsql_write_async(|connection| async move {
        let tx = connection
            .transaction_with_behavior(libsql::TransactionBehavior::Immediate)
            .await?;
        let supervisor_message_id =
            persist_supervisor_message_libsql_tx(&tx, &session_id, &message)
                .await
                .with_context(|| {
                    format!("Failed to persist supervisor update for session {session_id}")
                })?;
        tx.execute(
            r#"
            INSERT INTO goal_assignee_runs (
                id, goal_workspace_id, workspace_id, session_id,
                supervisor_message_id, status, prompt, model_id, permission_mode
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, ?7, ?8)
            "#,
            libsql::params![
                run_id.clone(),
                goal_workspace_id,
                workspace_id,
                session_id.clone(),
                supervisor_message_id.clone(),
                message,
                model_id,
                permission_mode,
            ],
        )
        .await
        .with_context(|| format!("Failed to insert assignee run for session {session_id}"))?;
        tx.execute(
            "UPDATE sessions SET last_supervisor_message_id = ?2 WHERE id = ?1",
            libsql::params![session_id.clone(), supervisor_message_id.clone()],
        )
        .await
        .with_context(|| {
            format!("Failed to update supervisor message metadata for session {session_id}")
        })?;
        tx.commit().await?;
        Ok(PersistedAssigneeRun {
            run_id,
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
