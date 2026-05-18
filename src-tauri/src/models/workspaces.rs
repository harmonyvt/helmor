use std::{future::Future, str::FromStr};

use anyhow::{bail, Context, Result};

use crate::{
    repos,
    workspace_kind::WorkspaceKind,
    workspace_landing::{LandingSource, LandingState},
    workspace_pr_sync::PrSyncState,
    workspace_state::WorkspaceState,
    workspace_status::WorkspaceStatus,
};

use super::db;

fn block_on_workspace_db<T>(future: impl Future<Output = Result<T>>) -> Result<T> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(future)),
        Err(_) => tauri::async_runtime::block_on(future),
    }
}

#[derive(Debug)]
pub struct WorkspaceRecord {
    pub id: String,
    pub repo_id: String,
    pub repo_name: String,
    pub remote_url: Option<String>,
    pub default_branch: Option<String>,
    pub root_path: Option<String>,
    pub directory_name: String,
    pub workspace_kind: WorkspaceKind,
    pub goal_workspace_id: Option<String>,
    pub state: WorkspaceState,
    pub has_unread: bool,
    pub workspace_unread: i64,
    pub unread_session_count: i64,
    pub status: WorkspaceStatus,
    pub branch: Option<String>,
    pub initialization_parent_branch: Option<String>,
    pub intended_target_branch: Option<String>,
    pub pinned_at: Option<String>,
    pub active_session_id: Option<String>,
    pub active_session_title: Option<String>,
    pub active_session_agent_type: Option<String>,
    pub active_session_status: Option<String>,
    /// "Primary" session = the non-hidden, non-action session in this
    /// workspace with the most messages. Falls back to most recently
    /// updated when message counts tie. None for workspaces with no
    /// real conversation yet (only action / hidden sessions).
    pub primary_session_id: Option<String>,
    pub primary_session_title: Option<String>,
    pub primary_session_agent_type: Option<String>,
    pub pr_title: Option<String>,
    pub pr_sync_state: PrSyncState,
    pub pr_url: Option<String>,
    pub landing_state: LandingState,
    pub landing_source: Option<LandingSource>,
    pub landed_at: Option<String>,
    pub landed_target_branch: Option<String>,
    pub landed_source_ref: Option<String>,
    pub landed_commit_sha: Option<String>,
    pub initial_head_sha: Option<String>,
    pub last_known_head_sha: Option<String>,
    pub archive_commit: Option<String>,
    pub session_count: i64,
    pub message_count: i64,
    pub remote: Option<String>,
    pub forge_provider: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Most recent `last_user_message_at` across all sessions in the
    /// workspace. `None` for workspaces with no user messages yet.
    pub last_user_message_at: Option<String>,
    /// User-editable goal title (goal workspaces only). `None` means use the
    /// derived display title (PR title → session title → directory name).
    pub goal_title: Option<String>,
    /// User-editable goal description (goal workspaces only).
    pub goal_description: Option<String>,
}

