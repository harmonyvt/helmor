//! Bridge from a workspace ID to the shape every GitLab call needs:
//! the parsed remote, the `namespace/repo` path string, the current
//! branch, and whether the branch is actually published to the remote.

use anyhow::{bail, Context, Result};

use crate::forge::remote::{parse_remote, ParsedRemote};
use crate::models::workspaces::{self as workspace_models, WorkspaceRecord};
use crate::{git_ops, workspace_state::WorkspaceState};

pub(super) struct GitlabContext {
    pub(super) remote: ParsedRemote,
    pub(super) full_path: String,
    pub(super) branch: String,
    pub(super) published: bool,
}

pub(super) fn load_gitlab_context(workspace_id: &str) -> Result<GitlabContext> {
    let Some(record) = workspace_models::load_workspace_record_by_id(workspace_id)? else {
        bail!("Workspace not found: {workspace_id}");
    };
    if record.state == WorkspaceState::Initializing {
        bail!("Workspace is still initializing");
    }
    let published = workspace_branch_has_remote_tracking(&record);

    let remote_url = record
        .remote_url
        .as_deref()
        .context("Workspace has no remote")?;
    let remote = parse_remote(remote_url).context("Workspace remote is not a GitLab repository")?;
    let branch = record
        .branch
        .as_deref()
        .filter(|value| !value.is_empty())
        .context("Workspace has no current branch")?
        .to_string();
    let full_path = format!("{}/{}", remote.namespace, remote.repo);

    Ok(GitlabContext {
        remote,
        full_path,
        branch,
        published,
    })
}

fn workspace_branch_has_remote_tracking(record: &WorkspaceRecord) -> bool {
    let Ok(workspace_dir) =
        crate::data_dir::workspace_dir(&record.repo_name, &record.directory_name)
    else {
        return false;
    };
    if !workspace_dir.exists() {
        return false;
    }
    git_ops::resolve_remote_tracking_ref(&workspace_dir, record.remote.as_deref()).is_some()
}
