use anyhow::{bail, Context, Result};
#[cfg(test)]
use rusqlite::Connection;
use rusqlite::Transaction;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use super::db;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationAnchorContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub delegation_id: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub title: String,
    pub provider: String,
    pub model_id: Option<String>,
    pub status: String,
    pub output_schema: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationRecord {
    pub id: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub parent_message_id: String,
    pub provider: String,
    pub model_id: Option<String>,
    pub title: String,
    pub status: String,
    pub output_schema: Value,
    pub structured_result: Option<Value>,
    pub error: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateDelegationInput {
    pub parent_session_id: String,
    pub provider: String,
    pub model_id: Option<String>,
    pub title: Option<String>,
    pub output_schema: Value,
}

#[derive(Debug, Clone)]
pub struct CreatedDelegation {
    pub id: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub parent_message_id: String,
    pub workspace_id: String,
    pub title: String,
}

pub fn create_delegation_anchor(input: CreateDelegationInput) -> Result<CreatedDelegation> {
    tauri::async_runtime::block_on(create_delegation_anchor_async(input))
}

pub async fn create_delegation_anchor_async(
    input: CreateDelegationInput,
) -> Result<CreatedDelegation> {
    db::libsql_write_async(|connection| async move {
        let transaction = connection
            .transaction_with_behavior(libsql::TransactionBehavior::Immediate)
            .await
            .context("Failed to start delegation transaction")?;
        let created = create_delegation_anchor_in_transaction(&transaction, input).await?;
        transaction
            .commit()
            .await
            .context("Failed to commit delegation creation")?;
        Ok(created)
    })
    .await
}

async fn create_delegation_anchor_in_transaction(
    transaction: &libsql::Transaction,
    input: CreateDelegationInput,
) -> Result<CreatedDelegation> {
    let now = db::current_timestamp()?;
    let mut rows = transaction
        .query(
            "SELECT workspace_id, agent_type FROM sessions WHERE id = ?1",
            [input.parent_session_id.clone()],
        )
        .await
        .with_context(|| {
            format!(
                "Failed to resolve parent session {}",
                input.parent_session_id
            )
        })?;
    let Some(row) = rows.next().await? else {
        bail!(
            "Failed to resolve parent session {}",
            input.parent_session_id
        );
    };
    let workspace_id: String = row.get(0).context("Failed to read parent workspace id")?;
    let parent_provider: Option<String> = row
        .get(1)
        .context("Failed to read parent session provider")?;

    if parent_provider.as_deref() == Some(input.provider.as_str()) {
        bail!("delegate_agent cannot delegate to the same provider in this version");
    }

    let delegation_id = Uuid::new_v4().to_string();
    let child_session_id = Uuid::new_v4().to_string();
    let parent_message_id = Uuid::new_v4().to_string();
    let title = input
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Delegated task")
        .to_string();

    transaction
        .execute(
            r#"
            INSERT INTO sessions (id, workspace_id, status, title, permission_mode, model, agent_type)
            VALUES (?1, ?2, 'running', ?3, 'default', ?4, ?5)
            "#,
            libsql::params![
                child_session_id.clone(),
                workspace_id.clone(),
                title.clone(),
                input.model_id.clone(),
                input.provider.clone(),
            ],
        )
        .await
        .context("Failed to create child delegation session")?;

    transaction
        .execute(
            r#"
            INSERT INTO session_delegations (
                id, parent_session_id, child_session_id, parent_message_id,
                provider, model_id, title, status, output_schema, created_at, started_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8, ?9, ?9)
            "#,
            libsql::params![
                delegation_id.clone(),
                input.parent_session_id.clone(),
                child_session_id.clone(),
                parent_message_id.clone(),
                input.provider.clone(),
                input.model_id.clone(),
                title.clone(),
                input.output_schema.to_string(),
                now.clone(),
            ],
        )
        .await
        .context("Failed to create delegation metadata")?;

    let content = anchor_content_from_transaction(transaction, &delegation_id).await?;
    transaction
        .execute(
            r#"
            INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at)
            VALUES (?1, ?2, 'assistant', ?3, ?4, ?4)
            "#,
            libsql::params![
                parent_message_id.clone(),
                input.parent_session_id.clone(),
                serde_json::to_string(&content)?,
                now.clone(),
            ],
        )
        .await
        .context("Failed to insert delegation anchor message")?;

    Ok(CreatedDelegation {
        id: delegation_id,
        parent_session_id: input.parent_session_id,
        child_session_id,
        parent_message_id,
        workspace_id,
        title,
    })
}

pub fn update_delegation_status(
    delegation_id: &str,
    status: &str,
    structured_result: Option<&Value>,
    error: Option<&str>,
) -> Result<DelegationRecord> {
    tauri::async_runtime::block_on(update_delegation_status_async(
        delegation_id,
        status,
        structured_result.cloned(),
        error.map(str::to_string),
    ))
}

