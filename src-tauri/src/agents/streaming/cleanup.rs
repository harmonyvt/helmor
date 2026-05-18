//! Cleanup path for abnormal stream exits — heartbeat timeouts and
//! channel disconnects. Unlike the normal `end | aborted | error`
//! finalization (which lives inline in the event loop), this path has
//! no terminal sidecar event to act on, so we synthesize one:
//! persist a generic error message and flip the session row to `idle`.
//!
//! Kept as a free fn so both the timeout/disconnect match arms in
//! `streaming/mod.rs` and the regression tests below drive the same
//! code path.

use std::future::Future;

use anyhow::{bail, Context, Result};
use serde_json::json;

use crate::agents::ExchangeContext;
use crate::pipeline::types::MessageRole;

fn block_on_cleanup_db<T>(future: impl Future<Output = Result<T>>) -> Result<T> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(future)),
        Err(_) => tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .context("Failed to build cleanup DB runtime")?
            .block_on(future),
    }
}

/// Persist an error message and finalize the session after an abnormal
/// stream exit (heartbeat timeout, channel disconnect). Returns `true` iff
/// the session row was successfully transitioned to `idle`.
pub(crate) fn cleanup_abnormal_stream_exit(
    rid: &str,
    exchange_ctx: Option<&ExchangeContext>,
    resolved_model: &str,
    user_message: &str,
    effort_level: Option<&str>,
    permission_mode: Option<&str>,
) -> bool {
    let Some(ctx) = exchange_ctx else {
        tracing::debug!(
            rid = %rid,
            "cleanup_abnormal_stream_exit: no exchange_ctx — nothing to finalize"
        );
        return false;
    };
    let cleanup_result = block_on_cleanup_db(cleanup_abnormal_stream_exit_libsql(
        ctx,
        resolved_model,
        user_message,
        effort_level,
        permission_mode,
    ));

    match cleanup_result {
        Ok(err_persist_ok) => {
            tracing::debug!(
                rid = %rid,
                session_id = %ctx.helmor_session_id,
                err_persist_ok,
                "cleanup_abnormal_stream_exit: session finalized to idle"
            );
            true
        }
        Err(e) => {
            tracing::error!(
                rid = %rid,
                session_id = %ctx.helmor_session_id,
                "cleanup_abnormal_stream_exit: libSQL cleanup failed — session may be stuck: {e}"
            );
            false
        }
    }
}

async fn cleanup_abnormal_stream_exit_libsql(
    ctx: &ExchangeContext,
    resolved_model: &str,
    user_message: &str,
    effort_level: Option<&str>,
    permission_mode: Option<&str>,
) -> Result<bool> {
    let resolved_model = resolved_model.to_string();
    let user_message = user_message.to_string();
    let effort_level = effort_level.map(str::to_string);
    let permission_mode = permission_mode.map(str::to_string);

    crate::models::db::libsql_write_async(|conn| async move {
        let err_persist_ok =
            match persist_error_message_libsql(&conn, ctx, &resolved_model, &user_message).await {
                Ok(_) => true,
                Err(error) => {
                    tracing::error!(
                        session_id = %ctx.helmor_session_id,
                        "cleanup_abnormal_stream_exit: persist_error_message failed: {error}"
                    );
                    false
                }
            };

        finalize_session_metadata_libsql(
            &conn,
            ctx,
            "idle",
            effort_level.as_deref(),
            permission_mode.as_deref(),
        )
        .await?;

        Ok(err_persist_ok)
    })
    .await
}