pub const WORKSPACE_RECORD_SQL: &str = r#"
    WITH
    -- One per-session message count, computed once. Reused by both
    -- `message_stats` (workspace-level total via SUM) and
    -- `primary_session` (per-session ranking). Avoids scanning the
    -- (potentially huge) `session_messages` table twice. Index
    -- `idx_session_messages_sent_at(session_id, sent_at)` makes the
    -- group-by index-only.
    session_message_counts AS (
      SELECT session_id, COUNT(*) AS message_count
      FROM session_messages
      GROUP BY session_id
    ),
    -- Per-workspace session aggregates derived in a single sweep:
    -- session_count, unread_session_count, message_count, last_user_msg.
    -- One scan of `sessions` (covered by idx_sessions_workspace_id)
    -- + one LEFT JOIN to the cached session_message_counts.
    --
    -- `last_user_message_at` intentionally MAXes across ALL sessions
    -- (including hidden / action sessions). It signals "any user
    -- activity in this workspace at all" — distinct from
    -- `primary_session` below which excludes hidden / action sessions
    -- because that is for choosing the displayed conversation title.
    workspace_session_stats AS (
      SELECT
        s.workspace_id,
        COUNT(*) AS session_count,
        SUM(CASE WHEN COALESCE(s.unread_count, 0) > 0 THEN 1 ELSE 0 END) AS unread_session_count,
        COALESCE(SUM(smc.message_count), 0) AS message_count,
        MAX(s.last_user_message_at) AS last_user_message_at
      FROM sessions s
      LEFT JOIN session_message_counts smc ON smc.session_id = s.id
      GROUP BY s.workspace_id
    ),
    -- Pick the "real" conversation per workspace: the non-hidden,
    -- non-action session with the most messages. Ties broken by most
    -- recent updated_at, then session id for determinism. Action /
    -- hidden sessions (commit-and-push, create-pr, etc.) are excluded
    -- so a fleeting one-off doesn't masquerade as the workspace's
    -- topic.
    primary_session AS (
      SELECT session_id, workspace_id, session_title, session_agent_type
      FROM (
        SELECT
          s.id AS session_id,
          s.workspace_id,
          s.title AS session_title,
          s.agent_type AS session_agent_type,
          ROW_NUMBER() OVER (
            PARTITION BY s.workspace_id
            ORDER BY
              COALESCE(smc.message_count, 0) DESC,
              s.updated_at DESC,
              s.id DESC
          ) AS rn
        FROM sessions s
        LEFT JOIN session_message_counts smc ON smc.session_id = s.id
        WHERE COALESCE(s.is_hidden, 0) = 0
          AND s.action_kind IS NULL
      )
      WHERE rn = 1
    )
    SELECT
      w.id,
      r.id AS repo_id,
      r.name AS repo_name,
      r.remote_url,
      r.default_branch,
      r.root_path,
      w.directory_name,
      COALESCE(w.workspace_kind, 'code') AS workspace_kind,
      w.goal_workspace_id,
      w.state,
      CASE
        WHEN COALESCE(w.unread, 0) > 0 OR COALESCE(wss.unread_session_count, 0) > 0 THEN 1
        ELSE 0
      END AS has_unread,
      COALESCE(w.unread, 0) AS workspace_unread,
      COALESCE(wss.unread_session_count, 0) AS unread_session_count,
      COALESCE(w.status, 'in-progress') AS status,
      w.branch,
      w.initialization_parent_branch,
      w.intended_target_branch,
      w.pinned_at,
      w.active_session_id,
      s.title AS active_session_title,
      s.agent_type AS active_session_agent_type,
      s.status AS active_session_status,
      ps.session_id AS primary_session_id,
      ps.session_title AS primary_session_title,
      ps.session_agent_type AS primary_session_agent_type,
      w.pr_title,
      COALESCE(w.pr_sync_state, 'none') AS pr_sync_state,
      w.pr_url,
      COALESCE(w.landing_state, 'unlanded') AS landing_state,
      w.landing_source,
      w.landed_at,
      w.landed_target_branch,
      w.landed_source_ref,
      w.landed_commit_sha,
      w.initial_head_sha,
      w.last_known_head_sha,
      w.archive_commit,
      COALESCE(wss.session_count, 0) AS session_count,
      COALESCE(wss.message_count, 0) AS message_count,
      r.remote,
      r.forge_provider,
      w.created_at,
      w.updated_at,
      wss.last_user_message_at,
      w.goal_title,
      w.goal_description
    FROM workspaces w
    JOIN repos r ON r.id = w.repository_id
    LEFT JOIN sessions s ON s.id = w.active_session_id
    LEFT JOIN workspace_session_stats wss ON wss.workspace_id = w.id
    LEFT JOIN primary_session ps ON ps.workspace_id = w.id
"#;

pub fn load_workspace_records() -> Result<Vec<WorkspaceRecord>> {
    block_on_workspace_db(load_workspace_records_async())
}

async fn load_workspace_records_async() -> Result<Vec<WorkspaceRecord>> {
    let connection = db::libsql_conn_async().await?;
    let sql = format!(
        "{WORKSPACE_RECORD_SQL} ORDER BY datetime(w.created_at) DESC, datetime(w.updated_at) DESC, w.id DESC"
    );
    let mut rows = connection
        .query(&sql, ())
        .await
        .context("Failed to query workspace records")?;

    let mut records = Vec::new();
    while let Some(row) = rows.next().await? {
        records.push(workspace_record_from_libsql_row(&row)?);
    }
    Ok(records)
}

pub fn load_workspace_record_by_id(workspace_id: &str) -> Result<Option<WorkspaceRecord>> {
    block_on_workspace_db(load_workspace_record_by_id_async(workspace_id))
}

