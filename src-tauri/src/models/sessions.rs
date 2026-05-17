use anyhow::{bail, Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agents::ActionKind;
use crate::pipeline::types::HistoricalRecord;

use super::{db, settings};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionSurfaceKind {
    Chat,
    Terminal,
}

impl SessionSurfaceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Terminal => "terminal",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionSurfaceMode {
    Thread,
    TaskMonitor,
    Terminal,
    AgentTerminal,
}

impl SessionSurfaceMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Thread => "thread",
            Self::TaskMonitor => "task_monitor",
            Self::Terminal => "terminal",
            Self::AgentTerminal => "agent_terminal",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionControlOwner {
    User,
    Agent,
    System,
}

impl SessionControlOwner {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Agent => "agent",
            Self::System => "system",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionInputPolicy {
    Writable,
    ReadOnly,
    RequestControl,
    BlockedForApproval,
}

impl SessionInputPolicy {
    fn as_str(self) -> &'static str {
        match self {
            Self::Writable => "writable",
            Self::ReadOnly => "read_only",
            Self::RequestControl => "request_control",
            Self::BlockedForApproval => "blocked_for_approval",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionCreatedBy {
    User,
    Goal,
    Pi,
    System,
}

impl SessionCreatedBy {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Goal => "goal",
            Self::Pi => "pi",
            Self::System => "system",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionOptions {
    #[serde(default)]
    pub action_kind: Option<ActionKind>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub surface_mode: Option<SessionSurfaceMode>,
    #[serde(default)]
    pub runtime: Option<String>,
}

#[derive(Debug, Clone)]
pub struct InternalCreateSessionOptions {
    pub action_kind: Option<ActionKind>,
    pub permission_mode: Option<String>,
    pub surface_kind: SessionSurfaceKind,
    pub surface_mode: SessionSurfaceMode,
    pub control_owner: SessionControlOwner,
    pub input_policy: SessionInputPolicy,
    pub created_by: SessionCreatedBy,
    pub terminal_runtime: Option<String>,
    pub terminal_cwd: Option<String>,
    pub agent_type: Option<String>,
    pub title: Option<String>,
}

impl Default for InternalCreateSessionOptions {
    fn default() -> Self {
        Self {
            action_kind: None,
            permission_mode: None,
            surface_kind: SessionSurfaceKind::Chat,
            surface_mode: SessionSurfaceMode::Thread,
            control_owner: SessionControlOwner::User,
            input_policy: SessionInputPolicy::Writable,
            created_by: SessionCreatedBy::User,
            terminal_runtime: None,
            terminal_cwd: None,
            agent_type: None,
            title: None,
        }
    }
}

impl CreateSessionOptions {
    fn into_internal(self) -> Result<InternalCreateSessionOptions> {
        let mode = self.surface_mode.unwrap_or(SessionSurfaceMode::Thread);
        let mut options = InternalCreateSessionOptions {
            action_kind: self.action_kind,
            permission_mode: self.permission_mode,
            ..Default::default()
        };

        match mode {
            SessionSurfaceMode::Thread => {}
            SessionSurfaceMode::Terminal => {
                let runtime = self
                    .runtime
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "shell".to_string());
                options.surface_kind = SessionSurfaceKind::Terminal;
                options.surface_mode = SessionSurfaceMode::Terminal;
                options.terminal_runtime = Some(runtime.clone());
                options.agent_type = Some(runtime.clone());
                options.title = Some(default_terminal_title(&runtime));
            }
            SessionSurfaceMode::TaskMonitor | SessionSurfaceMode::AgentTerminal => {
                bail!("{mode:?} sessions can only be created by internal system flows");
            }
        }

        Ok(options)
    }
}

fn default_terminal_title(runtime: &str) -> String {
    format!("{} Terminal", terminal_runtime_label(runtime))
}

fn terminal_runtime_label(runtime: &str) -> String {
    let normalized = runtime
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '_' | '-'))
        .collect::<String>();
    match normalized.as_str() {
        "claude" => "Claude".to_string(),
        "codex" | "openai" | "openaicodex" => "Codex".to_string(),
        "opencode" => "OpenCode".to_string(),
        "pi" => "Pi".to_string(),
        "" | "shell" => "Shell".to_string(),
        _ => runtime.trim().to_string(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionSummary {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub agent_type: Option<String>,
    pub status: String,
    pub model: Option<String>,
    pub permission_mode: String,
    pub provider_session_id: Option<String>,
    pub effort_level: Option<String>,
    pub unread_count: i64,
    pub fast_mode: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_user_message_at: Option<String>,
    pub is_hidden: bool,
    /// Non-null when the session was created as a one-off "action" dispatch
    /// (e.g. "create-pr", "commit-and-push"). The inspector commit button
    /// uses this to drive post-stream verifiers and the auto-close behavior.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_kind: Option<ActionKind>,
    pub thread_role: Option<String>,
    pub thread_status: Option<String>,
    pub supersedes_thread_id: Option<String>,
    pub stale_reason: Option<String>,
    pub last_supervisor_message_id: Option<String>,
    pub last_milestone_report_id: Option<String>,
    pub surface_kind: String,
    pub surface_mode: String,
    pub control_owner: String,
    pub input_policy: String,
    pub created_by: String,
    pub terminal_runtime: Option<String>,
    pub terminal_cwd: Option<String>,
    pub terminal_started_at: Option<String>,
    pub terminal_stopped_at: Option<String>,
    pub terminal_exit_code: Option<i64>,
    pub parent_session_id: Option<String>,
    pub parent_message_id: Option<String>,
    pub delegation_status: Option<String>,
    pub child_count: i64,
    pub active: bool,
}

pub fn list_workspace_sessions(workspace_id: &str) -> Result<Vec<WorkspaceSessionSummary>> {
    let connection = db::read_conn()?;
    let active_session_id: Option<String> = connection.query_row(
        "SELECT active_session_id FROM workspaces WHERE id = ?1",
        [workspace_id],
        |row| row.get(0),
    )?;

    let mut statement = connection.prepare(
        r#"
            SELECT
              s.id,
              s.workspace_id,
              s.title,
              s.agent_type,
              s.status,
              s.model,
              s.permission_mode,
              s.provider_session_id,
              s.effort_level,
              s.unread_count,
              s.fast_mode,
              s.created_at,
              s.updated_at,
              s.last_user_message_at,
              s.is_hidden,
              s.action_kind,
              s.thread_role,
              s.thread_status,
              s.supersedes_thread_id,
              s.stale_reason,
              s.last_supervisor_message_id,
              s.last_milestone_report_id,
              s.surface_kind,
              s.surface_mode,
              s.control_owner,
              s.input_policy,
              s.created_by,
              s.terminal_runtime,
              s.terminal_cwd,
              s.terminal_started_at,
              s.terminal_stopped_at,
              s.terminal_exit_code,
              child.parent_session_id,
              child.parent_message_id,
              child.status AS delegation_status,
              COALESCE(child_counts.child_count, 0) AS child_count
            FROM sessions s
            LEFT JOIN session_delegations child ON child.child_session_id = s.id
            LEFT JOIN (
              SELECT parent_session_id, COUNT(*) AS child_count
              FROM session_delegations
              GROUP BY parent_session_id
            ) child_counts ON child_counts.parent_session_id = s.id
            WHERE s.workspace_id = ?1 AND COALESCE(s.is_hidden, 0) = 0
              AND child.child_session_id IS NULL
            ORDER BY
              datetime(s.created_at) ASC
            "#,
    )?;

    let rows = statement.query_map([workspace_id], |row| {
        let id: String = row.get(0)?;

        Ok(WorkspaceSessionSummary {
            active: active_session_id.as_deref() == Some(id.as_str()),
            id,
            workspace_id: row.get(1)?,
            title: row.get(2)?,
            agent_type: row.get(3)?,
            status: row.get(4)?,
            model: row.get(5)?,
            permission_mode: row.get(6)?,
            provider_session_id: row.get(7)?,
            effort_level: row.get(8)?,
            unread_count: row.get(9)?,
            fast_mode: row.get::<_, i64>(10)? != 0,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
            last_user_message_at: row.get(13)?,
            is_hidden: row.get::<_, i64>(14)? != 0,
            action_kind: row.get(15)?,
            thread_role: row.get(16)?,
            thread_status: row.get(17)?,
            supersedes_thread_id: row.get(18)?,
            stale_reason: row.get(19)?,
            last_supervisor_message_id: row.get(20)?,
            last_milestone_report_id: row.get(21)?,
            surface_kind: row.get(22)?,
            surface_mode: row.get(23)?,
            control_owner: row.get(24)?,
            input_policy: row.get(25)?,
            created_by: row.get(26)?,
            terminal_runtime: row.get(27)?,
            terminal_cwd: row.get(28)?,
            terminal_started_at: row.get(29)?,
            terminal_stopped_at: row.get(30)?,
            terminal_exit_code: row.get(31)?,
            parent_session_id: row.get(32)?,
            parent_message_id: row.get(33)?,
            delegation_status: row.get(34)?,
            child_count: row.get(35)?,
        })
    })?;

    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

/// Lightweight result returned by the cross-workspace session search used by
/// the Command+K palette. Only the fields needed for display are included.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchResult {
    pub id: String,
    pub workspace_id: String,
    pub session_title: String,
    /// Raw directory name (e.g. "feat-auth-flow"). The frontend humanises this
    /// into a display label using the same logic as `humanizeBranch`.
    pub workspace_directory_name: String,
    pub workspace_branch: Option<String>,
    pub workspace_repo_name: Option<String>,
}

/// Search non-hidden, non-action sessions whose title matches `query`
/// (case-insensitive substring). Only sessions in non-archived workspaces are
/// returned. Results are ordered by recency and capped at 25.
pub fn search_sessions(query: &str) -> Result<Vec<SessionSearchResult>> {
    let connection = db::read_conn()?;
    let pattern = format!("%{}%", query.to_lowercase());
    let mut statement = connection.prepare(
        r#"
        SELECT
          s.id,
          s.workspace_id,
          s.title,
          w.directory_name,
          w.branch,
          r.name
        FROM sessions s
        JOIN workspaces w ON w.id = s.workspace_id
        JOIN repos r ON r.id = w.repository_id
        WHERE
          COALESCE(s.is_hidden, 0) = 0
          AND s.action_kind IS NULL
          AND COALESCE(w.state, 'ready') != 'archived'
          AND LOWER(s.title) LIKE ?1
        ORDER BY s.updated_at DESC
        LIMIT 25
        "#,
    )?;

    let rows = statement.query_map([&pattern], |row| {
        Ok(SessionSearchResult {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            session_title: row.get(2)?,
            workspace_directory_name: row.get(3)?,
            workspace_branch: row.get(4)?,
            workspace_repo_name: row.get(5)?,
        })
    })?;

    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn list_session_historical_records(session_id: &str) -> Result<Vec<HistoricalRecord>> {
    let connection = db::read_conn()?;
    list_session_historical_records_with_connection(&connection, session_id)
}

fn adjacent_visible_session_id(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    session_id: &str,
) -> Result<Option<String>> {
    let mut statement = transaction.prepare(
        r#"
            SELECT s.id FROM sessions s
            LEFT JOIN session_delegations child ON child.child_session_id = s.id
            WHERE s.workspace_id = ?1
              AND COALESCE(s.is_hidden, 0) = 0
              AND child.child_session_id IS NULL
            ORDER BY datetime(s.created_at) ASC
            "#,
    )?;
    let visible_session_ids = statement
        .query_map([workspace_id], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let Some(index) = visible_session_ids
        .iter()
        .position(|candidate| candidate == session_id)
    else {
        return Ok(None);
    };

    Ok(visible_session_ids
        .get(index + 1)
        .or_else(|| {
            index
                .checked_sub(1)
                .and_then(|prev| visible_session_ids.get(prev))
        })
        .cloned())
}

fn list_session_historical_records_with_connection(
    connection: &Connection,
    session_id: &str,
) -> Result<Vec<HistoricalRecord>> {
    let mut statement = connection.prepare(
        r#"
            SELECT
              sm.id,
              sm.role,
              sm.content,
              sm.created_at
            FROM session_messages sm
            WHERE sm.session_id = ?1
            ORDER BY COALESCE(julianday(sm.sent_at), julianday(sm.created_at)) ASC, sm.rowid ASC
            "#,
    )?;

    let rows = statement.query_map([session_id], |row| {
        let content: String = row.get(2)?;
        // After the user_prompt migration the column is JSON-only. We still
        // try-parse instead of unwrapping so a corrupted row can't bring the
        // whole load down — `None` flows through to the adapter which renders
        // a system "Event" placeholder.
        let parsed_content = serde_json::from_str::<Value>(&content).ok();

        Ok(HistoricalRecord {
            id: row.get(0)?,
            role: row.get(1)?,
            content,
            parsed_content,
            created_at: row.get(3)?,
        })
    })?;

    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

// ---- Session read/unread functions ----

pub fn mark_session_read(session_id: &str) -> Result<()> {
    let mut connection = db::write_conn()?;
    let transaction = connection
        .transaction()
        .context("Failed to start mark-read transaction")?;

    mark_session_read_in_transaction(&transaction, session_id)?;

    transaction
        .commit()
        .context("Failed to commit session read transaction")
}

pub fn mark_session_unread(session_id: &str) -> Result<()> {
    let mut connection = db::write_conn()?;
    let transaction = connection
        .transaction()
        .context("Failed to start mark-unread transaction")?;

    mark_session_unread_in_transaction(&transaction, session_id)?;

    transaction
        .commit()
        .context("Failed to commit session unread transaction")
}

pub(crate) fn mark_session_unread_in_transaction(
    transaction: &Transaction<'_>,
    session_id: &str,
) -> Result<()> {
    // Bump to at least 1 — idempotent for a session that's already marked
    // unread, and avoids drifting upwards on repeated background completions.
    // `workspaces.unread` is an independent flag, not mirrored from sessions,
    // so we don't touch it here; `has_unread` is derived as
    // `workspaces.unread OR (any session unread_count > 0)`.
    let updated_rows = transaction
        .execute(
            "UPDATE sessions SET unread_count = MAX(COALESCE(unread_count, 0), 1) WHERE id = ?1",
            [session_id],
        )
        .with_context(|| format!("Failed to mark session {session_id} as unread"))?;

    // 0 rows = session was deleted mid-flight; benign race, skip silently.
    // >1 rows = duplicate primary key, genuinely broken schema.
    if updated_rows > 1 {
        bail!("Session unread update affected {updated_rows} rows for session {session_id}");
    }

    Ok(())
}

pub(crate) fn mark_session_read_in_transaction(
    transaction: &Transaction<'_>,
    session_id: &str,
) -> Result<()> {
    let workspace_id: String = transaction
        .query_row(
            "SELECT workspace_id FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .with_context(|| format!("Failed to resolve workspace for session {session_id}"))?;

    let updated_rows = transaction
        .execute(
            "UPDATE sessions SET unread_count = 0 WHERE id = ?1",
            [session_id],
        )
        .with_context(|| format!("Failed to mark session {session_id} as read"))?;

    if updated_rows != 1 {
        bail!("Session read update affected {updated_rows} rows for session {session_id}");
    }

    // Clearing a session only drops the workspace flag when nothing else in
    // the workspace is still unread; otherwise the workspace stays marked.
    clear_workspace_unread_if_no_session_unread_in_transaction(transaction, &workspace_id)
}

pub(crate) fn mark_workspace_unread_in_transaction(
    transaction: &Transaction<'_>,
    workspace_id: &str,
) -> Result<()> {
    // `workspaces.unread` is an independent flag. Setting it directly is
    // enough — sessions are left alone. `has_unread` is derived as
    // `workspaces.unread OR (any session unread_count > 0)`.
    let updated_rows = transaction
        .execute(
            "UPDATE workspaces SET unread = 1 WHERE id = ?1",
            [workspace_id],
        )
        .with_context(|| format!("Failed to mark workspace {workspace_id} as unread"))?;

    if updated_rows != 1 {
        bail!("Workspace unread update affected {updated_rows} rows for workspace {workspace_id}");
    }

    Ok(())
}

/// Clears `workspaces.unread` only if every session in the workspace is
/// already read. Called from `mark_session_read_in_transaction` so the
/// workspace flag disappears together with the last unread session, but is
/// preserved while any session still has unread content.
pub(crate) fn clear_workspace_unread_if_no_session_unread_in_transaction(
    transaction: &Transaction<'_>,
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
            [workspace_id],
        )
        .with_context(|| format!("Failed to clear workspace unread for {workspace_id}"))?;

    // Idempotent: zero rows updated is fine — it just means the workspace
    // still has unread sessions (or the flag was already 0).
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionResponse {
    pub session_id: String,
}

/// Forge-aware variant. Looks up the workspace's stored `forge_provider`
/// so a GitLab workspace gets "Create MR" / "Open MR" instead of the
/// GitHub-flavored defaults. Falls back to the plain `default_title` when
/// we have no provider info (e.g. pre-migration rows).
fn default_session_title_for_action_kind_with_workspace(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    action_kind: Option<ActionKind>,
) -> Result<String> {
    let Some(kind) = action_kind else {
        return Ok("Untitled".to_string());
    };

    // Only CreatePr/OpenPr care about the forge nouns — skip the query
    // otherwise.
    if !matches!(kind, ActionKind::CreatePr | ActionKind::OpenPr) {
        return Ok(kind.default_title().to_string());
    }

    let provider: Option<String> = transaction
        .query_row(
            "SELECT r.forge_provider \
             FROM workspaces w JOIN repos r ON r.id = w.repository_id \
             WHERE w.id = ?1",
            [workspace_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .with_context(|| format!("Failed to read forge_provider for {workspace_id}"))?
        .flatten();

    let change_request_name = match provider.as_deref() {
        Some("gitlab") => "MR",
        _ => "PR",
    };
    Ok(kind.default_title_for_change_request(change_request_name))
}

pub fn create_session(
    workspace_id: &str,
    action_kind: Option<ActionKind>,
    permission_mode: Option<&str>,
) -> Result<CreateSessionResponse> {
    create_session_with_options(
        workspace_id,
        InternalCreateSessionOptions {
            action_kind,
            permission_mode: permission_mode.map(str::to_string),
            ..Default::default()
        },
    )
}

pub fn create_user_session(
    workspace_id: &str,
    options: Option<CreateSessionOptions>,
) -> Result<CreateSessionResponse> {
    let internal_options = options.unwrap_or(CreateSessionOptions {
        action_kind: None,
        permission_mode: None,
        surface_mode: None,
        runtime: None,
    });
    create_session_with_options(workspace_id, internal_options.into_internal()?)
}

pub fn create_internal_session(
    workspace_id: &str,
    options: InternalCreateSessionOptions,
) -> Result<CreateSessionResponse> {
    let expected_surface_kind = match options.surface_mode {
        SessionSurfaceMode::Thread | SessionSurfaceMode::TaskMonitor => SessionSurfaceKind::Chat,
        SessionSurfaceMode::Terminal | SessionSurfaceMode::AgentTerminal => {
            SessionSurfaceKind::Terminal
        }
    };
    if options.surface_kind != expected_surface_kind {
        bail!(
            "Invalid session surface kind '{}' for mode '{}'",
            options.surface_kind.as_str(),
            options.surface_mode.as_str()
        );
    }

    match options.surface_mode {
        SessionSurfaceMode::Thread | SessionSurfaceMode::Terminal
            if options.created_by == SessionCreatedBy::User => {}
        SessionSurfaceMode::TaskMonitor | SessionSurfaceMode::AgentTerminal
            if options.created_by != SessionCreatedBy::User => {}
        SessionSurfaceMode::Thread | SessionSurfaceMode::Terminal
            if options.created_by != SessionCreatedBy::User => {}
        _ => bail!("Invalid session mode/creator combination"),
    }
    create_session_with_options(workspace_id, options)
}

pub fn update_session_control(
    session_id: &str,
    control_owner: SessionControlOwner,
    input_policy: SessionInputPolicy,
) -> Result<String> {
    let connection = db::write_conn()?;
    let workspace_id: String = connection
        .query_row(
            r#"
            UPDATE sessions
            SET control_owner = ?2, input_policy = ?3
            WHERE id = ?1
            RETURNING workspace_id
            "#,
            (session_id, control_owner.as_str(), input_policy.as_str()),
            |row| row.get(0),
        )
        .with_context(|| format!("Failed to update control for session {session_id}"))?;
    Ok(workspace_id)
}

pub fn update_terminal_started(session_id: &str, cwd: &str) -> Result<()> {
    let connection = db::write_conn()?;
    connection
        .execute(
            r#"
            UPDATE sessions
            SET terminal_cwd = ?2,
                terminal_started_at = datetime('now'),
                terminal_stopped_at = NULL,
                terminal_exit_code = NULL,
                status = 'running'
            WHERE id = ?1
            "#,
            (session_id, cwd),
        )
        .with_context(|| format!("Failed to mark terminal session {session_id} started"))?;
    Ok(())
}

pub fn update_terminal_stopped(session_id: &str, exit_code: Option<i32>) -> Result<()> {
    let connection = db::write_conn()?;
    connection
        .execute(
            r#"
            UPDATE sessions
            SET terminal_stopped_at = datetime('now'),
                terminal_exit_code = ?2,
                status = 'idle'
            WHERE id = ?1
            "#,
            (session_id, exit_code),
        )
        .with_context(|| format!("Failed to mark terminal session {session_id} stopped"))?;
    Ok(())
}

fn create_session_with_options(
    workspace_id: &str,
    options: InternalCreateSessionOptions,
) -> Result<CreateSessionResponse> {
    let mut connection = db::write_conn()?;

    // `model` is left NULL on create: the frontend owns model selection via
    // `settings.defaultModelId` (kept valid by `useEnsureDefaultModel`), and
    // the value gets persisted into `sessions.model` by the agent streaming
    // finalizer on the first message. Reading settings here would be a
    // redundant second source of truth.
    let default_effort = settings::load_setting_value("app.default_effort")
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "high".to_string());

    let transaction = connection
        .transaction()
        .context("Failed to start create-session transaction")?;

    // Validate workspace exists
    let workspace_exists: bool = transaction
        .query_row(
            "SELECT COUNT(*) FROM workspaces WHERE id = ?1",
            [workspace_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .with_context(|| format!("Failed to verify workspace {workspace_id}"))?;

    if !workspace_exists {
        bail!("Workspace {workspace_id} does not exist");
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let title = match options.title {
        Some(title) => title,
        None => default_session_title_for_action_kind_with_workspace(
            &transaction,
            workspace_id,
            options.action_kind,
        )?,
    };

    transaction
        .execute(
            r#"
            INSERT INTO sessions (
                id, workspace_id, status, title, permission_mode, action_kind,
                model, effort_level, agent_type, surface_kind, surface_mode,
                control_owner, input_policy, created_by, terminal_runtime,
                terminal_cwd
            )
            VALUES (?1, ?2, 'idle', ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            "#,
            (
                &session_id,
                workspace_id,
                &title,
                options.permission_mode.as_deref().unwrap_or("default"),
                options.action_kind,
                &default_effort,
                options.agent_type.as_deref(),
                options.surface_kind.as_str(),
                options.surface_mode.as_str(),
                options.control_owner.as_str(),
                options.input_policy.as_str(),
                options.created_by.as_str(),
                options.terminal_runtime.as_deref(),
                options.terminal_cwd.as_deref(),
            ),
        )
        .context("Failed to create session")?;

    // Set as active session on the workspace
    let updated_rows = transaction
        .execute(
            "UPDATE workspaces SET active_session_id = ?1 WHERE id = ?2",
            (&session_id, workspace_id),
        )
        .context("Failed to set active session")?;

    if updated_rows != 1 {
        bail!("Active session update affected {updated_rows} rows for workspace {workspace_id}");
    }

    transaction
        .commit()
        .context("Failed to commit create-session")?;

    Ok(CreateSessionResponse { session_id })
}

/// Read the `model` column from a session row.
pub fn get_session_model(session_id: &str) -> Result<Option<String>> {
    let conn = db::read_conn()?;
    let model: Option<String> = conn
        .query_row(
            "SELECT model FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .with_context(|| format!("Failed to read model for session {session_id}"))?;
    Ok(model.filter(|s| !s.is_empty()))
}

/// Persist the runtime selection as soon as a background send is accepted.
///
/// The streaming path later writes the visible user message and runtime notice;
/// this intentionally updates only session metadata so `list_threads` cannot
/// observe `model = NULL` for an already-started send.
pub fn record_session_send_start_metadata(
    session_id: &str,
    model_id: &str,
    provider: &str,
    permission_mode: Option<&str>,
) -> Result<()> {
    let connection = db::write_conn()?;
    let timestamp = db::current_timestamp()?;
    let rows = connection
        .execute(
            r#"
			UPDATE sessions
			SET status = 'streaming',
			    model = ?2,
			    agent_type = ?3,
			    permission_mode = COALESCE(?4, permission_mode),
			    last_user_message_at = ?5,
			    updated_at = ?5
			WHERE id = ?1
			"#,
            (session_id, model_id, provider, permission_mode, &timestamp),
        )
        .with_context(|| format!("Failed to record send metadata for session {session_id}"))?;
    if rows == 0 {
        bail!("Session {session_id} does not exist");
    }
    Ok(())
}

/// Read the opaque `context_usage_meta` JSON for the composer's
/// context-usage ring. Returns `Ok(None)` for missing rows OR empty meta —
/// the ring renders a placeholder either way and the frontend RPC contract
/// promises null on "not recorded yet". This matters for the create→fetch
/// race and the delete-while-mounted race.
pub fn get_session_context_usage(session_id: &str) -> Result<Option<String>> {
    let conn = db::read_conn()?;
    read_session_context_usage(&conn, session_id)
}

fn read_session_context_usage(conn: &Connection, session_id: &str) -> Result<Option<String>> {
    let meta: Option<String> = match conn.query_row(
        "SELECT context_usage_meta FROM sessions WHERE id = ?1",
        [session_id],
        |row| row.get(0),
    ) {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(err) => {
            return Err(err).with_context(|| {
                format!("Failed to read context_usage_meta for session {session_id}")
            });
        }
    };
    Ok(meta.filter(|s| !s.is_empty()))
}

pub fn rename_session(session_id: &str, title: &str) -> Result<()> {
    let connection = db::write_conn()?;

    let updated_rows = connection
        .execute(
            "UPDATE sessions SET title = ?1 WHERE id = ?2",
            (title, session_id),
        )
        .with_context(|| format!("Failed to rename session {session_id}"))?;

    if updated_rows != 1 {
        bail!("Session rename affected {updated_rows} rows for session {session_id}");
    }

    Ok(())
}

pub fn hide_session(session_id: &str) -> Result<()> {
    let mut connection = db::write_conn()?;
    let transaction = connection
        .transaction()
        .context("Failed to start hide-session transaction")?;

    // Resolve workspace and mark session as hidden
    let workspace_id: String = transaction
        .query_row(
            "SELECT workspace_id FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .with_context(|| format!("Failed to find session {session_id}"))?;

    // If this was the workspace's active session, switch to its right neighbor,
    // falling back to the left neighbor when closing the rightmost tab.
    let current_active: Option<String> = transaction
        .query_row(
            "SELECT active_session_id FROM workspaces WHERE id = ?1",
            [&workspace_id],
            |row| row.get(0),
        )
        .context("Failed to read active session for workspace")?;
    let next_session_id = if current_active.as_deref() == Some(session_id) {
        adjacent_visible_session_id(&transaction, &workspace_id, session_id)?
    } else {
        None
    };

    transaction
        .execute(
            "UPDATE sessions SET is_hidden = 1 WHERE id = ?1",
            [session_id],
        )
        .with_context(|| format!("Failed to hide session {session_id}"))?;

    // A hidden session can no longer contribute to the workspace unread dot —
    // the user can't reach it to clear it. Drop its unread_count so the
    // workspace flag can fall off too when this was the last unread session.
    mark_session_read_in_transaction(&transaction, session_id)?;

    if current_active.as_deref() == Some(session_id) {
        transaction
            .execute(
                "UPDATE workspaces SET active_session_id = ?1 WHERE id = ?2",
                (next_session_id.as_deref(), &workspace_id),
            )
            .context("Failed to update active session")?;
    }

    transaction
        .commit()
        .context("Failed to commit hide-session")
}

pub fn unhide_session(session_id: &str) -> Result<()> {
    let connection = db::write_conn()?;
    connection
        .execute(
            "UPDATE sessions SET is_hidden = 0 WHERE id = ?1",
            [session_id],
        )
        .with_context(|| format!("Failed to unhide session {session_id}"))?;
    Ok(())
}

pub fn delete_session(session_id: &str) -> Result<()> {
    let mut connection = db::write_conn()?;
    let transaction = connection.transaction()?;

    // Resolve workspace before deleting, so we can fix active_session_id
    let workspace_id: Option<String> = transaction
        .query_row(
            "SELECT workspace_id FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .ok();

    let current_active: Option<String> = if let Some(ws_id) = &workspace_id {
        transaction
            .query_row(
                "SELECT active_session_id FROM workspaces WHERE id = ?1",
                [ws_id],
                |row| row.get(0),
            )
            .ok()
    } else {
        None
    };
    let next_session_id = match (&workspace_id, current_active.as_deref()) {
        (Some(ws_id), Some(active_id)) if active_id == session_id => {
            adjacent_visible_session_id(&transaction, ws_id, session_id)?
        }
        _ => None,
    };

    delete_session_tree_in_transaction(&transaction, session_id)?;

    // If this was active, persist the same right-then-left tab fallback as the UI.
    if let Some(ws_id) = &workspace_id {
        transaction
            .execute(
                "UPDATE workspaces SET active_session_id = ?1 WHERE id = ?2 AND active_session_id = ?3",
                (next_session_id.as_deref(), ws_id, session_id),
            )
            .context("Failed to update active session")?;
    }

    transaction
        .commit()
        .context("Failed to commit session deletion")?;
    Ok(())
}

fn delete_session_tree_in_transaction(
    transaction: &Transaction<'_>,
    session_id: &str,
) -> Result<()> {
    for child_session_id in
        super::delegations::child_session_ids_for_parent(transaction, session_id)?
    {
        delete_session_tree_in_transaction(transaction, &child_session_id)?;
    }

    transaction
        .execute(
            "DELETE FROM session_delegations WHERE parent_session_id = ?1 OR child_session_id = ?1",
            [session_id],
        )
        .context("Failed to delete delegation metadata")?;
    transaction
        .execute(
            "DELETE FROM session_messages
             WHERE role = 'system'
               AND json_valid(content)
               AND json_extract(content, '$.assigneeSessionId') = ?1
               AND json_extract(content, '$.type') IN ('goal_assignee_report', 'goal_assignee_runtime_issue')",
            [session_id],
        )
        .context("Failed to delete delivered assignee notifications")?;
    transaction
        .execute(
            "DELETE FROM goal_supervisor_notifications
             WHERE assignee_session_id = ?1 OR delivered_to_session_id = ?1",
            [session_id],
        )
        .context("Failed to delete assignee notification metadata")?;
    transaction
        .execute(
            "DELETE FROM pending_cli_sends WHERE session_id = ?1",
            [session_id],
        )
        .context("Failed to delete pending session sends")?;
    transaction
        .execute(
            "DELETE FROM session_command_audit_log WHERE session_id = ?1",
            [session_id],
        )
        .context("Failed to delete session command audit log")?;
    transaction
        .execute(
            "DELETE FROM session_messages WHERE session_id = ?1",
            [session_id],
        )
        .context("Failed to delete messages")?;
    transaction
        .execute("DELETE FROM sessions WHERE id = ?1", [session_id])
        .context("Failed to delete session")?;
    Ok(())
}

pub fn list_hidden_sessions(workspace_id: &str) -> Result<Vec<WorkspaceSessionSummary>> {
    let connection = db::read_conn()?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT
              s.id, s.workspace_id, s.title, s.agent_type, s.status, s.model,
              s.permission_mode, s.provider_session_id, s.effort_level,
              s.unread_count, s.fast_mode, s.created_at, s.updated_at,
              s.last_user_message_at, s.is_hidden, s.action_kind,
              s.thread_role, s.thread_status, s.supersedes_thread_id,
              s.stale_reason, s.last_supervisor_message_id,
              s.last_milestone_report_id,
              s.surface_kind, s.surface_mode, s.control_owner,
              s.input_policy, s.created_by, s.terminal_runtime,
              s.terminal_cwd, s.terminal_started_at,
              s.terminal_stopped_at, s.terminal_exit_code,
              child.parent_session_id, child.parent_message_id,
              child.status AS delegation_status,
              COALESCE(child_counts.child_count, 0) AS child_count
            FROM sessions s
            LEFT JOIN session_delegations child ON child.child_session_id = s.id
            LEFT JOIN (
              SELECT parent_session_id, COUNT(*) AS child_count
              FROM session_delegations
              GROUP BY parent_session_id
            ) child_counts ON child_counts.parent_session_id = s.id
            WHERE s.workspace_id = ?1 AND s.is_hidden = 1
            ORDER BY datetime(s.created_at) ASC
            "#,
        )
        .context("Failed to prepare hidden sessions query")?;

    let rows = statement
        .query_map([workspace_id], |row| {
            let id: String = row.get(0)?;
            Ok(WorkspaceSessionSummary {
                active: false,
                id,
                workspace_id: row.get(1)?,
                title: row.get(2)?,
                agent_type: row.get(3)?,
                status: row.get(4)?,
                model: row.get(5)?,
                permission_mode: row.get(6)?,
                provider_session_id: row.get(7)?,
                effort_level: row.get(8)?,
                unread_count: row.get(9)?,
                fast_mode: row.get::<_, i64>(10)? != 0,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                last_user_message_at: row.get(13)?,
                is_hidden: row.get::<_, i64>(14)? != 0,
                action_kind: row.get(15)?,
                thread_role: row.get(16)?,
                thread_status: row.get(17)?,
                supersedes_thread_id: row.get(18)?,
                stale_reason: row.get(19)?,
                last_supervisor_message_id: row.get(20)?,
                last_milestone_report_id: row.get(21)?,
                surface_kind: row.get(22)?,
                surface_mode: row.get(23)?,
                control_owner: row.get(24)?,
                input_policy: row.get(25)?,
                created_by: row.get(26)?,
                terminal_runtime: row.get(27)?,
                terminal_cwd: row.get(28)?,
                terminal_started_at: row.get(29)?,
                terminal_stopped_at: row.get(30)?,
                terminal_exit_code: row.get(31)?,
                parent_session_id: row.get(32)?,
                parent_message_id: row.get(33)?,
                delegation_status: row.get(34)?,
                child_count: row.get(35)?,
            })
        })
        .context("Failed to query hidden sessions")?;

    rows.collect::<std::result::Result<Vec<_>, _>>()
        .context("Failed to read hidden sessions")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_dir::TEST_ENV_LOCK;
    use rusqlite::Connection;
    use std::{fs, path::PathBuf};

    struct TestDataDir {
        root: PathBuf,
    }

    impl TestDataDir {
        fn new(name: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("helmor-test-{name}-{}", uuid::Uuid::new_v4()));
            std::env::set_var("HELMOR_DATA_DIR", root.display().to_string());
            crate::data_dir::ensure_directory_structure().unwrap();
            let db_path = crate::data_dir::db_path().unwrap();
            let conn = Connection::open(&db_path).unwrap();
            crate::schema::ensure_schema(&conn).unwrap();
            Self { root }
        }

        fn connection(&self) -> Connection {
            Connection::open(crate::data_dir::db_path().unwrap()).unwrap()
        }
    }

    impl Drop for TestDataDir {
        fn drop(&mut self) {
            std::env::remove_var("HELMOR_DATA_DIR");
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn test_db() -> (Connection, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();
        crate::schema::ensure_schema(&conn).unwrap();
        (conn, dir)
    }

    fn seed(conn: &Connection) {
        conn.execute(
            "INSERT INTO repos (id, name) VALUES ('r1', 'test-repo')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspaces (id, repository_id, directory_name, state, status) VALUES ('w1', 'r1', 'test-dir', 'active', 'in-progress')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, status, title) VALUES ('s1', 'w1', 'idle', 'Test Session')",
            [],
        ).unwrap();
    }

    #[test]
    fn session_row_exists_after_insert() {
        let (conn, _dir) = test_db();
        seed(&conn);
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sessions WHERE workspace_id = 'w1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        let title: String = conn
            .query_row("SELECT title FROM sessions WHERE id = 's1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(title, "Test Session");
    }

    #[test]
    fn create_user_terminal_session_persists_surface_metadata() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let dir = TestDataDir::new("create-terminal-session");
        let conn = dir.connection();
        seed(&conn);

        let response = create_user_session(
            "w1",
            Some(CreateSessionOptions {
                action_kind: None,
                permission_mode: None,
                surface_mode: Some(SessionSurfaceMode::Terminal),
                runtime: Some("shell".into()),
            }),
        )
        .unwrap();

        let row: (
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            String,
        ) = conn
            .query_row(
                r#"
	                SELECT surface_kind, surface_mode, control_owner, input_policy,
	                       created_by, terminal_runtime, title
	                FROM sessions WHERE id = ?1
	                "#,
                [response.session_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .unwrap();

        assert_eq!(row.0, "terminal");
        assert_eq!(row.1, "terminal");
        assert_eq!(row.2, "user");
        assert_eq!(row.3, "writable");
        assert_eq!(row.4, "user");
        assert_eq!(row.5.as_deref(), Some("shell"));
        assert_eq!(row.6, "Shell Terminal");
    }

    #[test]
    fn terminal_titles_are_runtime_aware() {
        assert_eq!(default_terminal_title("claude"), "Claude Terminal");
        assert_eq!(default_terminal_title("codex"), "Codex Terminal");
        assert_eq!(default_terminal_title("open-code"), "OpenCode Terminal");
        assert_eq!(default_terminal_title("pi"), "Pi Terminal");
    }

    #[test]
    fn send_start_metadata_updates_listed_thread_runtime() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let dir = TestDataDir::new("send-start-listed-runtime");
        let conn = dir.connection();
        seed(&conn);

        record_session_send_start_metadata(
            "s1",
            "pi:azure-openai-responses/gpt-5.5",
            "pi",
            Some("auto"),
        )
        .unwrap();

        let sessions = list_workspace_sessions("w1").unwrap();
        let session = sessions.iter().find(|session| session.id == "s1").unwrap();
        assert_eq!(session.status, "streaming");
        assert_eq!(
            session.model.as_deref(),
            Some("pi:azure-openai-responses/gpt-5.5")
        );
        assert_eq!(session.agent_type.as_deref(), Some("pi"));
        assert_eq!(session.permission_mode, "auto");
        assert!(session.last_user_message_at.is_some());
    }

    #[test]
    fn create_internal_agent_terminal_persists_agent_control() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let dir = TestDataDir::new("create-agent-terminal-session");
        let conn = dir.connection();
        seed(&conn);

        let response = create_internal_session(
            "w1",
            InternalCreateSessionOptions {
                surface_kind: SessionSurfaceKind::Terminal,
                surface_mode: SessionSurfaceMode::AgentTerminal,
                control_owner: SessionControlOwner::Agent,
                input_policy: SessionInputPolicy::RequestControl,
                created_by: SessionCreatedBy::Pi,
                terminal_runtime: Some("pi".into()),
                agent_type: Some("pi".into()),
                title: Some("Agent Terminal".into()),
                ..Default::default()
            },
        )
        .unwrap();

        let row: (String, String, String, Option<String>) = conn
            .query_row(
                "SELECT surface_mode, control_owner, input_policy, agent_type FROM sessions WHERE id = ?1",
                [response.session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();

        assert_eq!(row.0, "agent_terminal");
        assert_eq!(row.1, "agent");
        assert_eq!(row.2, "request_control");
        assert_eq!(row.3.as_deref(), Some("pi"));
    }

    #[test]
    fn create_internal_session_rejects_conflicting_surface_kind() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let _dir = TestDataDir::new("reject-conflicting-surface-kind");

        let error = create_internal_session(
            "w1",
            InternalCreateSessionOptions {
                surface_kind: SessionSurfaceKind::Chat,
                surface_mode: SessionSurfaceMode::AgentTerminal,
                control_owner: SessionControlOwner::Agent,
                input_policy: SessionInputPolicy::RequestControl,
                created_by: SessionCreatedBy::Pi,
                ..Default::default()
            },
        )
        .unwrap_err();

        assert!(error
            .to_string()
            .contains("Invalid session surface kind 'chat' for mode 'agent_terminal'"));
    }

    #[test]
    fn update_terminal_started_refreshes_existing_start_time() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let dir = TestDataDir::new("terminal-start-refresh");
        let conn = dir.connection();
        seed(&conn);

        conn.execute(
            r#"
            UPDATE sessions
            SET terminal_started_at = '2000-01-01 00:00:00',
                terminal_stopped_at = '2000-01-01 00:05:00',
                terminal_exit_code = 0,
                status = 'idle'
            WHERE id = 's1'
            "#,
            [],
        )
        .unwrap();

        update_terminal_started("s1", "/tmp/helmor").unwrap();

        let row: (
            Option<String>,
            Option<String>,
            Option<i32>,
            String,
            Option<String>,
        ) = conn
            .query_row(
                r#"
                SELECT terminal_started_at, terminal_stopped_at, terminal_exit_code,
                       status, terminal_cwd
                FROM sessions WHERE id = 's1'
                "#,
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();

        assert_ne!(row.0.as_deref(), Some("2000-01-01 00:00:00"));
        assert!(row.1.is_none());
        assert!(row.2.is_none());
        assert_eq!(row.3, "running");
        assert_eq!(row.4.as_deref(), Some("/tmp/helmor"));
    }

    #[test]
    fn loader_parses_json_content_and_tolerates_unparseable_rows() {
        // After the user_prompt migration, every new row holds JSON. The
        // loader still try-parses (vs unwrap) so a corrupted/legacy row
        // can't bring the whole load down — it falls through with
        // parsed_content = None and the adapter renders a placeholder.
        let (conn, _dir) = test_db();
        seed(&conn);
        conn.execute(
            "INSERT INTO session_messages (id, session_id, role, content) VALUES ('m1', 's1', 'assistant', ?1)",
            [r#"{"type":"assistant","message":{"content":[]}}"#],
        ).unwrap();
        conn.execute(
            "INSERT INTO session_messages (id, session_id, role, content) VALUES ('m2', 's1', 'user', 'plain text')",
            [],
        ).unwrap();

        let records = list_session_historical_records_with_connection(&conn, "s1").unwrap();
        let json_record = records.iter().find(|r| r.id == "m1").unwrap();
        let text_record = records.iter().find(|r| r.id == "m2").unwrap();

        assert!(
            json_record.parsed_content.is_some(),
            "valid JSON content should parse"
        );
        assert!(
            text_record.parsed_content.is_none(),
            "non-JSON content should leave parsed_content None instead of erroring"
        );
    }

    fn seed_with_active_session(conn: &Connection) {
        seed(conn);
        conn.execute(
            "UPDATE workspaces SET active_session_id = 's1' WHERE id = 'w1'",
            [],
        )
        .unwrap();
    }

    fn seed_two_sessions(conn: &Connection) {
        seed_with_active_session(conn);
        conn.execute(
            "UPDATE sessions SET created_at = '2026-01-01T00:00:00', updated_at = '2026-01-01T00:00:00' WHERE id = 's1'",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, status, title, created_at, updated_at) VALUES ('s2', 'w1', 'idle', 'Second Session', '2026-01-02T00:00:00', '2026-01-02T00:00:00')",
            [],
        ).unwrap();
    }

    fn seed_three_sessions(conn: &Connection) {
        seed_two_sessions(conn);
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, status, title, created_at, updated_at) VALUES ('s3', 'w1', 'idle', 'Third Session', '2026-01-03T00:00:00', '2026-01-03T00:00:00')",
            [],
        ).unwrap();
    }

    fn get_active_session_id(conn: &Connection, workspace_id: &str) -> Option<String> {
        conn.query_row(
            "SELECT active_session_id FROM workspaces WHERE id = ?1",
            [workspace_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn count_sessions(conn: &Connection, workspace_id: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE workspace_id = ?1",
            [workspace_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    fn count_hidden_sessions(conn: &Connection, workspace_id: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE workspace_id = ?1 AND is_hidden = 1",
            [workspace_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn hide_session_clears_active_session_id() {
        let (conn, _dir) = test_db();
        seed_with_active_session(&conn);
        assert_eq!(get_active_session_id(&conn, "w1"), Some("s1".to_string()));

        // Hide s1 — simulates the transactional logic in hide_session()
        conn.execute("UPDATE sessions SET is_hidden = 1 WHERE id = 's1'", [])
            .unwrap();

        let next: Option<String> = conn
            .query_row(
                "SELECT id FROM sessions WHERE workspace_id = 'w1' AND COALESCE(is_hidden, 0) = 0 ORDER BY datetime(created_at) ASC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok();

        conn.execute(
            "UPDATE workspaces SET active_session_id = ?1 WHERE id = 'w1' AND active_session_id = 's1'",
            [next.as_deref()],
        ).unwrap();

        // No visible sessions left, so active_session_id should be NULL
        assert_eq!(get_active_session_id(&conn, "w1"), None);
        assert_eq!(count_hidden_sessions(&conn, "w1"), 1);
    }

    #[test]
    fn hide_session_switches_to_next_visible_session() {
        let (conn, _dir) = test_db();
        seed_two_sessions(&conn);
        assert_eq!(get_active_session_id(&conn, "w1"), Some("s1".to_string()));

        // Hide s1 — should switch active to s2
        conn.execute("UPDATE sessions SET is_hidden = 1 WHERE id = 's1'", [])
            .unwrap();

        let next: Option<String> = conn
            .query_row(
                "SELECT id FROM sessions WHERE workspace_id = 'w1' AND COALESCE(is_hidden, 0) = 0 ORDER BY datetime(created_at) ASC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok();

        conn.execute(
            "UPDATE workspaces SET active_session_id = ?1 WHERE id = 'w1' AND active_session_id = 's1'",
            [next.as_deref()],
        ).unwrap();

        assert_eq!(get_active_session_id(&conn, "w1"), Some("s2".to_string()));
    }

    #[test]
    fn adjacent_visible_session_prefers_right_then_left() {
        let (mut conn, _dir) = test_db();
        seed_three_sessions(&conn);
        let transaction = conn.transaction().unwrap();

        assert_eq!(
            adjacent_visible_session_id(&transaction, "w1", "s1").unwrap(),
            Some("s2".to_string())
        );
        assert_eq!(
            adjacent_visible_session_id(&transaction, "w1", "s2").unwrap(),
            Some("s3".to_string())
        );
        assert_eq!(
            adjacent_visible_session_id(&transaction, "w1", "s3").unwrap(),
            Some("s2".to_string())
        );
    }

    #[test]
    fn delete_session_clears_active_session_id() {
        let (conn, _dir) = test_db();
        seed_with_active_session(&conn);
        assert_eq!(get_active_session_id(&conn, "w1"), Some("s1".to_string()));

        // Delete s1 — simulates the transactional logic in delete_session()
        conn.execute("DELETE FROM session_messages WHERE session_id = 's1'", [])
            .unwrap();
        conn.execute("DELETE FROM sessions WHERE id = 's1'", [])
            .unwrap();
        conn.execute(
            "UPDATE workspaces SET active_session_id = NULL WHERE id = 'w1' AND active_session_id = 's1'",
            [],
        ).unwrap();

        assert_eq!(get_active_session_id(&conn, "w1"), None);
        assert_eq!(count_sessions(&conn, "w1"), 0);
    }

    #[test]
    fn delete_active_session_switches_to_adjacent_visible_session() {
        let (mut conn, _dir) = test_db();
        seed_three_sessions(&conn);
        conn.execute(
            "UPDATE workspaces SET active_session_id = 's2' WHERE id = 'w1'",
            [],
        )
        .unwrap();

        let transaction = conn.transaction().unwrap();
        let next_session_id = adjacent_visible_session_id(&transaction, "w1", "s2").unwrap();
        transaction
            .execute("DELETE FROM session_messages WHERE session_id = 's2'", [])
            .unwrap();
        transaction
            .execute("DELETE FROM sessions WHERE id = 's2'", [])
            .unwrap();
        transaction
            .execute(
                "UPDATE workspaces SET active_session_id = ?1 WHERE id = 'w1' AND active_session_id = 's2'",
                [next_session_id.as_deref()],
            )
            .unwrap();
        transaction.commit().unwrap();

        assert_eq!(get_active_session_id(&conn, "w1"), Some("s3".to_string()));
    }

    #[test]
    fn create_session_validates_workspace_exists() {
        let (conn, _dir) = test_db();
        // No seed — workspace 'w1' does not exist
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM workspaces WHERE id = 'w1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "workspace should not exist");

        // Attempting to insert a session for a non-existent workspace should
        // be caught by the validation check (not by FK, since FK may not be enforced)
        let workspace_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM workspaces WHERE id = 'w1'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap();
        assert!(!workspace_exists);
    }

    #[test]
    fn create_session_sets_active_session_id() {
        let (conn, _dir) = test_db();
        seed(&conn);
        assert_eq!(get_active_session_id(&conn, "w1"), None);

        // Simulate create_session logic
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, status, title, permission_mode) VALUES ('s_new', 'w1', 'idle', 'Untitled', 'default')",
            [],
        ).unwrap();
        let updated = conn
            .execute(
                "UPDATE workspaces SET active_session_id = 's_new' WHERE id = 'w1'",
                [],
            )
            .unwrap();
        assert_eq!(updated, 1);
        assert_eq!(
            get_active_session_id(&conn, "w1"),
            Some("s_new".to_string())
        );
    }

    #[test]
    fn action_session_title_uses_mr_wording_on_gitlab() {
        let (conn, _dir) = test_db();
        seed(&conn);
        conn.execute(
            "UPDATE repos SET forge_provider = 'gitlab' WHERE id = 'r1'",
            [],
        )
        .unwrap();
        let tx = conn.unchecked_transaction().unwrap();

        let gitlab_title = default_session_title_for_action_kind_with_workspace(
            &tx,
            "w1",
            Some(ActionKind::CreatePr),
        )
        .unwrap();
        assert_eq!(gitlab_title, "Create MR");

        let open_title = default_session_title_for_action_kind_with_workspace(
            &tx,
            "w1",
            Some(ActionKind::OpenPr),
        )
        .unwrap();
        assert_eq!(open_title, "Open MR");

        // Non-PR kinds still use their normal title.
        let merge_title = default_session_title_for_action_kind_with_workspace(
            &tx,
            "w1",
            Some(ActionKind::Merge),
        )
        .unwrap();
        assert_eq!(merge_title, "Merge");

        // No action kind → "Untitled".
        let untitled =
            default_session_title_for_action_kind_with_workspace(&tx, "w1", None).unwrap();
        assert_eq!(untitled, "Untitled");
    }

    #[test]
    fn action_session_title_keeps_pr_wording_on_github_or_missing_provider() {
        let (conn, _dir) = test_db();
        seed(&conn);
        let tx = conn.unchecked_transaction().unwrap();

        // forge_provider is NULL (legacy row) → default to PR wording.
        let null_title = default_session_title_for_action_kind_with_workspace(
            &tx,
            "w1",
            Some(ActionKind::CreatePr),
        )
        .unwrap();
        assert_eq!(null_title, "Create PR");

        // forge_provider = 'github' → also PR.
        tx.execute(
            "UPDATE repos SET forge_provider = 'github' WHERE id = 'r1'",
            [],
        )
        .unwrap();
        let gh_title = default_session_title_for_action_kind_with_workspace(
            &tx,
            "w1",
            Some(ActionKind::CreatePr),
        )
        .unwrap();
        assert_eq!(gh_title, "Create PR");
    }

    #[test]
    fn unhide_session_restores_visibility() {
        let (conn, _dir) = test_db();
        seed_with_active_session(&conn);

        // Hide then unhide
        conn.execute("UPDATE sessions SET is_hidden = 1 WHERE id = 's1'", [])
            .unwrap();
        assert_eq!(count_hidden_sessions(&conn, "w1"), 1);

        conn.execute("UPDATE sessions SET is_hidden = 0 WHERE id = 's1'", [])
            .unwrap();
        assert_eq!(count_hidden_sessions(&conn, "w1"), 0);

        let visible: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE workspace_id = 'w1' AND COALESCE(is_hidden, 0) = 0",
                [],
                |r| r.get(0),
        )
        .unwrap();
        assert_eq!(visible, 1);
    }

    #[test]
    fn list_hidden_sessions_orders_by_created_at() {
        let (conn, _dir) = test_db();
        seed_with_active_session(&conn);
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, status, title, created_at, updated_at, is_hidden) VALUES ('s2', 'w1', 'idle', 'Second Session', '2026-01-02T00:00:00', '2026-01-03T00:00:00', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE sessions SET is_hidden = 1, updated_at = '2026-01-04T00:00:00' WHERE id = 's1'",
            [],
        )
        .unwrap();

        let mut stmt = conn
            .prepare(
                "SELECT id FROM sessions WHERE workspace_id = 'w1' AND is_hidden = 1 ORDER BY datetime(created_at) ASC",
            )
            .unwrap();
        let hidden_ids = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(std::result::Result::ok)
            .collect::<Vec<String>>();
        assert_eq!(hidden_ids, vec!["s2", "s1"]);
    }

    #[test]
    fn messages_ordered_by_created_at() {
        let (conn, _dir) = test_db();
        seed(&conn);
        conn.execute(
            "INSERT INTO session_messages (id, session_id, role, content, created_at) VALUES ('m1', 's1', 'user', 'first', '2026-01-01T00:00:00')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO session_messages (id, session_id, role, content, created_at) VALUES ('m2', 's1', 'assistant', 'second', '2026-01-01T00:01:00')",
            [],
        ).unwrap();

        let mut stmt = conn
            .prepare(
                "SELECT role FROM session_messages WHERE session_id = 's1' ORDER BY created_at ASC",
            )
            .unwrap();
        let roles: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert_eq!(roles, vec!["user", "assistant"]);
    }

    #[test]
    fn historical_records_order_mixed_timestamp_formats_chronologically() {
        let (conn, _dir) = test_db();
        seed(&conn);
        conn.execute(
            r#"
            INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at)
            VALUES ('user-message', 's1', 'user', '{"type":"user_prompt","text":"delegate please"}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
            "#,
            [],
        )
        .unwrap();
        conn.execute(
            r#"
            INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at)
            VALUES ('delegate-anchor', 's1', 'assistant', '{"type":"delegation_anchor","delegationId":"d1","parentSessionId":"s1","childSessionId":"child","title":"Delegate","provider":"codex","status":"succeeded","outputSchema":{}}', '2026-01-01 00:00:01', '2026-01-01 00:00:01')
            "#,
            [],
        )
        .unwrap();

        let records = list_session_historical_records_with_connection(&conn, "s1").unwrap();

        assert_eq!(
            records
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            vec!["user-message", "delegate-anchor"]
        );
    }

    #[test]
    fn read_session_context_usage_handles_missing_session() {
        let (conn, _dir) = test_db();
        seed(&conn);
        // No row for "ghost" — must be Ok(None), NOT an error.
        let meta = read_session_context_usage(&conn, "ghost").unwrap();
        assert_eq!(meta, None);
    }

    #[test]
    fn read_session_context_usage_returns_none_for_null_meta() {
        let (conn, _dir) = test_db();
        seed(&conn);
        // Seeded session has context_usage_meta NULL by default.
        let meta = read_session_context_usage(&conn, "s1").unwrap();
        assert_eq!(meta, None);
    }

    #[test]
    fn read_session_context_usage_returns_stored_string() {
        let (conn, _dir) = test_db();
        seed(&conn);
        conn.execute(
            "UPDATE sessions SET context_usage_meta = ?1 WHERE id = 's1'",
            [r#"{"totalTokens":7}"#],
        )
        .unwrap();
        let meta = read_session_context_usage(&conn, "s1").unwrap();
        assert_eq!(meta.as_deref(), Some(r#"{"totalTokens":7}"#));
    }

    #[test]
    fn read_session_context_usage_filters_empty_string_to_none() {
        let (conn, _dir) = test_db();
        seed(&conn);
        conn.execute(
            "UPDATE sessions SET context_usage_meta = '' WHERE id = 's1'",
            [],
        )
        .unwrap();
        let meta = read_session_context_usage(&conn, "s1").unwrap();
        assert_eq!(meta, None);
    }
    #[test]
    fn workspace_session_list_hides_delegated_children_and_counts_them() {
        let _env = crate::testkit::TestEnv::new("delegated-root-list");
        let conn = crate::models::db::write_conn().unwrap();
        conn.execute(
            "INSERT INTO repos (id, name, root_path) VALUES ('repo-root-list', 'repo', '/tmp')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO workspaces (id, repository_id, directory_name, state, status) VALUES ('workspace-root-list', 'repo-root-list', 'repo', 'active', 'in-progress')", []).unwrap();
        conn.execute("INSERT INTO sessions (id, workspace_id, status, title, agent_type) VALUES ('parent-root-list', 'workspace-root-list', 'idle', 'Parent', 'claude')", []).unwrap();
        conn.execute("INSERT INTO sessions (id, workspace_id, status, title, agent_type) VALUES ('child-root-list', 'workspace-root-list', 'idle', 'Child', 'codex')", []).unwrap();
        conn.execute("INSERT INTO session_messages (id, session_id, role, content) VALUES ('anchor-root-list', 'parent-root-list', 'assistant', '{}')", []).unwrap();
        conn.execute("INSERT INTO session_delegations (id, parent_session_id, child_session_id, parent_message_id, provider, model_id, title, status, output_schema) VALUES ('delegation-root-list', 'parent-root-list', 'child-root-list', 'anchor-root-list', 'codex', 'gpt-5.4', 'Child', 'running', '{}')", []).unwrap();
        drop(conn);

        let sessions = list_workspace_sessions("workspace-root-list").unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "parent-root-list");
        assert_eq!(sessions[0].child_count, 1);
        assert_eq!(sessions[0].parent_session_id, None);
        assert_eq!(sessions[0].delegation_status, None);
    }

    #[test]
    fn deleting_parent_session_removes_delegated_child_tree() {
        let _env = crate::testkit::TestEnv::new("delegated-delete-cascade");
        let conn = crate::models::db::write_conn().unwrap();
        conn.execute(
            "INSERT INTO repos (id, name, root_path) VALUES ('repo-cascade', 'repo', '/tmp')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO workspaces (id, repository_id, directory_name, state, status, active_session_id) VALUES ('workspace-cascade', 'repo-cascade', 'repo', 'active', 'in-progress', 'parent-cascade')", []).unwrap();
        conn.execute("INSERT INTO sessions (id, workspace_id, status, title, agent_type) VALUES ('parent-cascade', 'workspace-cascade', 'idle', 'Parent', 'claude')", []).unwrap();
        conn.execute("INSERT INTO sessions (id, workspace_id, status, title, agent_type) VALUES ('child-cascade', 'workspace-cascade', 'idle', 'Child', 'codex')", []).unwrap();
        conn.execute("INSERT INTO session_messages (id, session_id, role, content) VALUES ('anchor-cascade', 'parent-cascade', 'assistant', '{}')", []).unwrap();
        conn.execute("INSERT INTO session_messages (id, session_id, role, content) VALUES ('child-message-cascade', 'child-cascade', 'assistant', '{}')", []).unwrap();
        conn.execute("INSERT INTO session_delegations (id, parent_session_id, child_session_id, parent_message_id, provider, model_id, title, status, output_schema) VALUES ('delegation-cascade', 'parent-cascade', 'child-cascade', 'anchor-cascade', 'codex', 'gpt-5.4', 'Child', 'running', '{}')", []).unwrap();
        drop(conn);

        delete_session("parent-cascade").unwrap();
        let conn = crate::models::db::read_conn().unwrap();
        let session_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE id IN ('parent-cascade', 'child-cascade')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let message_count: i64 = conn.query_row("SELECT COUNT(*) FROM session_messages WHERE id IN ('anchor-cascade', 'child-message-cascade')", [], |row| row.get(0)).unwrap();
        let delegation_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_delegations WHERE id = 'delegation-cascade'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(session_count, 0);
        assert_eq!(message_count, 0);
        assert_eq!(delegation_count, 0);
    }

    #[test]
    fn deleting_session_tree_removes_assignee_artifacts() {
        let _env = crate::testkit::TestEnv::new("assignee-delete-cascade");
        let conn = crate::models::db::write_conn().unwrap();
        conn.execute(
            "INSERT INTO repos (id, name, root_path) VALUES ('repo-assignee-delete', 'repo', '/tmp')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO workspaces (id, repository_id, directory_name, state, status, active_session_id, workspace_kind) VALUES ('goal-assignee-delete', 'repo-assignee-delete', 'goal', 'active', 'in-progress', 'supervisor-assignee-delete', 'goal')", []).unwrap();
        conn.execute("INSERT INTO workspaces (id, repository_id, directory_name, state, status, active_session_id, workspace_kind, goal_workspace_id) VALUES ('workspace-assignee-delete', 'repo-assignee-delete', 'card', 'active', 'in-progress', 'parent-assignee-delete', 'code', 'goal-assignee-delete')", []).unwrap();
        conn.execute("INSERT INTO sessions (id, workspace_id, status, title, agent_type) VALUES ('supervisor-assignee-delete', 'goal-assignee-delete', 'idle', 'Supervisor', 'pi')", []).unwrap();
        conn.execute("INSERT INTO sessions (id, workspace_id, status, title, agent_type, thread_role) VALUES ('parent-assignee-delete', 'workspace-assignee-delete', 'idle', 'Assignee', 'pi', 'assignee')", []).unwrap();
        conn.execute("INSERT INTO sessions (id, workspace_id, status, title, agent_type) VALUES ('child-assignee-delete', 'workspace-assignee-delete', 'idle', 'Delegate', 'codex')", []).unwrap();
        conn.execute("INSERT INTO session_messages (id, session_id, role, content) VALUES ('anchor-assignee-delete', 'parent-assignee-delete', 'assistant', '{}')", []).unwrap();
        conn.execute("INSERT INTO session_delegations (id, parent_session_id, child_session_id, parent_message_id, provider, model_id, title, status, output_schema) VALUES ('delegation-assignee-delete', 'parent-assignee-delete', 'child-assignee-delete', 'anchor-assignee-delete', 'codex', 'gpt-5.4', 'Delegate', 'running', '{}')", []).unwrap();
        conn.execute("INSERT INTO goal_supervisor_notifications (id, goal_workspace_id, card_workspace_id, assignee_session_id, message_id, report_type, excerpt, delivered_to_session_id) VALUES ('notification-parent-delete', 'goal-assignee-delete', 'workspace-assignee-delete', 'parent-assignee-delete', 'report-parent-delete', 'completed', 'done', 'supervisor-assignee-delete')", []).unwrap();
        conn.execute("INSERT INTO goal_supervisor_notifications (id, goal_workspace_id, card_workspace_id, assignee_session_id, message_id, report_type, excerpt, delivered_to_session_id) VALUES ('notification-child-delete', 'goal-assignee-delete', 'workspace-assignee-delete', 'child-assignee-delete', 'report-child-delete', 'runtime_issue', 'failed', 'supervisor-assignee-delete')", []).unwrap();
        conn.execute(
            "INSERT INTO session_messages (id, session_id, role, content) VALUES ('delivered-parent-delete', 'supervisor-assignee-delete', 'system', ?1)",
            [serde_json::json!({
                "type": "goal_assignee_report",
                "assigneeSessionId": "parent-assignee-delete",
                "message": "done"
            })
            .to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session_messages (id, session_id, role, content) VALUES ('delivered-child-delete', 'supervisor-assignee-delete', 'system', ?1)",
            [serde_json::json!({
                "type": "goal_assignee_runtime_issue",
                "assigneeSessionId": "child-assignee-delete",
                "message": "failed"
            })
            .to_string()],
        )
        .unwrap();
        conn.execute("INSERT INTO pending_cli_sends (id, workspace_id, session_id, prompt) VALUES ('pending-parent-delete', 'workspace-assignee-delete', 'parent-assignee-delete', 'continue')", []).unwrap();
        conn.execute("INSERT INTO pending_cli_sends (id, workspace_id, session_id, prompt) VALUES ('pending-child-delete', 'workspace-assignee-delete', 'child-assignee-delete', 'continue')", []).unwrap();
        conn.execute("INSERT INTO session_command_audit_log (id, session_id, actor, command) VALUES ('audit-parent-delete', 'parent-assignee-delete', 'agent', 'test')", []).unwrap();
        conn.execute("INSERT INTO session_command_audit_log (id, session_id, actor, command) VALUES ('audit-child-delete', 'child-assignee-delete', 'agent', 'test')", []).unwrap();
        drop(conn);

        delete_session("parent-assignee-delete").unwrap();
        let conn = crate::models::db::read_conn().unwrap();
        for (table, expected) in [
            (
                "sessions",
                "id IN ('parent-assignee-delete', 'child-assignee-delete')",
            ),
            (
                "session_messages",
                "id IN ('anchor-assignee-delete', 'delivered-parent-delete', 'delivered-child-delete')",
            ),
            (
                "session_delegations",
                "id = 'delegation-assignee-delete'",
            ),
            (
                "goal_supervisor_notifications",
                "id IN ('notification-parent-delete', 'notification-child-delete')",
            ),
            (
                "pending_cli_sends",
                "id IN ('pending-parent-delete', 'pending-child-delete')",
            ),
            (
                "session_command_audit_log",
                "id IN ('audit-parent-delete', 'audit-child-delete')",
            ),
        ] {
            let count: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE {expected}"),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "{table} should be cleaned up");
        }
    }
}
