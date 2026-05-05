use anyhow::{bail, Context, Result};
use rusqlite::Row;
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
    ensure_goal_workspace(goal_workspace_id)?;
    let connection = db::read_conn()?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, goal_workspace_id, title, description, lane, sort_order,
                   assigned_provider, assigned_model_id, assigned_effort_level,
                   child_workspace_id, created_at, updated_at
            FROM goal_cards
            WHERE goal_workspace_id = ?1
            ORDER BY sort_order ASC, datetime(created_at) ASC, id ASC
            "#,
        )
        .context("Failed to prepare goal card list query")?;
    let rows = statement.query_map([goal_workspace_id], goal_card_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(crate) fn upsert_goal_card(input: UpsertGoalCardInput) -> Result<GoalCard> {
    ensure_goal_workspace(&input.goal_workspace_id)?;
    let title = input.title.trim();
    if title.is_empty() {
        bail!("Goal card title is required");
    }

    let id = input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let lane = input.lane.unwrap_or(WorkspaceStatus::Backlog);
    let sort_order = input
        .sort_order
        .unwrap_or_else(|| next_goal_card_sort_order(&input.goal_workspace_id).unwrap_or(0));
    let timestamp = db::current_timestamp()?;
    let connection = db::write_conn()?;
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
            rusqlite::params![
                id,
                input.goal_workspace_id,
                title,
                normalize_optional(input.description),
                lane,
                sort_order,
                normalize_optional(input.assigned_provider),
                normalize_optional(input.assigned_model_id),
                normalize_optional(input.assigned_effort_level),
                normalize_optional(input.child_workspace_id),
                timestamp,
            ],
        )
        .context("Failed to upsert goal card")?;

    get_goal_card(&id)
}

pub(crate) fn link_goal_card_workspace(goal_card_id: &str, workspace_id: &str) -> Result<GoalCard> {
    let timestamp = db::current_timestamp()?;
    let connection = db::write_conn()?;
    let updated = connection
        .execute(
            "UPDATE goal_cards SET child_workspace_id = ?2, updated_at = ?3 WHERE id = ?1",
            (goal_card_id, workspace_id, timestamp),
        )
        .context("Failed to link goal card workspace")?;
    if updated != 1 {
        bail!("Goal card not found: {goal_card_id}");
    }
    get_goal_card(goal_card_id)
}

fn get_goal_card(goal_card_id: &str) -> Result<GoalCard> {
    let connection = db::read_conn()?;
    let mut statement = connection.prepare(
        r#"
        SELECT id, goal_workspace_id, title, description, lane, sort_order,
               assigned_provider, assigned_model_id, assigned_effort_level,
               child_workspace_id, created_at, updated_at
        FROM goal_cards
        WHERE id = ?1
        "#,
    )?;
    let mut rows = statement.query_map([goal_card_id], goal_card_from_row)?;
    match rows.next() {
        Some(row) => Ok(row?),
        None => bail!("Goal card not found: {goal_card_id}"),
    }
}

fn next_goal_card_sort_order(goal_workspace_id: &str) -> Result<i64> {
    let connection = db::read_conn()?;
    let current: Option<i64> = connection.query_row(
        "SELECT MAX(sort_order) FROM goal_cards WHERE goal_workspace_id = ?1",
        [goal_workspace_id],
        |row| row.get(0),
    )?;
    Ok(current.unwrap_or(-1) + 1)
}

fn ensure_goal_workspace(goal_workspace_id: &str) -> Result<()> {
    let Some(record) = crate::models::workspaces::load_workspace_record_by_id(goal_workspace_id)?
    else {
        bail!("Goal workspace not found: {goal_workspace_id}");
    };
    if record.workspace_kind != WorkspaceKind::Goal {
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

fn goal_card_from_row(row: &Row<'_>) -> rusqlite::Result<GoalCard> {
    Ok(GoalCard {
        id: row.get(0)?,
        goal_workspace_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        lane: row.get(4)?,
        sort_order: row.get(5)?,
        assigned_provider: row.get(6)?,
        assigned_model_id: row.get(7)?,
        assigned_effort_level: row.get(8)?,
        child_workspace_id: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}