async fn load_workspace_record_by_id_async(workspace_id: &str) -> Result<Option<WorkspaceRecord>> {
    let connection = db::libsql_conn_async().await?;
    let sql = format!("{WORKSPACE_RECORD_SQL} WHERE w.id = ?1");
    let mut rows = connection
        .query(&sql, [workspace_id.to_string()])
        .await
        .with_context(|| format!("Failed to query workspace {workspace_id}"))?;

    match rows.next().await? {
        Some(row) => workspace_record_from_libsql_row(&row)
            .map(Some)
            .with_context(|| format!("Failed to deserialize workspace {workspace_id}")),
        None => Ok(None),
    }
}

pub(crate) fn load_goal_workspace_record(goal_workspace_id: &str) -> Result<WorkspaceRecord> {
    block_on_workspace_db(load_goal_workspace_record_async(goal_workspace_id))
}

async fn load_goal_workspace_record_async(goal_workspace_id: &str) -> Result<WorkspaceRecord> {
    let record = load_workspace_record_by_id_async(goal_workspace_id)
        .await?
        .with_context(|| format!("Goal workspace not found: {goal_workspace_id}"))?;
    if record.workspace_kind != WorkspaceKind::Goal {
        bail!("Workspace is not a Goal: {goal_workspace_id}");
    }
    Ok(record)
}

/// Return all child workspaces linked to a goal workspace, sorted oldest-first
/// so the Kanban board cards appear in a stable creation order.
pub fn load_goal_child_workspace_records(goal_workspace_id: &str) -> Result<Vec<WorkspaceRecord>> {
    block_on_workspace_db(load_goal_child_workspace_records_async(goal_workspace_id))
}

async fn load_goal_child_workspace_records_async(
    goal_workspace_id: &str,
) -> Result<Vec<WorkspaceRecord>> {
    let _goal = load_goal_workspace_record_async(goal_workspace_id).await?;
    let connection = db::libsql_conn_async().await?;
    let sql = format!(
        "{WORKSPACE_RECORD_SQL} \
         WHERE w.goal_workspace_id = ?1 \
         AND COALESCE(w.workspace_kind, 'code') = 'code' \
         AND w.state != ?2 \
         ORDER BY datetime(w.created_at) ASC, w.id ASC"
    );
    let mut rows = connection
        .query(
            &sql,
            libsql::params![goal_workspace_id, WorkspaceState::Archived.as_str()],
        )
        .await
        .context("Failed to query goal child workspaces")?;

    let mut records = Vec::new();
    while let Some(row) = rows.next().await? {
        records.push(workspace_record_from_libsql_row(&row)?);
    }
    Ok(records)
}

pub fn load_archived_workspace_records() -> Result<Vec<WorkspaceRecord>> {
    block_on_workspace_db(load_archived_workspace_records_async())
}

async fn load_archived_workspace_records_async() -> Result<Vec<WorkspaceRecord>> {
    let connection = db::libsql_conn_async().await?;
    let sql = format!(
        // Archived list sorts by `updated_at DESC` so the most recently
        // archived workspace shows at the top — `archive_workspace_impl`
        // explicitly bumps `updated_at` to `now` when transitioning the
        // state to 'archived', so this column doubles as "archived at"
        // for ordering purposes (no separate column needed).
        "{WORKSPACE_RECORD_SQL} WHERE w.state = ?1 ORDER BY w.updated_at DESC"
    );
    let mut rows = connection
        .query(&sql, [WorkspaceState::Archived.as_str()])
        .await
        .context("Failed to query archived workspaces")?;

    let mut records = Vec::new();
    while let Some(row) = rows.next().await? {
        records.push(workspace_record_from_libsql_row(&row)?);
    }
    Ok(records)
}

pub(crate) struct InitializingWorkspaceMetadata<'a> {
    pub(crate) initialization_parent_branch: &'a str,
    pub(crate) intended_target_branch: &'a str,
    pub(crate) workspace_kind: WorkspaceKind,
    pub(crate) goal_workspace_id: Option<&'a str>,
    pub(crate) status: WorkspaceStatus,
    pub(crate) pr_title: Option<&'a str>,
    pub(crate) pr_sync_state: PrSyncState,
    pub(crate) pr_url: Option<&'a str>,
    pub(crate) timestamp: &'a str,
}