pub async fn update_delegation_status_async(
    delegation_id: &str,
    status: &str,
    structured_result: Option<Value>,
    error: Option<String>,
) -> Result<DelegationRecord> {
    let completed_at = if matches!(status, "succeeded" | "failed" | "timeout" | "cancelled") {
        Some(db::current_timestamp()?)
    } else {
        None
    };
    let delegation_id = delegation_id.to_string();
    let status = status.to_string();
    let structured_result = structured_result.map(|value| value.to_string());
    db::libsql_write_async(|connection| async move {
        let transaction = connection
            .transaction_with_behavior(libsql::TransactionBehavior::Immediate)
            .await
            .context("Failed to start delegation update transaction")?;

        transaction
            .execute(
                r#"
                    UPDATE session_delegations
                    SET status = ?2,
                        structured_result = ?3,
                        error = ?4,
                        completed_at = COALESCE(?5, completed_at)
                    WHERE id = ?1
                "#,
                libsql::params![
                    delegation_id.clone(),
                    status.clone(),
                    structured_result.clone(),
                    error.clone(),
                    completed_at.clone(),
                ],
            )
            .await
            .with_context(|| format!("Failed to update delegation {delegation_id}"))?;

        let content = anchor_content_from_transaction(&transaction, &delegation_id).await?;
        let record = get_delegation_in_transaction(&transaction, &delegation_id).await?;
        transaction
            .execute(
                "UPDATE session_messages SET content = ?2 WHERE id = ?1",
                libsql::params![
                    record.parent_message_id.clone(),
                    serde_json::to_string(&content)?
                ],
            )
            .await
            .context("Failed to refresh delegation anchor content")?;

        transaction
            .commit()
            .await
            .context("Failed to commit delegation update")?;
        Ok(record)
    })
    .await
}

pub fn get_delegation(delegation_id: &str) -> Result<DelegationRecord> {
    tauri::async_runtime::block_on(get_delegation_async(delegation_id))
}

pub fn get_delegations_for_parent(parent_session_id: &str) -> Result<Vec<DelegationRecord>> {
    tauri::async_runtime::block_on(get_delegations_for_parent_async(parent_session_id))
}

pub async fn get_delegations_for_parent_async(
    parent_session_id: &str,
) -> Result<Vec<DelegationRecord>> {
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            r#"
        SELECT id, parent_session_id, child_session_id, parent_message_id,
               provider, model_id, title, status, output_schema,
               structured_result, error, created_at, started_at, completed_at
        FROM session_delegations
        WHERE parent_session_id = ?1
        ORDER BY datetime(created_at) ASC
        "#,
            [parent_session_id.to_string()],
        )
        .await
        .context("Failed to query parent delegations")?;
    let mut records = Vec::new();
    while let Some(row) = rows.next().await? {
        records.push(record_from_libsql_row(&row)?);
    }
    Ok(records)
}

pub fn parent_for_child_session(child_session_id: &str) -> Result<Option<(String, String)>> {
    tauri::async_runtime::block_on(parent_for_child_session_async(child_session_id))
}

async fn get_delegation_async(delegation_id: &str) -> Result<DelegationRecord> {
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            r#"
            SELECT id, parent_session_id, child_session_id, parent_message_id,
                   provider, model_id, title, status, output_schema,
                   structured_result, error, created_at, started_at, completed_at
            FROM session_delegations
            WHERE id = ?1
            "#,
            [delegation_id.to_string()],
        )
        .await
        .with_context(|| format!("Failed to load delegation {delegation_id}"))?;
    match rows.next().await? {
        Some(row) => record_from_libsql_row(&row),
        None => bail!("Failed to load delegation {delegation_id}"),
    }
}

async fn parent_for_child_session_async(
    child_session_id: &str,
) -> Result<Option<(String, String)>> {
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            "SELECT parent_session_id, parent_message_id FROM session_delegations WHERE child_session_id = ?1",
            [child_session_id.to_string()],
        )
        .await
        .context("Failed to lookup child delegation parent")?;
    rows.next()
        .await?
        .map(|row| {
            Ok((
                row.get(0).context("Failed to read parent session id")?,
                row.get(1).context("Failed to read parent message id")?,
            ))
        })
        .transpose()
}

