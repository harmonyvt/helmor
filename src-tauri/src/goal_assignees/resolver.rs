use anyhow::{bail, Context, Result};

use crate::{
    models::workspaces as workspace_models, service, sessions, workspace_kind::WorkspaceKind,
};

pub(super) struct ResolvedAssignee {
    pub(super) card_id: String,
    pub(super) workspace_id: String,
    pub(super) session: sessions::WorkspaceSessionSummary,
}

pub(super) fn resolve_assignee(goal_workspace_id: &str, card_id: &str) -> Result<ResolvedAssignee> {
    let goal_workspace_id = service::resolve_workspace_ref(goal_workspace_id)?;
    let workspace_id = resolve_child_workspace_id(&goal_workspace_id, card_id)?;
    let record = workspace_models::load_workspace_record_by_id(&workspace_id)?
        .with_context(|| format!("Goal child workspace not found: {workspace_id}"))?;

    if record.workspace_kind != WorkspaceKind::Code
        || record.goal_workspace_id.as_deref() != Some(goal_workspace_id.as_str())
    {
        bail!("Workspace {workspace_id} is not a child of Goal workspace {goal_workspace_id}");
    }

    let sessions = sessions::list_workspace_sessions(&workspace_id)?;
    let session = sessions
        .iter()
        .find(|session| Some(session.id.as_str()) == record.active_session_id.as_deref())
        .or_else(|| sessions.iter().find(|session| session.active))
        .or_else(|| sessions.first())
        .cloned()
        .with_context(|| format!("Goal child workspace {workspace_id} has no assignee session"))?;

    Ok(ResolvedAssignee {
        card_id: card_id.to_string(),
        workspace_id,
        session,
    })
}

pub(super) fn resolve_thread_assignee(
    goal_workspace_id: &str,
    card_id: &str,
    thread_id: &str,
) -> Result<ResolvedAssignee> {
    let goal_workspace_id = service::resolve_workspace_ref(goal_workspace_id)?;
    let workspace_id = resolve_child_workspace_id(&goal_workspace_id, card_id)?;
    let record = workspace_models::load_workspace_record_by_id(&workspace_id)?
        .with_context(|| format!("Goal child workspace not found: {workspace_id}"))?;

    if record.workspace_kind != WorkspaceKind::Code
        || record.goal_workspace_id.as_deref() != Some(goal_workspace_id.as_str())
    {
        bail!("Workspace {workspace_id} is not a child of Goal workspace {goal_workspace_id}");
    }

    let sessions = sessions::list_workspace_sessions(&workspace_id)?;
    let session = sessions
        .into_iter()
        .find(|session| session.id == thread_id)
        .with_context(|| {
            format!("Thread {thread_id} is not in Goal child workspace {workspace_id}")
        })?;

    Ok(ResolvedAssignee {
        card_id: card_id.to_string(),
        workspace_id,
        session,
    })
}

fn resolve_child_workspace_id(goal_workspace_id: &str, card_id: &str) -> Result<String> {
    if let Some(record) = workspace_models::load_workspace_record_by_id(card_id)? {
        if record.goal_workspace_id.as_deref() == Some(goal_workspace_id) {
            return Ok(record.id);
        }
    }

    let goal_workspace_id = goal_workspace_id.to_string();
    let card_id = card_id.to_string();
    let card_id_for_error = card_id.clone();
    let linked = super::block_on_goal_assignee_db(async move {
        let connection = crate::models::db::libsql_conn_async().await?;
        let mut rows = connection
            .query(
                "SELECT child_workspace_id FROM goal_cards WHERE id = ?1 AND goal_workspace_id = ?2",
                libsql::params![card_id, goal_workspace_id],
            )
            .await
            .context("Failed to resolve goal card child workspace")?;
        match rows.next().await? {
            Some(row) => row
                .get::<String>(0)
                .map(Some)
                .context("Failed to read goal card child workspace"),
            None => Ok(None),
        }
    })?;

    linked
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("Goal card {card_id_for_error} has no assigned child workspace"))
}