#[allow(dead_code)]
pub(crate) fn insert_initializing_workspace_and_session(
    repository: &repos::RepositoryRecord,
    workspace_id: &str,
    session_id: &str,
    directory_name: &str,
    branch: &str,
    default_branch: &str,
    timestamp: &str,
) -> Result<()> {
    insert_initializing_workspace_and_session_with_metadata(
        repository,
        workspace_id,
        session_id,
        directory_name,
        branch,
        InitializingWorkspaceMetadata {
            initialization_parent_branch: default_branch,
            intended_target_branch: default_branch,
            workspace_kind: WorkspaceKind::Code,
            goal_workspace_id: None,
            status: WorkspaceStatus::InProgress,
            pr_title: None,
            pr_sync_state: PrSyncState::None,
            pr_url: None,
            timestamp,
        },
    )
}

pub(crate) fn insert_initializing_workspace_and_session_with_metadata(
    repository: &repos::RepositoryRecord,
    workspace_id: &str,
    session_id: &str,
    directory_name: &str,
    branch: &str,
    metadata: InitializingWorkspaceMetadata<'_>,
) -> Result<()> {
    let repository_id = repository.id.clone();
    let workspace_id = workspace_id.to_string();
    let session_id = session_id.to_string();
    let directory_name = directory_name.to_string();
    let branch = branch.to_string();
    let initialization_parent_branch = metadata.initialization_parent_branch.to_string();
    let intended_target_branch = metadata.intended_target_branch.to_string();
    let workspace_kind = metadata.workspace_kind;
    let goal_workspace_id = metadata.goal_workspace_id.map(str::to_string);
    let status = metadata.status;
    let pr_title = metadata.pr_title.map(str::to_string);
    let pr_sync_state = metadata.pr_sync_state;
    let pr_url = metadata.pr_url.map(str::to_string);
    let timestamp = metadata.timestamp.to_string();

    block_on_workspace_db(db::libsql_write_async(|connection| async move {
        let transaction = connection
            .transaction_with_behavior(libsql::TransactionBehavior::Immediate)
            .await
            .context("Failed to start create-workspace transaction")?;

        transaction
            .execute(
                r#"
            INSERT INTO workspaces (
              id,
              repository_id,
              directory_name,
              active_session_id,
              branch,
              state,
              workspace_kind,
              goal_workspace_id,
              initialization_parent_branch,
              intended_target_branch,
              status,
              pr_title,
              pr_sync_state,
              pr_url,
              unread,
              created_at,
              updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 0, ?15, ?15)
            "#,
                libsql::params![
                    workspace_id.clone(),
                    repository_id,
                    directory_name,
                    session_id.clone(),
                    branch,
                    WorkspaceState::Initializing.as_str(),
                    workspace_kind.as_str(),
                    goal_workspace_id,
                    initialization_parent_branch,
                    intended_target_branch,
                    status.as_str(),
                    pr_title,
                    pr_sync_state.as_str(),
                    pr_url,
                    timestamp.clone(),
                ],
            )
            .await
            .context("Failed to insert initializing workspace")?;

        transaction
            .execute(
                r#"
            INSERT INTO sessions (
              id,
              workspace_id,
              title,
              status,
              permission_mode,
              unread_count,
              fast_mode,
              created_at,
              updated_at,
              is_hidden
            ) VALUES (?1, ?2, 'Untitled', 'idle', 'default', 0, 0, ?3, ?3, 0)
            "#,
                libsql::params![session_id, workspace_id, timestamp],
            )
            .await
            .context("Failed to insert initial session")?;

        transaction
            .commit()
            .await
            .context("Failed to commit create-workspace transaction")
    }))
}

pub(crate) fn update_workspace_initial_head_sha(
    workspace_id: &str,
    initial_head_sha: Option<&str>,
) -> Result<()> {
    let workspace_id = workspace_id.to_string();
    let initial_head_sha = initial_head_sha.map(str::to_string);
    block_on_workspace_db(db::libsql_write_async(|connection| async move {
        connection
            .execute(
                "UPDATE workspaces SET initial_head_sha = ?2 WHERE id = ?1",
                libsql::params![workspace_id, initial_head_sha],
            )
            .await
            .context("Failed to update workspace initial_head_sha")?;
        Ok(())
    }))
}

pub(crate) fn update_workspace_state(
    workspace_id: &str,
    state: WorkspaceState,
    timestamp: &str,
) -> Result<()> {
    let workspace_id = workspace_id.to_string();
    let state = state.as_str().to_string();
    let timestamp = timestamp.to_string();
    block_on_workspace_db(db::libsql_write_async(|connection| async move {
        let updated_rows = connection
            .execute(
                "UPDATE workspaces SET state = ?2, updated_at = ?3 WHERE id = ?1",
                libsql::params![workspace_id.clone(), state.clone(), timestamp],
            )
            .await
            .with_context(|| format!("Failed to update workspace state to {state}"))?;

        if updated_rows != 1 {
            bail!("Workspace state update affected {updated_rows} rows for {workspace_id}");
        }

        Ok(())
    }))
}