pub(crate) fn child_session_ids_for_parent(
    transaction: &Transaction<'_>,
    parent_session_id: &str,
) -> Result<Vec<String>> {
    let mut statement = transaction
        .prepare("SELECT child_session_id FROM session_delegations WHERE parent_session_id = ?1")?;
    let rows = statement.query_map([parent_session_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

async fn anchor_content_from_transaction(
    transaction: &libsql::Transaction,
    delegation_id: &str,
) -> Result<DelegationAnchorContent> {
    let record = get_delegation_in_transaction(transaction, delegation_id).await?;
    Ok(DelegationAnchorContent {
        content_type: "delegation_anchor".to_string(),
        delegation_id: record.id,
        parent_session_id: record.parent_session_id,
        child_session_id: record.child_session_id,
        title: record.title,
        provider: record.provider,
        model_id: record.model_id,
        status: record.status,
        output_schema: record.output_schema,
        structured_result: record.structured_result,
        error: record.error,
        created_at: record.created_at,
        started_at: record.started_at,
        completed_at: record.completed_at,
    })
}

async fn get_delegation_in_transaction(
    transaction: &libsql::Transaction,
    delegation_id: &str,
) -> Result<DelegationRecord> {
    let mut rows = transaction
        .query(
            r#"
            SELECT id, parent_session_id, child_session_id, parent_message_id,
                   provider, model_id, title, status, output_schema,
                   structured_result, error, created_at, started_at, completed_at
            FROM session_delegations
            WHERE id = ?1
            "#,
            [delegation_id.to_string()],
        )
        .await
        .with_context(|| format!("Failed to load delegation {delegation_id}"))?;
    match rows.next().await? {
        Some(row) => record_from_libsql_row(&row),
        None => bail!("Failed to load delegation {delegation_id}"),
    }
}

fn record_from_libsql_row(row: &libsql::Row) -> Result<DelegationRecord> {
    let output_schema_raw: String = row.get(8).context("Failed to read delegation schema")?;
    let structured_result_raw: Option<String> =
        row.get(9).context("Failed to read delegation result")?;
    Ok(DelegationRecord {
        id: row.get(0).context("Failed to read delegation id")?,
        parent_session_id: row
            .get(1)
            .context("Failed to read delegation parent session id")?,
        child_session_id: row
            .get(2)
            .context("Failed to read delegation child session id")?,
        parent_message_id: row
            .get(3)
            .context("Failed to read delegation parent message id")?,
        provider: row.get(4).context("Failed to read delegation provider")?,
        model_id: row.get(5).context("Failed to read delegation model")?,
        title: row.get(6).context("Failed to read delegation title")?,
        status: row.get(7).context("Failed to read delegation status")?,
        output_schema: serde_json::from_str(&output_schema_raw).unwrap_or_else(|_| json!({})),
        structured_result: structured_result_raw.and_then(|raw| serde_json::from_str(&raw).ok()),
        error: row.get(10).context("Failed to read delegation error")?,
        created_at: row
            .get(11)
            .context("Failed to read delegation created_at")?,
        started_at: row
            .get(12)
            .context("Failed to read delegation started_at")?,
        completed_at: row
            .get(13)
            .context("Failed to read delegation completed_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_parent_session(conn: &Connection) {
        conn.execute(
            "INSERT INTO repos (id, name, root_path) VALUES ('repo-1', 'repo', '/tmp/repo')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspaces (id, repository_id, directory_name, state, status)
             VALUES ('workspace-1', 'repo-1', 'repo', 'active', 'in-progress')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, status, title, agent_type)
             VALUES ('parent-session', 'workspace-1', 'running', 'Parent', 'pi')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn delegation_anchor_uses_chat_timestamp_format_for_ordering() {
        let _env = crate::testkit::TestEnv::new("delegation-anchor-order");
        {
            let conn = Connection::open(crate::data_dir::db_path().unwrap()).unwrap();
            seed_parent_session(&conn);
            let now = db::current_timestamp().unwrap();
            conn.execute(
                r#"
                INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at)
                VALUES ('user-message', 'parent-session', 'user', '{"type":"user_prompt","text":"delegate please"}', ?1, ?1)
                "#,
                [&now],
            )
            .unwrap();
        }

        let created = create_delegation_anchor(CreateDelegationInput {
            parent_session_id: "parent-session".to_string(),
            provider: "codex".to_string(),
            model_id: Some("gpt-5.4".to_string()),
            title: Some("Capybara joke delegate".to_string()),
            output_schema: json!({ "type": "object" }),
        })
        .unwrap();

        {
            let conn = Connection::open(crate::data_dir::db_path().unwrap()).unwrap();
            let rows = conn
                .prepare(
                    "SELECT id, sent_at FROM session_messages WHERE session_id = 'parent-session' ORDER BY sent_at ASC, rowid ASC",
                )
                .unwrap()
                .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                .unwrap()
                .collect::<std::result::Result<Vec<_>, _>>()
                .unwrap();

            assert_eq!(rows[0].0, "user-message");
            assert_eq!(rows[1].0, created.parent_message_id);
            assert!(
                rows[1].1.contains('T') && rows[1].1.ends_with('Z'),
                "delegation anchor sent_at should use the same RFC3339 format as chat messages: {}",
                rows[1].1
            );
        }

        let completed =
            update_delegation_status(&created.id, "succeeded", Some(&json!({ "ok": true })), None)
                .unwrap();
        let completed_at = completed.completed_at.as_deref().unwrap_or_default();
        assert!(
            completed_at.contains('T') && completed_at.ends_with('Z'),
            "delegation completion should use RFC3339 timestamps: {completed_at}"
        );
    }
}
