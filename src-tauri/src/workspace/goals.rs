use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::{
    db, git_ops, github_graphql, helpers,
    models::{goals as goal_models, workspaces as workspace_models},
    repos,
    workspace_kind::WorkspaceKind,
    workspace_pr_sync::PrSyncState,
    workspace_state::WorkspaceState,
    workspace_status::WorkspaceStatus,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareGoalWorkspaceRequest {
    pub repo_id: String,
    pub title: String,
    pub description: String,
    pub target_branch: Option<String>,
    pub source_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareGoalWorkspaceResponse {
    pub workspace_id: String,
    pub initial_session_id: String,
    pub repo_id: String,
    pub repo_name: String,
    pub directory_name: String,
    pub branch: String,
    pub default_branch: String,
    pub intended_target_branch: String,
    pub source_start_branch: Option<String>,
    pub title: String,
    pub description: String,
    pub state: WorkspaceState,
    pub repo_scripts: repos::RepoScripts,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeGoalWorkspaceResponse {
    pub workspace_id: String,
    pub final_state: WorkspaceState,
    pub pr_title: String,
    pub pr_url: Option<String>,
    pub pr_sync_state: PrSyncState,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalChildWorkspaceRequest {
    pub goal_workspace_id: String,
    pub goal_card_id: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub lane: Option<WorkspaceStatus>,
    pub target_branch: Option<String>,
    pub assigned_provider: Option<String>,
    pub assigned_model_id: Option<String>,
    pub assigned_effort_level: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalChildWorkspaceStatusRequest {
    pub goal_workspace_id: String,
    pub child_workspace_id: String,
    pub status: WorkspaceStatus,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignWorkspaceToGoalRequest {
    pub workspace_id: String,
    pub goal_workspace_id: String,
    pub status: WorkspaceStatus,
}

pub use goal_models::{GoalCard, UpsertGoalCardInput};

pub fn prepare_goal_workspace(
    request: PrepareGoalWorkspaceRequest,
) -> Result<PrepareGoalWorkspaceResponse> {
    let repository = repos::load_repository_by_id(&request.repo_id)?
        .with_context(|| format!("Repository not found: {}", request.repo_id))?;
    let repo_root = PathBuf::from(repository.root_path.trim());
    git_ops::ensure_git_repository(&repo_root)?;

    let remote = repository
        .remote
        .clone()
        .unwrap_or_else(|| "origin".to_string());
    if !git_ops::has_remote(&repo_root, &remote)? {
        bail!(
            "Repository \"{}\" has no remote \"{remote}\". Goal workspaces require a remote for their draft PR.",
            repository.name
        );
    }

    let title = normalize_optional_str(&request.title);
    let description = normalize_optional_str(&request.description);
    let default_branch = repository
        .default_branch
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "main".to_string());
    let source_branch = request
        .source_branch
        .as_deref()
        .map(normalize_source_branch)
        .transpose()?;
    let existing_pr = source_branch
        .as_deref()
        .map(|branch| {
            github_graphql::resolve_repository_pull_request_by_head_branch(&repository, branch)
        })
        .transpose()?
        .flatten();
    let title = existing_pr
        .as_ref()
        .map(|pr| pr.title.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or(title)
        .context("Goal title is required")?;
    let description = existing_pr
        .as_ref()
        .map(|pr| pr.body.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or(description)
        .context("Goal description is required")?;
    let target_branch = existing_pr
        .as_ref()
        .map(|pr| pr.base_branch.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            request
                .target_branch
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| default_branch.clone());
    if existing_pr.is_none() {
        if let Some(branch) = source_branch.as_deref() {
            ensure_source_branch_available(&repo_root, branch)?;
        }
    }
    let directory_name = allocate_goal_directory_name(&request.repo_id, &title)?;
    let branch = match source_branch.clone() {
        Some(branch) => branch,
        None => helpers::next_available_branch_name(
            &repo_root,
            &format!("helmor/goal/{}", slugify(&title)),
        )?,
    };
    let workspace_id = uuid::Uuid::new_v4().to_string();
    let session_id = uuid::Uuid::new_v4().to_string();
    let timestamp = db::current_timestamp()?;

    workspace_models::insert_initializing_workspace_and_session_with_metadata(
        &repository,
        &workspace_id,
        &session_id,
        &directory_name,
        &branch,
        workspace_models::InitializingWorkspaceMetadata {
            initialization_parent_branch: &target_branch,
            intended_target_branch: &target_branch,
            workspace_kind: WorkspaceKind::Goal,
            goal_workspace_id: None,
            status: if existing_pr.is_some() {
                WorkspaceStatus::Review
            } else {
                WorkspaceStatus::Backlog
            },
            pr_title: Some(&title),
            pr_sync_state: if existing_pr.is_some() {
                PrSyncState::Open
            } else {
                PrSyncState::None
            },
            pr_url: existing_pr.as_ref().map(|pr| pr.url.as_str()),
            timestamp: &timestamp,
        },
    )?;

    // Write goal_title and goal_description so the Goals panel header and
    // Pi agent context show the values the user entered at creation time.
    crate::models::workspaces::update_goal_workspace_meta(
        &workspace_id,
        Some(&title),
        Some(&description),
    )?;

    let repo_scripts = repos::load_repo_scripts(&request.repo_id, Some(&workspace_id)).unwrap_or(
        repos::RepoScripts {
            setup_script: None,
            run_script: None,
            archive_script: None,
            setup_from_project: false,
            run_from_project: false,
            archive_from_project: false,
            auto_run_setup: true,
        },
    );

    Ok(PrepareGoalWorkspaceResponse {
        workspace_id,
        initial_session_id: session_id,
        repo_id: repository.id,
        repo_name: repository.name,
        directory_name,
        branch,
        default_branch,
        intended_target_branch: target_branch,
        source_start_branch: source_branch,
        title,
        description,
        state: WorkspaceState::Initializing,
        repo_scripts,
    })
}

pub fn finalize_goal_workspace(
    workspace_id: &str,
    description: &str,
    source_start_branch: Option<&str>,
) -> Result<FinalizeGoalWorkspaceResponse> {
    let record = workspace_models::load_workspace_record_by_id(workspace_id)?
        .with_context(|| format!("Workspace not found: {workspace_id}"))?;
    if record.workspace_kind != WorkspaceKind::Goal {
        bail!("Workspace is not a Goal: {workspace_id}");
    }

    let finalized = super::lifecycle::finalize_workspace_from_repo_with_options_impl(
        workspace_id,
        super::lifecycle::FinalizeWorkspaceOptions {
            start_branch: source_start_branch.map(ToOwned::to_owned),
            fetch_start_branch: source_start_branch.map(|_| true),
            migrate_from_path: None,
        },
    )?;
    let refreshed = workspace_models::load_workspace_record_by_id(workspace_id)?
        .with_context(|| format!("Workspace not found after finalize: {workspace_id}"))?;
    let repo_root = refreshed
        .root_path
        .as_deref()
        .map(PathBuf::from)
        .with_context(|| format!("Goal workspace {workspace_id} is missing repository root"))?;
    let workspace_dir =
        crate::data_dir::workspace_dir(&refreshed.repo_name, &refreshed.directory_name)?;
    let branch = refreshed
        .branch
        .as_deref()
        .with_context(|| format!("Goal workspace {workspace_id} is missing branch"))?;
    let remote = refreshed.remote.as_deref().unwrap_or("origin");
    let title = refreshed
        .pr_title
        .clone()
        .unwrap_or_else(|| helpers::display_title(&refreshed));
    if refreshed.pr_sync_state == PrSyncState::Open && refreshed.pr_url.is_some() {
        return Ok(FinalizeGoalWorkspaceResponse {
            workspace_id: workspace_id.to_string(),
            final_state: finalized.final_state,
            pr_title: title,
            pr_url: refreshed.pr_url,
            pr_sync_state: PrSyncState::Open,
        });
    }
    let body = build_goal_pr_body(description);
    let mut pushed_branch = false;

    let setup_result = (|| -> Result<Option<String>> {
        ensure_goal_empty_commit(&workspace_dir, branch, &title, description)?;
        git_ops::run_git_with_timeout(
            [
                "-C",
                workspace_dir.to_str().unwrap_or(""),
                "push",
                "-u",
                remote,
                branch,
            ],
            None,
            git_ops::GIT_NETWORK_TIMEOUT,
        )?;
        pushed_branch = true;

        let pr_url =
            create_draft_change_request(&workspace_dir, &title, &body, branch, &refreshed)?;
        update_goal_pr_metadata(workspace_id, &title, pr_url.as_deref())?;
        Ok(pr_url)
    })();

    let pr_url = match setup_result {
        Ok(pr_url) => pr_url,
        Err(error) => {
            cleanup_failed_goal_workspace(
                workspace_id,
                &repo_root,
                &workspace_dir,
                branch,
                remote,
                pushed_branch,
            );
            return Err(error);
        }
    };

    Ok(FinalizeGoalWorkspaceResponse {
        workspace_id: workspace_id.to_string(),
        final_state: finalized.final_state,
        pr_title: title,
        pr_url,
        pr_sync_state: PrSyncState::Open,
    })
}

pub fn list_goal_cards(goal_workspace_id: &str) -> Result<Vec<GoalCard>> {
    goal_models::list_goal_cards(goal_workspace_id)
}

pub fn upsert_goal_card(input: UpsertGoalCardInput) -> Result<GoalCard> {
    goal_models::upsert_goal_card(input)
}

pub fn link_goal_card_workspace(goal_card_id: &str, workspace_id: &str) -> Result<GoalCard> {
    goal_models::link_goal_card_workspace(goal_card_id, workspace_id)
}

pub fn create_goal_child_workspace(
    request: GoalChildWorkspaceRequest,
) -> Result<super::lifecycle::PrepareWorkspaceResponse> {
    let goal = workspace_models::load_goal_workspace_record(&request.goal_workspace_id)?;
    if goal.state != WorkspaceState::Ready || goal.pr_sync_state != PrSyncState::Open {
        bail!(
            "Goal workspace {} is not ready for child workspaces",
            request.goal_workspace_id
        );
    }
    let repository = repos::load_repository_by_id(&goal.repo_id)?
        .with_context(|| format!("Repository not found: {}", goal.repo_id))?;
    let repo_root = PathBuf::from(repository.root_path.trim());
    let goal_branch = goal
        .branch
        .as_deref()
        .with_context(|| {
            format!(
                "Goal workspace {} is missing branch",
                request.goal_workspace_id
            )
        })?
        .to_string();
    let remote = repository
        .remote
        .clone()
        .unwrap_or_else(|| "origin".to_string());
    ensure_remote_goal_branch_exists(&repo_root, &remote, &goal_branch)?;
    let target_branch = request
        .target_branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(goal_branch.as_str())
        .to_string();
    let status = request.lane.unwrap_or(WorkspaceStatus::Backlog);
    let default_branch = repository
        .default_branch
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "main".to_string());
    let directory_name = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|title| allocate_goal_directory_name(&repository.id, title))
        .transpose()?
        .unwrap_or_else(|| {
            helpers::allocate_directory_name_for_repo(&repository.id)
                .unwrap_or_else(|_| "workspace".to_string())
        });
    let branch_settings = crate::repos::load_repo_branch_prefix_settings(&repository.id)?;
    let branch = helpers::next_available_branch_name(
        &repo_root,
        &helpers::branch_name_for_directory(&directory_name, &branch_settings),
    )?;
    let workspace_id = uuid::Uuid::new_v4().to_string();
    let session_id = uuid::Uuid::new_v4().to_string();
    let timestamp = db::current_timestamp()?;

    workspace_models::insert_initializing_workspace_and_session_with_metadata(
        &repository,
        &workspace_id,
        &session_id,
        &directory_name,
        &branch,
        workspace_models::InitializingWorkspaceMetadata {
            initialization_parent_branch: &target_branch,
            intended_target_branch: &target_branch,
            workspace_kind: WorkspaceKind::Code,
            goal_workspace_id: Some(&request.goal_workspace_id),
            status,
            pr_title: request.title.as_deref(),
            pr_sync_state: PrSyncState::None,
            pr_url: None,
            timestamp: &timestamp,
        },
    )?;

    if let Some(title) = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        crate::sessions::rename_session(&session_id, title)?;
    }

    if request
        .assigned_model_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || request
            .assigned_effort_level
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        update_initial_session_agent_settings(
            &session_id,
            request.assigned_model_id.as_deref(),
            request.assigned_effort_level.as_deref(),
        )?;
    }

    if let Some(card_id) = request.goal_card_id.as_deref() {
        let _ = goal_models::link_goal_card_workspace(card_id, &workspace_id)?;
    } else if request
        .description
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || request
            .assigned_provider
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        || request
            .assigned_model_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        || request
            .assigned_effort_level
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        let _ = goal_models::upsert_goal_card(goal_models::UpsertGoalCardInput {
            id: None,
            goal_workspace_id: request.goal_workspace_id.clone(),
            title: request
                .title
                .clone()
                .unwrap_or_else(|| directory_name.clone()),
            description: normalize_optional_string(request.description.clone()),
            lane: Some(status),
            sort_order: None,
            assigned_provider: normalize_optional_string(request.assigned_provider.clone()),
            assigned_model_id: normalize_optional_string(request.assigned_model_id.clone()),
            assigned_effort_level: normalize_optional_string(request.assigned_effort_level.clone()),
            child_workspace_id: Some(workspace_id.clone()),
        })?;
    }

    let repo_scripts = repos::load_repo_scripts(&repository.id, Some(&workspace_id)).unwrap_or(
        repos::RepoScripts {
            setup_script: None,
            run_script: None,
            archive_script: None,
            setup_from_project: false,
            run_from_project: false,
            archive_from_project: false,
            auto_run_setup: true,
        },
    );

    Ok(super::lifecycle::PrepareWorkspaceResponse {
        workspace_id,
        initial_session_id: session_id,
        repo_id: repository.id,
        repo_name: repository.name,
        directory_name,
        branch,
        default_branch,
        intended_target_branch: target_branch.clone(),
        status,
        source_start_branch: Some(target_branch),
        pr_number: None,
        pr_title: request.title,
        pr_sync_state: PrSyncState::None,
        pr_url: None,
        state: WorkspaceState::Initializing,
        repo_scripts,
    })
}

fn ensure_remote_goal_branch_exists(repo_root: &Path, remote: &str, branch: &str) -> Result<()> {
    git_ops::run_git_with_timeout(
        [
            "-C",
            repo_root.to_str().unwrap_or(""),
            "ls-remote",
            "--exit-code",
            "--heads",
            remote,
            branch,
        ],
        None,
        git_ops::GIT_NETWORK_TIMEOUT,
    )
    .map(|_| ())
    .with_context(|| {
        format!(
            "Goal branch {branch} is not available on remote {remote}; wait for Goal setup to finish"
        )
    })
}

fn cleanup_failed_goal_workspace(
    workspace_id: &str,
    repo_root: &Path,
    workspace_dir: &Path,
    branch: &str,
    remote: &str,
    pushed_branch: bool,
) {
    if pushed_branch {
        let _ = git_ops::run_git_with_timeout(
            [
                "-C",
                repo_root.to_str().unwrap_or(""),
                "push",
                remote,
                "--delete",
                branch,
            ],
            None,
            git_ops::GIT_NETWORK_TIMEOUT,
        );
    }
    let _ = git_ops::remove_worktree(repo_root, workspace_dir);
    let _ = fs::remove_dir_all(workspace_dir);
    let _ = git_ops::remove_branch(repo_root, branch);
    let _ = workspace_models::delete_workspace_and_session_rows(workspace_id);
}

pub fn set_goal_child_workspace_status(request: GoalChildWorkspaceStatusRequest) -> Result<()> {
    workspace_models::set_goal_child_workspace_status(
        &request.goal_workspace_id,
        &request.child_workspace_id,
        request.status,
    )
}

pub fn assign_workspace_to_goal(request: AssignWorkspaceToGoalRequest) -> Result<()> {
    workspace_models::assign_workspace_to_goal(
        &request.workspace_id,
        &request.goal_workspace_id,
        request.status,
    )
}

fn update_initial_session_agent_settings(
    session_id: &str,
    model_id: Option<&str>,
    effort_level: Option<&str>,
) -> Result<()> {
    let connection = db::write_conn()?;
    connection
        .execute(
            r#"
            UPDATE sessions SET
              model = COALESCE(?2, model),
              effort_level = COALESCE(?3, effort_level)
            WHERE id = ?1
            "#,
            rusqlite::params![
                session_id,
                model_id.map(str::trim).filter(|value| !value.is_empty()),
                effort_level
                    .map(str::trim)
                    .filter(|value| !value.is_empty()),
            ],
        )
        .context("Failed to update initial goal child session settings")?;
    Ok(())
}

fn update_goal_pr_metadata(workspace_id: &str, title: &str, pr_url: Option<&str>) -> Result<()> {
    let connection = db::write_conn()?;
    let updated = connection.execute(
        r#"
        UPDATE workspaces
        SET pr_title = ?2,
            pr_url = ?3,
            pr_sync_state = ?4,
            status = ?5,
            updated_at = datetime('now')
        WHERE id = ?1
        "#,
        (
            workspace_id,
            title,
            pr_url,
            PrSyncState::Open,
            WorkspaceStatus::Review,
        ),
    )?;
    if updated != 1 {
        bail!("Workspace not found: {workspace_id}");
    }
    Ok(())
}

fn ensure_goal_empty_commit(
    repo_root: &Path,
    branch: &str,
    title: &str,
    description: &str,
) -> Result<()> {
    let message = format!("goal: {title}\n\n{description}");
    git_ops::run_git(
        [
            "-C",
            repo_root.to_str().unwrap_or(""),
            "commit",
            "--allow-empty",
            "-m",
            &message,
        ],
        None,
    )
    .with_context(|| format!("Failed to create empty Goal commit on {branch}"))?;
    Ok(())
}

fn create_draft_change_request(
    repo_root: &Path,
    title: &str,
    body: &str,
    branch: &str,
    record: &crate::models::workspaces::WorkspaceRecord,
) -> Result<Option<String>> {
    match record.forge_provider.as_deref() {
        Some("gitlab") => create_gitlab_draft_mr(repo_root, title, body, branch, record),
        _ => create_github_draft_pr(repo_root, title, body, branch, record),
    }
}

fn create_github_draft_pr(
    repo_root: &Path,
    title: &str,
    body: &str,
    branch: &str,
    record: &crate::models::workspaces::WorkspaceRecord,
) -> Result<Option<String>> {
    let base = record
        .intended_target_branch
        .as_deref()
        .or(record.default_branch.as_deref())
        .unwrap_or("main");
    let output = std::process::Command::new("gh")
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
        .current_dir(repo_root)
        .output()
        .context("Failed to run gh pr create")?;
    parse_change_request_create_output(output)
}

fn create_gitlab_draft_mr(
    repo_root: &Path,
    title: &str,
    body: &str,
    branch: &str,
    record: &crate::models::workspaces::WorkspaceRecord,
) -> Result<Option<String>> {
    let target_branch = record
        .intended_target_branch
        .as_deref()
        .or(record.default_branch.as_deref())
        .unwrap_or("main");
    let output = std::process::Command::new("glab")
        .arg("mr")
        .arg("create")
        .arg("--draft")
        .arg("--title")
        .arg(title)
        .arg("--description")
        .arg(body)
        .arg("--source-branch")
        .arg(branch)
        .arg("--target-branch")
        .arg(target_branch)
        .current_dir(repo_root)
        .output()
        .context("Failed to run glab mr create")?;
    parse_change_request_create_output(output)
}

fn parse_change_request_create_output(output: std::process::Output) -> Result<Option<String>> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        bail!("Failed to create draft change request: {detail}");
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .split_whitespace()
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(|value| value.trim().to_string()))
}

