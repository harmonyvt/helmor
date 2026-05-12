use std::path::{Path, PathBuf};
use std::process::Command;

use super::common::{run_blocking, CmdResult};
use anyhow::Context;
use serde::Serialize;

const APP_INSTALL_REPO_ENV: &str = "HELMOR_APP_INSTALL_REPO";
const APP_INSTALL_FORCE_ENV: &str = "HELMOR_INSTALL_FORCE";
const APP_INSTALL_SCRIPT: &str = ".codex/skills/helmor-app-install/scripts/install_app.sh";
const DEFAULT_REPO_DIR: &str = "helmor";
const INSTALLED_APP_PATH: &str = "/Applications/Helmor.app";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmorAppInstallResult {
    pub repo_root: String,
    pub script_path: String,
    pub installed_app_path: String,
    pub restart_required: bool,
    pub pull_stdout: String,
    pub pull_stderr: String,
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command]
pub async fn run_helmor_app_install() -> CmdResult<HelmorAppInstallResult> {
    run_blocking(run_helmor_app_install_impl).await
}

fn run_helmor_app_install_impl() -> anyhow::Result<HelmorAppInstallResult> {
    let repo_root = resolve_repo_root()?;
    let (pull_stdout, pull_stderr) = pull_repo(&repo_root)?;
    let script_path = repo_root.join(APP_INSTALL_SCRIPT);

    let output = Command::new("/bin/bash")
        .arg(&script_path)
        .arg(&repo_root)
        .env(APP_INSTALL_FORCE_ENV, "1")
        .output()
        .with_context(|| {
            format!(
                "Failed to start Helmor app installer at {}",
                script_path.display()
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        anyhow::bail!(
            "Helmor app install failed with status {}.\n\nstdout:\n{}\n\nstderr:\n{}",
            output
                .status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "terminated by signal".to_string()),
            stdout.trim(),
            stderr.trim()
        );
    }

    Ok(HelmorAppInstallResult {
        repo_root: repo_root.display().to_string(),
        script_path: script_path.display().to_string(),
        installed_app_path: INSTALLED_APP_PATH.to_string(),
        restart_required: true,
        pull_stdout,
        pull_stderr,
        stdout,
        stderr,
    })
}

fn resolve_repo_root() -> anyhow::Result<PathBuf> {
    if let Some(repo_root) = std::env::var_os(APP_INSTALL_REPO_ENV).map(PathBuf::from) {
        return validate_repo_root(repo_root).with_context(|| {
            format!(
                "{} does not point at a Helmor checkout with {}",
                APP_INSTALL_REPO_ENV, APP_INSTALL_SCRIPT
            )
        });
    }

    let mut candidates = Vec::new();
    candidates.extend(default_repo_root_candidate());
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir);
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for candidate in candidates {
        if let Some(repo_root) = find_repo_root_from(&candidate) {
            return Ok(repo_root);
        }
    }

    anyhow::bail!(
        "Unable to find {}. Expected ~/{} to be a Helmor checkout, or set {} to the checkout path.",
        APP_INSTALL_SCRIPT,
        DEFAULT_REPO_DIR,
        APP_INSTALL_REPO_ENV
    )
}

fn pull_repo(repo_root: &Path) -> anyhow::Result<(String, String)> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["pull", "--ff-only", "--autostash"])
        .output()
        .with_context(|| format!("Failed to start git pull in {}", repo_root.display()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        anyhow::bail!(
            "Failed to pull {} before installing Helmor.\n\nstdout:\n{}\n\nstderr:\n{}",
            repo_root.display(),
            stdout.trim(),
            stderr.trim()
        );
    }

    Ok((stdout, stderr))
}

fn default_repo_root_candidate() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(DEFAULT_REPO_DIR))
}

fn validate_repo_root(path: PathBuf) -> anyhow::Result<PathBuf> {
    let canonical = path
        .canonicalize()
        .with_context(|| format!("Failed to resolve repo root {}", path.display()))?;
    if is_helmor_repo_root(&canonical) {
        Ok(canonical)
    } else {
        anyhow::bail!("{} is not a Helmor repo root", canonical.display())
    }
}

fn find_repo_root_from(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|candidate| is_helmor_repo_root(candidate))
        .map(Path::to_path_buf)
}

fn is_helmor_repo_root(path: &Path) -> bool {
    path.join("package.json").is_file()
        && path.join("src-tauri/tauri.conf.json").is_file()
        && path.join(APP_INSTALL_SCRIPT).is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_repo_root_from_nested_path() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo");
        std::fs::create_dir_all(root.join("src-tauri/target/debug")).unwrap();
        std::fs::create_dir_all(root.join(".codex/skills/helmor-app-install/scripts")).unwrap();
        std::fs::write(root.join("package.json"), "{}").unwrap();
        std::fs::write(root.join("src-tauri/tauri.conf.json"), "{}").unwrap();
        std::fs::write(root.join(APP_INSTALL_SCRIPT), "#!/usr/bin/env bash\n").unwrap();

        let nested = root.join("src-tauri/target/debug");
        assert_eq!(
            find_repo_root_from(&nested).as_deref(),
            Some(root.as_path())
        );
    }

    #[test]
    fn rejects_directory_without_installer_skill() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("package.json"), "{}").unwrap();
        std::fs::create_dir_all(temp.path().join("src-tauri")).unwrap();
        std::fs::write(temp.path().join("src-tauri/tauri.conf.json"), "{}").unwrap();

        assert!(!is_helmor_repo_root(temp.path()));
    }
}