pub(crate) fn delete_workspace_and_session_rows(workspace_id: &str) -> Result<()> {
    let workspace_id = workspace_id.to_string();
    block_on_workspace_db(db::libsql_write_async(|connection| async move {
        let transaction = connection
            .transaction_with_behavior(libsql::TransactionBehavior::Immediate)
            .await
            .context("Failed to start create cleanup transaction")?;

        transaction
            .execute(
                "DELETE FROM session_messages
             WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?1)",
                [workspace_id.clone()],
            )
            .await
            .context("Failed to delete create-flow session messages")?;
        transaction
            .execute(
                "DELETE FROM sessions WHERE workspace_id = ?1",
                [workspace_id.clone()],
            )
            .await
            .context("Failed to delete create-flow sessions")?;
        transaction
            .execute(
                "DELETE FROM workspace_browser_tabs WHERE workspace_id = ?1",
                [workspace_id.clone()],
            )
            .await
            .context("Failed to delete create-flow browser tabs")?;
        transaction
            .execute(
                "DELETE FROM goal_cards WHERE goal_workspace_id = ?1",
                [workspace_id.clone()],
            )
            .await
            .context("Failed to delete create-flow goal cards")?;
        transaction
            .execute(
                "UPDATE goal_cards SET child_workspace_id = NULL, updated_at = datetime('now') WHERE child_workspace_id = ?1",
                [workspace_id.clone()],
            )
            .await
            .context("Failed to unlink create-flow goal card workspace")?;
        transaction
            .execute(
                "UPDATE workspaces SET goal_workspace_id = NULL, updated_at = datetime('now') WHERE goal_workspace_id = ?1",
                [workspace_id.clone()],
            )
            .await
            .context("Failed to unlink create-flow goal child workspaces")?;
        transaction
            .execute("DELETE FROM workspaces WHERE id = ?1", [workspace_id])
            .await
            .context("Failed to delete create-flow workspace")?;

        transaction
            .commit()
            .await
            .context("Failed to commit create cleanup transaction")
    }))
}

/// Orphan lookup for the startup cleanup path: returns workspace rows
/// stuck in `initializing` state whose `created_at` is older than
/// `max_age_seconds` seconds ago. These are typically left behind when
/// the app was force-quit during Phase 2 of workspace creation.
pub(crate) fn list_initializing_workspaces_older_than(
    max_age_seconds: i64,
) -> Result<Vec<OrphanedInitializingWorkspace>> {
    block_on_workspace_db(list_initializing_workspaces_older_than_async(
        max_age_seconds,
    ))
}

async fn list_initializing_workspaces_older_than_async(
    max_age_seconds: i64,
) -> Result<Vec<OrphanedInitializingWorkspace>> {
    let connection = db::libsql_conn_async().await?;
    let cutoff = format!("datetime('now', '-{} seconds')", max_age_seconds.max(0));
    let sql = format!("{WORKSPACE_RECORD_SQL} WHERE w.state = ?1 AND w.created_at < {cutoff}",);
    let mut rows = connection
        .query(&sql, [WorkspaceState::Initializing.as_str()])
        .await
        .context("Failed to query initializing workspaces")?;

    let mut records = Vec::new();
    while let Some(row) = rows.next().await? {
        records.push(workspace_record_from_libsql_row(&row)?);
    }

    Ok(records
        .into_iter()
        .map(|record| OrphanedInitializingWorkspace { record })
        .collect())
}

pub(crate) struct OrphanedInitializingWorkspace {
    pub record: WorkspaceRecord,
}

pub(crate) fn update_archived_workspace_state(
    workspace_id: &str,
    archive_commit: &str,
) -> Result<()> {
    let workspace_id = workspace_id.to_string();
    let archive_commit = archive_commit.to_string();
    block_on_workspace_db(db::libsql_write_async(|connection| async move {
        let transaction = connection
            .transaction_with_behavior(libsql::TransactionBehavior::Immediate)
            .await
            .context("Failed to start archive transaction")?;

        let updated_rows = transaction
            .execute(
                r#"
            UPDATE workspaces
            SET state = ?3,
                archive_commit = ?2,
                updated_at = datetime('now')
            WHERE id = ?1 AND state IN (?4, ?5)
            "#,
                libsql::params![
                    workspace_id.clone(),
                    archive_commit,
                    WorkspaceState::Archived.as_str(),
                    WorkspaceState::Ready.as_str(),
                    WorkspaceState::SetupPending.as_str(),
                ],
            )
            .await
            .context("Failed to update workspace archive state")?;

        if updated_rows != 1 {
            bail!("Archive state update affected {updated_rows} rows for workspace {workspace_id}");
        }

        transaction
            .commit()
            .await
            .context("Failed to commit archive transaction")
    }))
}

