use std::str::FromStr;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::{models::db, workspace_kind::WorkspaceKind, workspace_status::WorkspaceStatus};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalCard {
    pub id: String,
    pub goal_workspace_id: String,
    pub title: String,
    pub description: Option<String>,
    pub lane: WorkspaceStatus,
    pub sort_order: i64,
    pub assigned_provider: Option<String>,
    pub assigned_model_id: Option<String>,
    pub assigned_effort_level: Option<String>,
    pub child_workspace_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertGoalCardInput {
    pub id: Option<String>,
    pub goal_workspace_id: String,
    pub title: String,
    pub description: Option<String>,
    pub lane: Option<WorkspaceStatus>,
    pub sort_order: Option<i64>,
    pub assigned_provider: Option<String>,
    pub assigned_model_id: Option<String>,
    pub assigned_effort_level: Option<String>,
    pub child_workspace_id: Option<String>,
}

pub(crate) fn list_goal_cards(goal_workspace_id: &str) -> Result<Vec<GoalCard>> {
    tauri::async_runtime::block_on(list_goal_cards_async(goal_workspace_id))
}

pub(crate) fn upsert_goal_card(input: UpsertGoalCardInput) -> Result<GoalCard> {
    tauri::async_runtime::block_on(upsert_goal_card_async(input))
}

pub(crate) fn link_goal_card_workspace(goal_card_id: &str, workspace_id: &str) -> Result<GoalCard> {
    tauri::async_runtime::block_on(link_goal_card_workspace_async(goal_card_id, workspace_id))
}

async fn list_goal_cards_async(goal_workspace_id: &str) -> Result<Vec<GoalCard>> {
    ensure_goal_workspace_async(goal_workspace_id).await?;
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            r#"
            SELECT id, goal_workspace_id, title, description, lane, sort_order,
                   assigned_provider, assigned_model_id, assigned_effort_level,
                   child_workspace_id, created_at, updated_at
            FROM goal_cards
            WHERE goal_workspace_id = ?1
            ORDER BY sort_order ASC, datetime(created_at) ASC, id ASC
            "#,
            [goal_workspace_id.to_string()],
        )
        .await
        .context("Failed to query goal cards")?;

    let mut cards = Vec::new();
    while let Some(row) = rows.next().await? {
        cards.push(goal_card_from_libsql_row(&row)?);
    }
    Ok(cards)
}