async fn persist_error_message_libsql(
    conn: &libsql::Connection,
    ctx: &ExchangeContext,
    _resolved_model: &str,
    message: &str,
) -> Result<String> {
    let now = crate::models::db::current_timestamp()?;
    let msg_id = uuid::Uuid::new_v4().to_string();
    let payload = json!({
        "type": "error",
        "message": message,
    })
    .to_string();

    conn.execute(
        r#"
            INSERT INTO session_messages (
              id, session_id, role, content, created_at, sent_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
            "#,
        libsql::params![
            msg_id.clone(),
            ctx.helmor_session_id.clone(),
            MessageRole::Error.as_str(),
            payload,
            now
        ],
    )
    .await
    .context("Failed to persist abnormal stream error message")?;

    Ok(msg_id)
}

async fn finalize_session_metadata_libsql(
    conn: &libsql::Connection,
    ctx: &ExchangeContext,
    status: &str,
    effort_level: Option<&str>,
    permission_mode: Option<&str>,
) -> Result<()> {
    let now = crate::models::db::current_timestamp()?;
    let transaction = conn
        .transaction_with_behavior(libsql::TransactionBehavior::Immediate)
        .await
        .context("Failed to start finalize_session_metadata transaction")?;

    finalize_session_metadata_in_libsql_transaction(
        &transaction,
        ctx,
        &now,
        status,
        effort_level,
        permission_mode,
    )
    .await?;

    transaction
        .commit()
        .await
        .context("Failed to commit finalize_session_metadata transaction")
}

async fn finalize_session_metadata_in_libsql_transaction(
    transaction: &libsql::Transaction,
    ctx: &ExchangeContext,
    now: &str,
    status: &str,
    effort_level: Option<&str>,
    permission_mode: Option<&str>,
) -> Result<()> {
    transaction
        .execute(
            r#"
            UPDATE sessions
            SET
              status = ?5,
              model = ?2,
              agent_type = ?3,
              last_user_message_at = ?4,
              effort_level = COALESCE(?6, effort_level),
              permission_mode = COALESCE(?7, permission_mode)
            WHERE id = ?1
            "#,
            libsql::params![
                ctx.helmor_session_id.clone(),
                ctx.model_id.clone(),
                ctx.model_provider.clone(),
                now,
                status,
                effort_level,
                permission_mode
            ],
        )
        .await
        .context("Failed to update session metadata")?;

    transaction
        .execute(
            r#"
            UPDATE workspaces
            SET
              active_session_id = ?2
            WHERE id = (SELECT workspace_id FROM sessions WHERE id = ?1)
            "#,
            libsql::params![ctx.helmor_session_id.clone(), ctx.helmor_session_id.clone()],
        )
        .await
        .context("Failed to update active workspace session")?;

    mark_session_read_in_libsql_transaction(transaction, &ctx.helmor_session_id).await
}

async fn mark_session_read_in_libsql_transaction(
    transaction: &libsql::Transaction,
    session_id: &str,
) -> Result<()> {
    let mut workspace_rows = transaction
        .query(
            "SELECT workspace_id FROM sessions WHERE id = ?1",
            [session_id.to_string()],
        )
        .await
        .with_context(|| format!("Failed to resolve workspace for session {session_id}"))?;
    let Some(workspace_row) = workspace_rows.next().await? else {
        bail!("Failed to resolve workspace for session {session_id}");
    };
    let workspace_id: String = workspace_row
        .get(0)
        .with_context(|| format!("Failed to resolve workspace for session {session_id}"))?;

    let updated_rows = transaction
        .execute(
            "UPDATE sessions SET unread_count = 0 WHERE id = ?1",
            [session_id.to_string()],
        )
        .await
        .with_context(|| format!("Failed to mark session {session_id} as read"))?;

    if updated_rows != 1 {
        bail!("Session read update affected {updated_rows} rows for session {session_id}");
    }

    clear_workspace_unread_if_no_session_unread_in_libsql_transaction(transaction, &workspace_id)
        .await
}

async fn clear_workspace_unread_if_no_session_unread_in_libsql_transaction(
    transaction: &libsql::Transaction,
    workspace_id: &str,
) -> Result<()> {
    transaction
        .execute(
            r#"
            UPDATE workspaces
            SET unread = 0
            WHERE id = ?1
              AND NOT EXISTS (
                SELECT 1
                FROM sessions
                WHERE workspace_id = ?1
                  AND COALESCE(unread_count, 0) > 0
              )
            "#,
            [workspace_id.to_string()],
        )
        .await
        .with_context(|| format!("Failed to clear workspace unread for {workspace_id}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_session<F: FnOnce()>(session_status: &str, f: F) {
        let dir = tempfile::tempdir().unwrap();
        let _guard = crate::data_dir::TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        std::env::set_var("HELMOR_DATA_DIR", dir.path());
        crate::data_dir::ensure_directory_structure().unwrap();

        let db_path = crate::data_dir::db_path().unwrap();
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::schema::ensure_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO repos (id, name, default_branch) VALUES ('r-1', 'r', 'main')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspaces (id, repository_id, directory_name, state, status)
             VALUES ('w-1', 'r-1', 'd', 'ready', 'in-progress')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, status, title) VALUES (?1, 'w-1', ?2, 't')",
            rusqlite::params!["s-1", session_status],
        )
        .unwrap();
        drop(conn);

        f();

        std::env::remove_var("HELMOR_DATA_DIR");
    }

    fn ctx() -> ExchangeContext {
        ExchangeContext {
            helmor_session_id: "s-1".to_string(),
            model_id: "opus".to_string(),
            model_provider: "claude".to_string(),
            user_message_id: "user-1".to_string(),
        }
    }

    fn session_status() -> String {
        let db_path = crate::data_dir::db_path().unwrap();
        rusqlite::Connection::open(db_path)
            .unwrap()
            .query_row("SELECT status FROM sessions WHERE id = 's-1'", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap()
    }

    fn error_message_count() -> i64 {
        let db_path = crate::data_dir::db_path().unwrap();
        rusqlite::Connection::open(db_path)
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM session_messages
                 WHERE session_id = 's-1' AND content LIKE '%sidecar%'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
    }

    #[test]
    fn finalizes_session_to_idle_and_persists_error_message() {
        with_session("streaming", || {
            let persisted = cleanup_abnormal_stream_exit(
                "rid-1",
                Some(&ctx()),
                "opus",
                "sidecar dead, retry",
                None,
                None,
            );
            assert!(persisted, "expected persisted=true on successful finalize");
            assert_eq!(session_status(), "idle");
            assert_eq!(error_message_count(), 1);
        });
    }

    #[test]
    fn returns_false_and_does_not_touch_db_when_exchange_ctx_is_none() {
        with_session("streaming", || {
            let persisted =
                cleanup_abnormal_stream_exit("rid-2", None, "opus", "sidecar dead", None, None);
            assert!(!persisted);
            assert_eq!(session_status(), "streaming");
            assert_eq!(error_message_count(), 0);
        });
    }

    #[test]
    fn returns_false_when_session_row_does_not_exist() {
        with_session("streaming", || {
            let mut bad_ctx = ctx();
            bad_ctx.helmor_session_id = "nonexistent".to_string();
            let persisted = cleanup_abnormal_stream_exit(
                "rid-3",
                Some(&bad_ctx),
                "opus",
                "sidecar dead",
                None,
                None,
            );
            assert!(!persisted);
        });
    }
}