pub(crate) fn update_restored_workspace_state(
    workspace_id: &str,
    target_branch_override: Option<&str>,
) -> Result<()> {
    let workspace_id = workspace_id.to_string();
    let target_branch_override = target_branch_override.map(str::to_string);
    block_on_workspace_db(db::libsql_write_async(|connection| async move {
        let transaction = connection
            .transaction_with_behavior(libsql::TransactionBehavior::Immediate)
            .await
            .context("Failed to start restore transaction")?;

        let updated_rows = transaction
            .execute(
                r#"
            UPDATE workspaces
            SET state = ?2,
                updated_at = datetime('now')
            WHERE id = ?1 AND state = ?3
            "#,
                libsql::params![
                    workspace_id.clone(),
                    WorkspaceState::Ready.as_str(),
                    WorkspaceState::Archived.as_str(),
                ],
            )
            .await
            .context("Failed to update workspace restore state")?;

        if updated_rows != 1 {
            bail!("Restore state update affected {updated_rows} rows for workspace {workspace_id}");
        }

        if let Some(new_target) = target_branch_override {
            transaction
                .execute(
                    "UPDATE workspaces SET intended_target_branch = ?1 WHERE id = ?2",
                    libsql::params![new_target, workspace_id],
                )
                .await
                .context("Failed to update intended_target_branch during restore")?;
        }

        transaction
            .commit()
            .await
            .context("Failed to commit restore transaction")
    }))
}

fn parse_required<T>(raw: String, column: &str) -> Result<T>
where
    T: FromStr,
    T::Err: std::fmt::Display + Send + Sync + 'static,
{
    raw.parse::<T>()
        .map_err(|error| anyhow::anyhow!("Failed to parse {column} {raw:?}: {error}"))
}

fn parse_optional<T>(raw: Option<String>, column: &str) -> Result<Option<T>>
where
    T: FromStr,
    T::Err: std::fmt::Display + Send + Sync + 'static,
{
    raw.map(|value| parse_required(value, column)).transpose()
}