async fn upsert_goal_card_async(input: UpsertGoalCardInput) -> Result<GoalCard> {
    ensure_goal_workspace_async(&input.goal_workspace_id).await?;
    let title = input.title.trim().to_string();
    if title.is_empty() {
        bail!("Goal card title is required");
    }

    let id = input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let lane = input.lane.unwrap_or(WorkspaceStatus::Backlog);
    let sort_order = match input.sort_order {
        Some(sort_order) => sort_order,
        None => next_goal_card_sort_order_async(&input.goal_workspace_id)
            .await
            .unwrap_or(0),
    };
    let timestamp = db::current_timestamp()?;
    let goal_workspace_id = input.goal_workspace_id;
    let description = normalize_optional(input.description);
    let assigned_provider = normalize_optional(input.assigned_provider);
    let assigned_model_id = normalize_optional(input.assigned_model_id);
    let assigned_effort_level = normalize_optional(input.assigned_effort_level);
    let child_workspace_id = normalize_optional(input.child_workspace_id);
    let inserted_id = id.clone();
    db::libsql_write_async(|connection| async move {
        connection
            .execute(
                r#"
            INSERT INTO goal_cards (
              id, goal_workspace_id, title, description, lane, sort_order,
              assigned_provider, assigned_model_id, assigned_effort_level,
              child_workspace_id, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              description = excluded.description,
              lane = excluded.lane,
              sort_order = excluded.sort_order,
              assigned_provider = excluded.assigned_provider,
              assigned_model_id = excluded.assigned_model_id,
              assigned_effort_level = excluded.assigned_effort_level,
              child_workspace_id = excluded.child_workspace_id,
              updated_at = excluded.updated_at
            "#,
                libsql::params![
                    inserted_id,
                    goal_workspace_id,
                    title,
                    description,
                    lane.as_str(),
                    sort_order,
                    assigned_provider,
                    assigned_model_id,
                    assigned_effort_level,
                    child_workspace_id,
                    timestamp,
                ],
            )
            .await
            .context("Failed to upsert goal card")?;
        Ok(())
    })
    .await?;

    get_goal_card_async(&id).await
}

async fn link_goal_card_workspace_async(
    goal_card_id: &str,
    workspace_id: &str,
) -> Result<GoalCard> {
    let timestamp = db::current_timestamp()?;
    let goal_card_id = goal_card_id.to_string();
    let workspace_id = workspace_id.to_string();
    let update_goal_card_id = goal_card_id.clone();
    let updated = db::libsql_write_async(|connection| async move {
        connection
            .execute(
                "UPDATE goal_cards SET child_workspace_id = ?2, updated_at = ?3 WHERE id = ?1",
                (update_goal_card_id, workspace_id, timestamp),
            )
            .await
            .context("Failed to link goal card workspace")
    })
    .await?;
    if updated != 1 {
        bail!("Goal card not found: {goal_card_id}");
    }
    get_goal_card_async(&goal_card_id).await
}

async fn get_goal_card_async(goal_card_id: &str) -> Result<GoalCard> {
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            r#"
        SELECT id, goal_workspace_id, title, description, lane, sort_order,
               assigned_provider, assigned_model_id, assigned_effort_level,
               child_workspace_id, created_at, updated_at
        FROM goal_cards
        WHERE id = ?1
        "#,
            [goal_card_id.to_string()],
        )
        .await
        .with_context(|| format!("Failed to query goal card {goal_card_id}"))?;
    match rows.next().await? {
        Some(row) => goal_card_from_libsql_row(&row),
        None => bail!("Goal card not found: {goal_card_id}"),
    }
}

async fn next_goal_card_sort_order_async(goal_workspace_id: &str) -> Result<i64> {
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            "SELECT MAX(sort_order) FROM goal_cards WHERE goal_workspace_id = ?1",
            [goal_workspace_id.to_string()],
        )
        .await
        .context("Failed to query next goal card sort order")?;
    let current = match rows.next().await? {
        Some(row) => row.get::<Option<i64>>(0)?,
        None => None,
    };
    Ok(current.unwrap_or(-1) + 1)
}

async fn ensure_goal_workspace_async(goal_workspace_id: &str) -> Result<()> {
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            "SELECT workspace_kind FROM workspaces WHERE id = ?1",
            [goal_workspace_id.to_string()],
        )
        .await
        .with_context(|| format!("Failed to query goal workspace {goal_workspace_id}"))?;
    let Some(row) = rows.next().await? else {
        bail!("Goal workspace not found: {goal_workspace_id}");
    };
    let raw_kind: String = row.get(0).context("Failed to read workspace kind")?;
    let workspace_kind = WorkspaceKind::from_str(&raw_kind)?;
    if workspace_kind != WorkspaceKind::Goal {
        bail!("Workspace is not a Goal: {goal_workspace_id}");
    }
    Ok(())
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn goal_card_from_libsql_row(row: &libsql::Row) -> Result<GoalCard> {
    let lane_raw: String = row.get(4).context("Failed to read goal card lane")?;
    Ok(GoalCard {
        id: row.get(0).context("Failed to read goal card id")?,
        goal_workspace_id: row
            .get(1)
            .context("Failed to read goal card workspace id")?,
        title: row.get(2).context("Failed to read goal card title")?,
        description: row.get(3).context("Failed to read goal card description")?,
        lane: WorkspaceStatus::from_str(&lane_raw)?,
        sort_order: row.get(5).context("Failed to read goal card sort order")?,
        assigned_provider: row.get(6).context("Failed to read goal card provider")?,
        assigned_model_id: row.get(7).context("Failed to read goal card model")?,
        assigned_effort_level: row.get(8).context("Failed to read goal card effort")?,
        child_workspace_id: row
            .get(9)
            .context("Failed to read goal card child workspace")?,
        created_at: row.get(10).context("Failed to read goal card created_at")?,
        updated_at: row.get(11).context("Failed to read goal card updated_at")?,
    })
}