fn build_goal_pr_body(description: &str) -> String {
    format!(
        "{description}\n\n<!-- HELMOR_GOAL_CHILD_WORKSPACES:START -->\n## Helmor child workspaces\n\n_No child workspaces yet._\n<!-- HELMOR_GOAL_CHILD_WORKSPACES:END -->\n"
    )
}

fn allocate_goal_directory_name(repo_id: &str, title: &str) -> Result<String> {
    let base = format!("goal-{}", slugify(title));
    let connection = db::read_conn()?;
    for suffix in 0..=999 {
        let candidate = if suffix == 0 {
            base.clone()
        } else {
            format!("{base}-{suffix}")
        };
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspaces WHERE repository_id = ?1 AND lower(directory_name) = lower(?2))",
            (repo_id, &candidate),
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(candidate);
        }
    }
    bail!("No available Goal directory name found for {title}")
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            previous_dash = false;
        } else if !previous_dash && !slug.is_empty() {
            slug.push('-');
            previous_dash = true;
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "goal".to_string()
    } else {
        trimmed
            .chars()
            .take(48)
            .collect::<String>()
            .trim_matches('-')
            .to_string()
    }
}

fn normalize_optional_str(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_source_branch(branch: &str) -> Result<String> {
    let branch = branch.trim();
    if branch.is_empty() {
        bail!("Branch name is required");
    }
    if branch == "HEAD" || branch.starts_with("refs/") {
        bail!("Unsupported branch name: {branch}");
    }
    Ok(branch.to_string())
}

fn ensure_source_branch_available(repo_root: &Path, branch: &str) -> Result<()> {
    if git_ops::verify_branch_exists(repo_root, branch).is_ok() {
        bail!("Local branch already exists: {branch}");
    }
    Ok(())
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