fn workspace_record_from_libsql_row(row: &libsql::Row) -> Result<WorkspaceRecord> {
    let workspace_kind = parse_required(
        row.get(7).context("Failed to read workspace kind")?,
        "workspace_kind",
    )?;
    let state = parse_required(
        row.get(9).context("Failed to read workspace state")?,
        "state",
    )?;
    let status = parse_required(
        row.get(13).context("Failed to read workspace status")?,
        "status",
    )?;
    let pr_sync_state = parse_required(
        row.get(26)
            .context("Failed to read workspace PR sync state")?,
        "pr_sync_state",
    )?;
    let landing_state = parse_required(
        row.get(28)
            .context("Failed to read workspace landing state")?,
        "landing_state",
    )?;
    let landing_source = parse_optional(
        row.get(29)
            .context("Failed to read workspace landing source")?,
        "landing_source",
    )?;

    Ok(WorkspaceRecord {
        id: row.get(0).context("Failed to read workspace id")?,
        repo_id: row.get(1).context("Failed to read workspace repo id")?,
        repo_name: row.get(2).context("Failed to read workspace repo name")?,
        remote_url: row.get(3).context("Failed to read workspace remote url")?,
        default_branch: row
            .get(4)
            .context("Failed to read workspace default branch")?,
        root_path: row.get(5).context("Failed to read workspace root path")?,
        directory_name: row
            .get(6)
            .context("Failed to read workspace directory name")?,
        workspace_kind,
        goal_workspace_id: row
            .get(8)
            .context("Failed to read workspace goal workspace id")?,
        state,
        has_unread: row
            .get::<i64>(10)
            .context("Failed to read workspace unread")?
            != 0,
        workspace_unread: row
            .get(11)
            .context("Failed to read workspace unread count")?,
        unread_session_count: row
            .get(12)
            .context("Failed to read workspace unread session count")?,
        status,
        branch: row.get(14).context("Failed to read workspace branch")?,
        initialization_parent_branch: row
            .get(15)
            .context("Failed to read workspace initialization parent branch")?,
        intended_target_branch: row
            .get(16)
            .context("Failed to read workspace intended target branch")?,
        pinned_at: row.get(17).context("Failed to read workspace pinned_at")?,
        active_session_id: row
            .get(18)
            .context("Failed to read workspace active session id")?,
        active_session_title: row
            .get(19)
            .context("Failed to read workspace active session title")?,
        active_session_agent_type: row
            .get(20)
            .context("Failed to read workspace active session agent type")?,
        active_session_status: row
            .get(21)
            .context("Failed to read workspace active session status")?,
        primary_session_id: row
            .get(22)
            .context("Failed to read workspace primary session id")?,
        primary_session_title: row
            .get(23)
            .context("Failed to read workspace primary session title")?,
        primary_session_agent_type: row
            .get(24)
            .context("Failed to read workspace primary session agent type")?,
        pr_title: row.get(25).context("Failed to read workspace PR title")?,
        pr_sync_state,
        pr_url: row.get(27).context("Failed to read workspace PR URL")?,
        landing_state,
        landing_source,
        landed_at: row.get(30).context("Failed to read workspace landed_at")?,
        landed_target_branch: row
            .get(31)
            .context("Failed to read workspace landed target branch")?,
        landed_source_ref: row
            .get(32)
            .context("Failed to read workspace landed source ref")?,
        landed_commit_sha: row
            .get(33)
            .context("Failed to read workspace landed commit sha")?,
        initial_head_sha: row
            .get(34)
            .context("Failed to read workspace initial head sha")?,
        last_known_head_sha: row
            .get(35)
            .context("Failed to read workspace last known head sha")?,
        archive_commit: row
            .get(36)
            .context("Failed to read workspace archive commit")?,
        session_count: row
            .get(37)
            .context("Failed to read workspace session count")?,
        message_count: row
            .get(38)
            .context("Failed to read workspace message count")?,
        remote: row.get(39).context("Failed to read workspace remote")?,
        forge_provider: row
            .get(40)
            .context("Failed to read workspace forge provider")?,
        created_at: row.get(41).context("Failed to read workspace created_at")?,
        updated_at: row.get(42).context("Failed to read workspace updated_at")?,
        last_user_message_at: row
            .get(43)
            .context("Failed to read workspace last user message at")?,
        goal_title: row.get(44).context("Failed to read workspace goal title")?,
        goal_description: row
            .get(45)
            .context("Failed to read workspace goal description")?,
    })
}

/// Update the user-editable goal title and description for a workspace.
pub(crate) fn update_goal_workspace_meta(
    workspace_id: &str,
    goal_title: Option<&str>,
    goal_description: Option<&str>,
) -> Result<()> {
    let workspace_id = workspace_id.to_string();
    let goal_title = goal_title.map(str::to_string);
    let goal_description = goal_description.map(str::to_string);
    block_on_workspace_db(async move {
        let _goal = load_goal_workspace_record_async(&workspace_id).await?;
        let ts = chrono::Utc::now().to_rfc3339();
        db::libsql_write_async(|connection| async move {
            let updated_rows = connection
                .execute(
                    "UPDATE workspaces SET goal_title = ?2, goal_description = ?3, updated_at = ?4 WHERE id = ?1",
                    libsql::params![workspace_id.clone(), goal_title, goal_description, ts],
                )
                .await
                .context("Failed to update goal workspace meta")?;
            if updated_rows == 0 {
                anyhow::bail!("Goal workspace meta update affected 0 rows for {workspace_id}");
            }
            Ok(())
        })
        .await
    })
}

pub(crate) fn set_goal_child_workspace_status(
    goal_workspace_id: &str,
    child_workspace_id: &str,
    status: WorkspaceStatus,
) -> Result<()> {
    let goal_workspace_id = goal_workspace_id.to_string();
    let child_workspace_id = child_workspace_id.to_string();
    block_on_workspace_db(async move {
        let _goal = load_goal_workspace_record_async(&goal_workspace_id).await?;
        let child = load_workspace_record_by_id_async(&child_workspace_id)
            .await?
            .with_context(|| format!("Goal child workspace not found: {child_workspace_id}"))?;
        if child.workspace_kind != WorkspaceKind::Code
            || child.goal_workspace_id.as_deref() != Some(goal_workspace_id.as_str())
        {
            bail!(
                "Workspace {child_workspace_id} is not a child of Goal workspace {goal_workspace_id}"
            );
        }

        db::libsql_write_async(|connection| async move {
            let updated_rows = connection
                .execute(
                    "UPDATE workspaces SET status = ?3, updated_at = datetime('now') WHERE id = ?1 AND goal_workspace_id = ?2",
                    libsql::params![child_workspace_id.clone(), goal_workspace_id, status.as_str()],
                )
                .await
                .context("Failed to set goal child workspace status")?;
            if updated_rows != 1 {
                bail!(
                    "Goal child status update affected {updated_rows} rows for workspace {child_workspace_id}"
                );
            }
            Ok(())
        })
        .await
    })
}

