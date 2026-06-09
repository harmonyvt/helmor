use std::{
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    data_dir,
    error::{coded, ErrorCode},
    models::workspaces as workspace_models,
};

use super::common::{run_blocking, CmdResult};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransferWorkspaceToOrcaStatus {
    AlreadyTracked,
    Adopted,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferWorkspaceToOrcaResponse {
    pub workspace_id: String,
    pub repo_path: String,
    pub workspace_path: String,
    pub orca_repo_id: Option<String>,
    pub orca_worktree_id: Option<String>,
    pub status: TransferWorkspaceToOrcaStatus,
}

#[tauri::command]
pub async fn transfer_workspace_to_orca(
    workspace_id: String,
) -> CmdResult<TransferWorkspaceToOrcaResponse> {
    run_blocking(move || transfer_workspace_to_orca_impl(&workspace_id)).await
}

fn transfer_workspace_to_orca_impl(workspace_id: &str) -> Result<TransferWorkspaceToOrcaResponse> {
    transfer_workspace_to_orca_with_runner(workspace_id, &SystemOrcaRunner)
}

fn transfer_workspace_to_orca_with_runner(
    workspace_id: &str,
    runner: &dyn OrcaRunner,
) -> Result<TransferWorkspaceToOrcaResponse> {
    let record = workspace_models::load_workspace_record_by_id(workspace_id)?
        .ok_or_else(|| coded(ErrorCode::WorkspaceNotFound).context("Workspace not found"))?;
    let repo_path = record
        .root_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .context("Workspace repository path is missing")?;
    let workspace_path = data_dir::workspace_dir(&record.repo_name, &record.directory_name)?;

    ensure_directory_exists("repository", &repo_path)?;
    ensure_directory_exists("workspace", &workspace_path)?;

    let repo_selector = path_selector(&repo_path);
    let workspace_selector = path_selector(&workspace_path);
    let (orca_repo_id, created_repo) = ensure_orca_repo(runner, &repo_selector, &repo_path)?;
    let worktree = show_orca_worktree(runner, &workspace_selector).with_context(|| {
		format!(
			"Orca did not discover the external worktree at {}. Make sure Orca is running and supports external git worktrees for this repository.",
			workspace_path.display()
		)
	})?;

    Ok(TransferWorkspaceToOrcaResponse {
        workspace_id: workspace_id.to_string(),
        repo_path: repo_path.display().to_string(),
        workspace_path: workspace_path.display().to_string(),
        orca_repo_id,
        orca_worktree_id: worktree.id,
        status: if created_repo {
            TransferWorkspaceToOrcaStatus::Adopted
        } else {
            TransferWorkspaceToOrcaStatus::AlreadyTracked
        },
    })
}

fn ensure_directory_exists(label: &str, path: &Path) -> Result<()> {
    if path.is_dir() {
        return Ok(());
    }

    bail!("Helmor {label} path does not exist: {}", path.display());
}

fn path_selector(path: &Path) -> String {
    format!("path:{}", path.display())
}

fn ensure_orca_repo(
    runner: &dyn OrcaRunner,
    repo_selector: &str,
    repo_path: &Path,
) -> Result<(Option<String>, bool)> {
    match run_orca_json(runner, &["repo", "show", "--repo", repo_selector, "--json"])? {
        OrcaJson::Success(value) => return Ok((extract_repo_id(&value), false)),
        OrcaJson::Error(error) if error.code.as_deref() == Some("selector_not_found") => {}
        OrcaJson::Error(error) => bail!(error.message_or("Orca failed to show repository")),
    }

    match run_orca_json(
        runner,
        &[
            "repo",
            "add",
            "--path",
            &repo_path.display().to_string(),
            "--json",
        ],
    )? {
        OrcaJson::Success(value) => Ok((extract_repo_id(&value), true)),
        OrcaJson::Error(error) => bail!(error.message_or("Orca failed to add repository")),
    }
}

fn show_orca_worktree(runner: &dyn OrcaRunner, workspace_selector: &str) -> Result<OrcaWorktree> {
    match run_orca_json(
        runner,
        &[
            "worktree",
            "show",
            "--worktree",
            workspace_selector,
            "--json",
        ],
    )? {
        OrcaJson::Success(value) => parse_worktree(&value),
        OrcaJson::Error(error) if error.code.as_deref() == Some("selector_not_found") => {
            bail!(error.message_or("Orca worktree selector was not found"))
        }
        OrcaJson::Error(error) => bail!(error.message_or("Orca failed to show worktree")),
    }
}

trait OrcaRunner: Sync {
    fn run(&self, args: &[&str]) -> Result<OrcaCommandOutput>;
}

struct SystemOrcaRunner;

impl OrcaRunner for SystemOrcaRunner {
    fn run(&self, args: &[&str]) -> Result<OrcaCommandOutput> {
        let output = Command::new("orca")
            .args(args)
            .output()
            .context("Unable to run Orca CLI. Install Orca and make sure `orca` is on PATH.")?;

        Ok(OrcaCommandOutput {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

#[derive(Debug, Clone)]
struct OrcaCommandOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

enum OrcaJson {
    Success(Value),
    Error(OrcaError),
}

#[derive(Debug, Deserialize)]
struct OrcaError {
    code: Option<String>,
    message: Option<String>,
}

impl OrcaError {
    fn message_or(self, fallback: &str) -> String {
        self.message.unwrap_or_else(|| fallback.to_string())
    }
}

fn run_orca_json(runner: &dyn OrcaRunner, args: &[&str]) -> Result<OrcaJson> {
    let output = runner.run(args)?;
    let parsed = serde_json::from_str::<Value>(&output.stdout);

    if let Ok(value) = parsed {
        if value.get("ok").and_then(Value::as_bool) == Some(false) {
            let error = value
                .get("error")
                .cloned()
                .map(serde_json::from_value::<OrcaError>)
                .transpose()
                .context("Failed to parse Orca error response")?
                .unwrap_or(OrcaError {
                    code: None,
                    message: None,
                });
            return Ok(OrcaJson::Error(error));
        }

        return Ok(OrcaJson::Success(
            value.get("result").cloned().unwrap_or(value),
        ));
    }

    let stderr = output.stderr.trim();
    let stdout = output.stdout.trim();
    if output.success {
        bail!("Orca CLI returned invalid JSON");
    }

    if stderr.is_empty() && stdout.is_empty() {
        bail!("Orca CLI failed without output");
    }

    if stderr.is_empty() {
        bail!("Orca CLI failed: {stdout}");
    }

    bail!("Orca CLI failed: {stderr}");
}

fn extract_repo_id(value: &Value) -> Option<String> {
    let repo = value.get("repo").unwrap_or(value);
    repo.get("id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

#[derive(Debug, Clone)]
struct OrcaWorktree {
    id: Option<String>,
}

fn parse_worktree(value: &Value) -> Result<OrcaWorktree> {
    let worktree = value.get("worktree").unwrap_or(value);
    Ok(OrcaWorktree {
        id: worktree
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
}

#[cfg(test)]
mod tests;
