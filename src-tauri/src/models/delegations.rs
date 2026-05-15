use anyhow::{bail, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
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
    let mut connection = db::write_conn()?;
    let transaction = connection
        .transaction()
        .context("Failed to start delegation transaction")?;
    let created = create_delegation_anchor_in_transaction(&transaction, input)?;
    transaction
        .commit()
        .context("Failed to commit delegation creation")?;
    Ok(created)
}

pub fn create_delegation_anchor_in_transaction(
    transaction: &Transaction<'_>,
    input: CreateDelegationInput,
) -> Result<CreatedDelegation> {
    let now = db::current_timestamp()?;
    let (workspace_id, parent_provider): (String, Option<String>) = transaction
        .query_row(
            "SELECT workspace_id, agent_type FROM sessions WHERE id = ?1",
            [&input.parent_session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| {
            format!(
                "Failed to resolve parent session {}",
                input.parent_session_id
            )
        })?;

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
            params![
                &child_session_id,
                &workspace_id,
                &title,
                input.model_id.as_deref(),
                &input.provider,
            ],
        )
        .context("Failed to create child delegation session")?;

    transaction
        .execute(
            r#"
            INSERT INTO session_delegations (
                id, parent_session_id, child_session_id, parent_message_id,
                provider, model_id, title, status, output_schema, created_at, started_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8, ?9, ?9)
            "#,
            params![
                &delegation_id,
                &input.parent_session_id,
                &child_session_id,
                &parent_message_id,
                &input.provider,
                input.model_id.as_deref(),
                &title,
                input.output_schema.to_string(),
                &now,
            ],
        )
        .context("Failed to create delegation metadata")?;

    let content = anchor_content_from_transaction(transaction, &delegation_id)?;
    transaction
        .execute(
            r#"
            INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at)
            VALUES (?1, ?2, 'assistant', ?3, ?4, ?4)
            "#,
            params![
                &parent_message_id,
                &input.parent_session_id,
                serde_json::to_string(&content)?,
                &now,
            ],
        )
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
    let mut connection = db::write_conn()?;
    let transaction = connection
        .transaction()
        .context("Failed to start delegation update transaction")?;

    let completed_at = if matches!(status, "succeeded" | "failed" | "timeout" | "cancelled") {
        Some(db::current_timestamp()?)
    } else {
        None
    };
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
            params![
                delegation_id,
                status,
                structured_result.map(Value::to_string),
                error,
                completed_at.as_deref(),
            ],
        )
        .with_context(|| format!("Failed to update delegation {delegation_id}"))?;

    let content = anchor_content_from_transaction(&transaction, delegation_id)?;
    let record = get_delegation_in_transaction(&transaction, delegation_id)?;
    transaction
        .execute(
            "UPDATE session_messages SET content = ?2 WHERE id = ?1",
            params![&record.parent_message_id, serde_json::to_string(&content)?],
        )
        .context("Failed to refresh delegation anchor content")?;

    transaction
        .commit()
        .context("Failed to commit delegation update")?;
    Ok(record)
}

pub fn get_delegation(delegation_id: &str) -> Result<DelegationRecord> {
    let connection = db::read_conn()?;
    get_delegation_with_connection(&connection, delegation_id)
}

pub fn get_delegations_for_parent(parent_session_id: &str) -> Result<Vec<DelegationRecord>> {
    let connection = db::read_conn()?;
    let mut statement = connection.prepare(
        r#"
        SELECT id, parent_session_id, child_session_id, parent_message_id,
               provider, model_id, title, status, output_schema,
               structured_result, error, created_at, started_at, completed_at
        FROM session_delegations
        WHERE parent_session_id = ?1
        ORDER BY datetime(created_at) ASC
        "#,
    )?;
    let rows = statement.query_map([parent_session_id], record_from_row)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn parent_for_child_session(child_session_id: &str) -> Result<Option<(String, String)>> {
    let connection = db::read_conn()?;
    connection
        .query_row(
            "SELECT parent_session_id, parent_message_id FROM session_delegations WHERE child_session_id = ?1",
            [child_session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .context("Failed to lookup child delegation parent")
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

fn anchor_content_from_transaction(
    transaction: &Transaction<'_>,
    delegation_id: &str,
) -> Result<DelegationAnchorContent> {
    let record = get_delegation_in_transaction(transaction, delegation_id)?;
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

fn get_delegation_in_transaction(
    transaction: &Transaction<'_>,
    delegation_id: &str,
) -> Result<DelegationRecord> {
    transaction
        .query_row(
            r#"
            SELECT id, parent_session_id, child_session_id, parent_message_id,
                   provider, model_id, title, status, output_schema,
                   structured_result, error, created_at, started_at, completed_at
            FROM session_delegations
            WHERE id = ?1
            "#,
            [delegation_id],
            record_from_row,
        )
        .with_context(|| format!("Failed to load delegation {delegation_id}"))
}

fn get_delegation_with_connection(
    connection: &Connection,
    delegation_id: &str,
) -> Result<DelegationRecord> {
    connection
        .query_row(
            r#"
            SELECT id, parent_session_id, child_session_id, parent_message_id,
                   provider, model_id, title, status, output_schema,
                   structured_result, error, created_at, started_at, completed_at
            FROM session_delegations
            WHERE id = ?1
            "#,
            [delegation_id],
            record_from_row,
        )
        .with_context(|| format!("Failed to load delegation {delegation_id}"))
}

fn record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DelegationRecord> {
    let output_schema_raw: String = row.get(8)?;
    let structured_result_raw: Option<String> = row.get(9)?;
    Ok(DelegationRecord {
        id: row.get(0)?,
        parent_session_id: row.get(1)?,
        child_session_id: row.get(2)?,
        parent_message_id: row.get(3)?,
        provider: row.get(4)?,
        model_id: row.get(5)?,
        title: row.get(6)?,
        status: row.get(7)?,
        output_schema: serde_json::from_str(&output_schema_raw).unwrap_or_else(|_| json!({})),
        structured_result: structured_result_raw.and_then(|raw| serde_json::from_str(&raw).ok()),
        error: row.get(10)?,
        created_at: row.get(11)?,
        started_at: row.get(12)?,
        completed_at: row.get(13)?,
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
            let conn = db::write_conn().unwrap();
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
            let conn = db::read_conn().unwrap();
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