/// Assign any code workspace to a goal (or move it between goals) and set its
/// lane status in one atomic write. Works whether the workspace is currently
/// ungrouped, already in this goal, or in a different goal.
pub(crate) fn assign_workspace_to_goal(
    workspace_id: &str,
    goal_workspace_id: &str,
    status: WorkspaceStatus,
) -> Result<()> {
    let workspace_id = workspace_id.to_string();
    let goal_workspace_id = goal_workspace_id.to_string();
    block_on_workspace_db(async move {
        let _goal = load_goal_workspace_record_async(&goal_workspace_id).await?;
        let workspace = load_workspace_record_by_id_async(&workspace_id)
            .await?
            .with_context(|| format!("Workspace not found: {workspace_id}"))?;
        if workspace.workspace_kind != WorkspaceKind::Code {
            bail!("Cannot assign a goal workspace as a child of another goal");
        }

        db::libsql_write_async(|connection| async move {
            let updated_rows = connection
                .execute(
                    "UPDATE workspaces SET goal_workspace_id = ?2, status = ?3, updated_at = datetime('now') WHERE id = ?1",
                    libsql::params![workspace_id.clone(), goal_workspace_id, status.as_str()],
                )
                .await
                .context("Failed to assign workspace to goal")?;
            if updated_rows != 1 {
                bail!("assign_workspace_to_goal affected {updated_rows} rows for {workspace_id}");
            }
            Ok(())
        })
        .await
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::TestEnv;

    #[test]
    fn delete_workspace_and_session_rows_cleans_goal_relationships() {
        let env = TestEnv::new("create-cleanup-goal-links");
        let connection = env.db_connection();
        connection
            .execute(
                "INSERT INTO repos (id, name, default_branch) VALUES ('repo-1', 'fluffy', 'main')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO workspaces (id, repository_id, directory_name, state, workspace_kind) VALUES ('goal-1', 'repo-1', 'goal-root', 'ready', 'goal')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO workspaces (id, repository_id, directory_name, state, workspace_kind, goal_workspace_id) VALUES ('child-1', 'repo-1', 'child-root', 'initializing', 'code', 'goal-1')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO goal_cards (id, goal_workspace_id, title, child_workspace_id) VALUES ('card-1', 'goal-1', 'Child', 'child-1')",
                [],
            )
            .unwrap();

        delete_workspace_and_session_rows("child-1").unwrap();

        let child_link: Option<String> = connection
            .query_row(
                "SELECT child_workspace_id FROM goal_cards WHERE id = 'card-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(child_link, None);
    }

    #[test]
    fn delete_workspace_and_session_rows_cleans_goal_owned_rows() {
        let env = TestEnv::new("create-cleanup-goal-owned-rows");
        let connection = env.db_connection();
        connection
            .execute(
                "INSERT INTO repos (id, name, default_branch) VALUES ('repo-1', 'fluffy', 'main')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO workspaces (id, repository_id, directory_name, state, workspace_kind) VALUES ('goal-1', 'repo-1', 'goal-root', 'initializing', 'goal')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO workspaces (id, repository_id, directory_name, state, workspace_kind, goal_workspace_id) VALUES ('child-1', 'repo-1', 'child-root', 'ready', 'code', 'goal-1')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO goal_cards (id, goal_workspace_id, title, child_workspace_id) VALUES ('card-1', 'goal-1', 'Child', 'child-1')",
                [],
            )
            .unwrap();

        delete_workspace_and_session_rows("goal-1").unwrap();

        let card_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM goal_cards", [], |row| row.get(0))
            .unwrap();
        let child_goal: Option<String> = connection
            .query_row(
                "SELECT goal_workspace_id FROM workspaces WHERE id = 'child-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(card_count, 0);
        assert_eq!(child_goal, None);
    }
}
