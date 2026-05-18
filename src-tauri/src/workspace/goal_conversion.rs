use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::future::Future;
use std::path::Path;
use std::process::Command;

use crate::{
    db, forge, git_ops, helpers,
    models::workspaces::{self as workspace_models, WorkspaceRecord},
    workspace_kind::WorkspaceKind,
    workspace_pr_sync::PrSyncState,
    workspace_status::WorkspaceStatus,
};

fn block_on_libsql<T>(future: impl Future<Output = Result<T>>) -> Result<T> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(future)),
        Err(_) => tauri::async_runtime::block_on(future),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertWorkspaceToGoalResponse {
    pub workspace_id: String,
    pub pr_title: String,
    pub pr_url: Option<String>,
    pub pr_sync_state: PrSyncState,
}

pub fn convert_workspace_to_goal(workspace_id: &str) -> Result<ConvertWorkspaceToGoalResponse> {
    let record = workspace_models::load_workspace_record_by_id(workspace_id)?
        .with_context(|| format!("Workspace not found: {workspace_id}"))?;
    if record.workspace_kind == WorkspaceKind::Goal {
        let pr_title = record
            .pr_title
            .clone()
            .unwrap_or_else(|| helpers::display_title(&record));
        return Ok(ConvertWorkspaceToGoalResponse {
            workspace_id: record.id,
            pr_title,
            pr_url: record.pr_url,
            pr_sync_state: record.pr_sync_state,
        });
    }
    if record.workspace_kind != WorkspaceKind::Code {
        bail!("Unsupported workspace kind: {}", record.workspace_kind);
    }
    if !record.state.is_operational() {
        bail!(
            "Cannot convert workspace: workspace is {} (archived or mid-creation)",
            record.state
        );
    }

    let workspace_dir = crate::data_dir::workspace_dir(&record.repo_name, &record.directory_name)?;
    if !workspace_dir.is_dir() {
        bail!("Workspace directory is missing for {workspace_id}");
    }

    let title = goal_title_for_record(&record);
    let description = goal_description_for_record(&record, &title);
    let change_request = ensure_change_request(&record, &workspace_dir, &title, &description)?;
    convert_workspace_record(workspace_id, &title, &description, change_request.as_ref())?;

    Ok(ConvertWorkspaceToGoalResponse {
        workspace_id: workspace_id.to_string(),
        pr_title: change_request
            .as_ref()
            .map(|pr| pr.title.clone())
            .unwrap_or(title),
        pr_url: change_request.as_ref().map(|pr| pr.url.clone()),
        pr_sync_state: PrSyncState::Open,
    })
}

fn ensure_change_request(
    record: &WorkspaceRecord,
    workspace_dir: &Path,
    title: &str,
    description: &str,
) -> Result<Option<forge::ChangeRequestInfo>> {
    if let Some(existing) = forge::refresh_workspace_change_request(&record.id)? {
        if existing.state == "OPEN" {
            return Ok(Some(existing));
        }
    }

    ensure_branch_has_commit_for_goal(record, workspace_dir, title, description)?;
    let remote = record.remote.as_deref().unwrap_or("origin");
    git_ops::push_current_branch(workspace_dir, remote)?;
    let pr_url = create_draft_pr(workspace_dir, title, description, record)?;

    Ok(Some(forge::ChangeRequestInfo {
        url: pr_url.unwrap_or_default(),
        number: 0,
        state: "OPEN".to_string(),
        title: title.to_string(),
        is_merged: false,
        head_branch: record.branch.clone(),
        base_branch: record.intended_target_branch.clone(),
        head_commit_sha: None,
    }))
}

fn ensure_branch_has_commit_for_goal(
    record: &WorkspaceRecord,
    workspace_dir: &Path,
    title: &str,
    description: &str,
) -> Result<()> {
    let base_ref = record
        .intended_target_branch
        .as_deref()
        .or(record.default_branch.as_deref())
        .unwrap_or("main");
    let ahead = git_ops::commits_ahead_of(workspace_dir, base_ref).unwrap_or(1);
    if ahead > 0 {
        return Ok(());
    }

    let message = format!("goal: {title}\n\n{description}");
    git_ops::run_git(
        [
            "-C",
            workspace_dir.to_str().unwrap_or(""),
            "commit",
            "--allow-empty",
            "-m",
            &message,
        ],
        None,
    )
    .with_context(|| format!("Failed to create empty Goal commit for {}", record.id))?;
    Ok(())
}

fn create_draft_pr(
    workspace_dir: &Path,
    title: &str,
    description: &str,
    record: &WorkspaceRecord,
) -> Result<Option<String>> {
    let base = record
        .intended_target_branch
        .as_deref()
        .or(record.default_branch.as_deref())
        .unwrap_or("main");
    let branch = record
        .branch
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("Workspace {} is missing branch", record.id))?;
    let body = build_goal_body(description);
    let gh = forge::bundled_path_for("gh").unwrap_or_else(|| "gh".into());
    let output = Command::new(gh)
        .arg("pr")
        .arg("create")
        .arg("--draft")
        .arg("--title")
        .arg(title)
        .arg("--body")
        .arg(body)
        .arg("--base")
        .arg(base)
        .arg("--head")
        .arg(branch)
        .current_dir(workspace_dir)
        .output()
        .context("Failed to run gh pr create")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        bail!("Failed to create draft PR: {detail}");
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .split_whitespace()
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(|value| value.trim().to_string()))
}

fn convert_workspace_record(
    workspace_id: &str,
    title: &str,
    description: &str,
    change_request: Option<&forge::ChangeRequestInfo>,
) -> Result<()> {
    let pr_url = change_request
        .map(|pr| pr.url.as_str())
        .filter(|url| !url.is_empty());
    let pr_title = change_request
        .map(|pr| pr.title.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(title);
    let workspace_id = workspace_id.to_string();
    let title = title.to_string();
    let description = description.to_string();
    let pr_title = pr_title.to_string();
    let pr_url = pr_url.map(str::to_string);
    let workspace_id_for_error = workspace_id.clone();
    let updated = block_on_libsql(db::libsql_write_async(|connection| async move {
        connection
            .execute(
                r#"
                UPDATE workspaces
                SET workspace_kind = ?2,
                    goal_workspace_id = NULL,
                    goal_title = ?3,
                    goal_description = ?4,
                    pr_title = ?5,
                    pr_url = ?6,
                    pr_sync_state = ?7,
                    status = ?8,
                    updated_at = datetime('now')
                WHERE id = ?1
                "#,
                libsql::params![
                    workspace_id,
                    WorkspaceKind::Goal.as_str(),
                    title,
                    description,
                    pr_title,
                    pr_url,
                    PrSyncState::Open.as_str(),
                    WorkspaceStatus::Review.as_str(),
                ],
            )
            .await
            .context("Failed to convert workspace to goal")
    }))?;
    if updated != 1 {
        bail!("Workspace not found: {workspace_id_for_error}");
    }
    Ok(())
}

fn goal_title_for_record(record: &WorkspaceRecord) -> String {
    record
        .goal_title
        .as_deref()
        .or(record.pr_title.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| helpers::display_title(record))
}

fn goal_description_for_record(record: &WorkspaceRecord, title: &str) -> String {
    record
        .goal_description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("Converted from workspace \"{title}\"."))
}

fn build_goal_body(description: &str) -> String {
    format!(
        "{description}\n\n<!-- HELMOR_GOAL_CHILD_WORKSPACES:START -->\n## Helmor child workspaces\n\n_No child workspaces yet._\n<!-- HELMOR_GOAL_CHILD_WORKSPACES:END -->\n"
    )
}
