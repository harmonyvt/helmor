mod bundle;
mod manager;
mod runner;
mod steps;
#[cfg(test)]
mod tests;
mod types;

use std::path::{Path, PathBuf};
use std::process::Command;

use super::common::{run_blocking, CmdResult};
use anyhow::{bail, Context};
use tauri::{ipc::Channel, State};

pub use manager::AppInstallManager;
pub use types::{AppInstallEvent, HelmorAppInstallResult, HelmorAppUpdateStatus};

use bundle::{inspect_bundle, unix_seconds_now, validate_build_result};
use runner::{command_spec, finish_step, run_checked_command, run_command, start_step};
use steps::{run_data_info_if_available, verify_installed_app};
use types::{
    AppInstallStepStatus, InstallStepId, APP_INSTALL_REPO_ENV, BUILT_APP_EXECUTABLE_RELATIVE_PATH,
    BUILT_APP_RELATIVE_PATH, DEFAULT_REPO_DIR, ENTITLEMENTS_RELATIVE_PATH, INSTALLED_APP_PATH,
};

#[tauri::command]
pub async fn get_helmor_app_update_status() -> CmdResult<HelmorAppUpdateStatus> {
    run_blocking(check_helmor_app_update_status).await
}

#[tauri::command]
pub async fn run_helmor_app_install(
    manager: State<'_, AppInstallManager>,
    channel: Channel<AppInstallEvent>,
) -> CmdResult<HelmorAppInstallResult> {
    let state = manager.begin()?;
    let run_state = state.clone();
    let run_channel = channel.clone();
    let result = run_blocking(move || {
        let result = run_helmor_app_install_impl(run_state, run_channel.clone());
        if let Err(error) = &result {
            let _ = run_channel.send(AppInstallEvent::Error {
                step_id: None,
                message: error.to_string(),
            });
        }
        result
    })
    .await;
    manager.finish(&state);
    result
}

#[tauri::command]
pub async fn cancel_helmor_app_install(manager: State<'_, AppInstallManager>) -> CmdResult<bool> {
    Ok(manager.cancel())
}

fn run_helmor_app_install_impl(
    state: std::sync::Arc<manager::AppInstallRunState>,
    channel: Channel<AppInstallEvent>,
) -> anyhow::Result<HelmorAppInstallResult> {
    let repo_root = resolve_repo_root_with_events(&channel)?;
    let built_app = repo_root.join(BUILT_APP_RELATIVE_PATH);
    let built_executable = repo_root.join(BUILT_APP_EXECUTABLE_RELATIVE_PATH);
    let entitlements = repo_root.join(ENTITLEMENTS_RELATIVE_PATH);

    let _ = channel.send(AppInstallEvent::Started {
        repo_root: repo_root.display().to_string(),
        installed_app_path: INSTALLED_APP_PATH.to_string(),
    });

    let pull = run_checked_command(
        &state,
        &channel,
        InstallStepId::PullRepo,
        command_spec("git", ["pull", "--ff-only", "--autostash"], &repo_root),
    )?;

    let build_started_at = unix_seconds_now();
    let build = run_command(
        &state,
        &channel,
        InstallStepId::BuildApp,
        command_spec(
            "bun",
            ["run", "tauri", "build", "--bundles", "app"],
            &repo_root,
        ),
    )?;

    let signing_warning =
        validate_build_result(&build, &built_app, &built_executable, build_started_at)
            .with_context(|| format!("Failed to build Helmor app at {}", built_app.display()))?;
    finish_step(
        &channel,
        InstallStepId::BuildApp,
        if signing_warning.is_some() {
            AppInstallStepStatus::Warning
        } else {
            AppInstallStepStatus::Ok
        },
        signing_warning.clone(),
    );

    let built_metadata =
        inspect_bundle(&state, &channel, InstallStepId::InspectBuiltApp, &built_app)?;

    run_checked_command(
        &state,
        &channel,
        InstallStepId::InstallApp,
        command_spec(
            "ditto",
            [
                built_app.as_os_str(),
                Path::new(INSTALLED_APP_PATH).as_os_str(),
            ],
            &repo_root,
        ),
    )?;

    run_checked_command(
        &state,
        &channel,
        InstallStepId::SignApp,
        command_spec(
            "codesign",
            [
                "--force".as_ref(),
                "--deep".as_ref(),
                "--options".as_ref(),
                "runtime".as_ref(),
                "--entitlements".as_ref(),
                entitlements.as_os_str(),
                "--sign".as_ref(),
                "-".as_ref(),
                Path::new(INSTALLED_APP_PATH).as_os_str(),
            ],
            &repo_root,
        ),
    )?;

    verify_installed_app(&state, &channel, &repo_root)?;

    let installed_metadata = inspect_bundle(
        &state,
        &channel,
        InstallStepId::InspectInstalledApp,
        Path::new(INSTALLED_APP_PATH),
    )?;

    run_data_info_if_available(&state, &channel)?;

    let mut stdout = String::new();
    stdout.push_str(&pull.stdout);
    stdout.push_str(&build.stdout);
    stdout.push_str(&built_metadata.stdout);
    stdout.push_str(&installed_metadata.stdout);

    let mut stderr = String::new();
    stderr.push_str(&pull.stderr);
    stderr.push_str(&build.stderr);
    stderr.push_str(&built_metadata.stderr);
    stderr.push_str(&installed_metadata.stderr);

    let result = HelmorAppInstallResult {
        repo_root: repo_root.display().to_string(),
        installed_app_path: INSTALLED_APP_PATH.to_string(),
        restart_required: true,
        pull_stdout: pull.stdout,
        pull_stderr: pull.stderr,
        stdout,
        stderr,
        version: installed_metadata.version.or(built_metadata.version),
        bundle_id: installed_metadata.bundle_id.or(built_metadata.bundle_id),
        size: installed_metadata.size.or(built_metadata.size),
        signing_warning,
    };

    let _ = channel.send(AppInstallEvent::Completed {
        result: result.clone(),
    });
    Ok(result)
}

fn check_helmor_app_update_status() -> anyhow::Result<HelmorAppUpdateStatus> {
    let checked_at = unix_seconds_now();
    match resolve_repo_root() {
        Ok(repo_root) => Ok(check_repo_update_status(&repo_root, checked_at)),
        Err(error) => Ok(HelmorAppUpdateStatus {
            repo_root: None,
            installed_app_path: INSTALLED_APP_PATH.to_string(),
            update_available: false,
            behind_count: 0,
            upstream: None,
            head: None,
            checked_at,
            error: Some(error.to_string()),
        }),
    }
}

fn check_repo_update_status(repo_root: &Path, checked_at: u64) -> HelmorAppUpdateStatus {
    let head = git_stdout(repo_root, ["rev-parse", "--short", "HEAD"])
        .ok()
        .and_then(non_empty_trimmed);
    let upstream = match git_stdout(
        repo_root,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    ) {
        Ok(stdout) => non_empty_trimmed(stdout),
        Err(error) => {
            return app_update_status_error(repo_root, checked_at, head, error.to_string());
        }
    };

    if let Err(error) = fetch_current_upstream(repo_root) {
        return app_update_status_error(repo_root, checked_at, head, error.to_string());
    }

    match git_stdout(repo_root, ["rev-list", "--count", "HEAD..@{u}"]) {
        Ok(stdout) => {
            let behind_count = parse_git_count(&stdout).unwrap_or(0);
            HelmorAppUpdateStatus {
                repo_root: Some(repo_root.display().to_string()),
                installed_app_path: INSTALLED_APP_PATH.to_string(),
                update_available: behind_count > 0,
                behind_count,
                upstream,
                head,
                checked_at,
                error: None,
            }
        }
        Err(error) => app_update_status_error(repo_root, checked_at, head, error.to_string()),
    }
}

fn fetch_current_upstream(repo_root: &Path) -> anyhow::Result<()> {
    let branch = git_stdout(repo_root, ["rev-parse", "--abbrev-ref", "HEAD"])
        .map(non_empty_trimmed)
        .ok()
        .flatten()
        .context("Unable to determine current branch for Helmor update check")?;
    let remote_key = format!("branch.{branch}.remote");
    let remote = git_stdout(repo_root, ["config", "--get", remote_key.as_str()])
        .map(non_empty_trimmed)
        .ok()
        .flatten()
        .context("Current Helmor branch has no configured upstream remote")?;
    git_success(repo_root, ["fetch", "--quiet", "--prune", remote.as_str()])
        .with_context(|| format!("Failed to fetch Helmor updates from {remote}"))
}

fn app_update_status_error(
    repo_root: &Path,
    checked_at: u64,
    head: Option<String>,
    error: String,
) -> HelmorAppUpdateStatus {
    HelmorAppUpdateStatus {
        repo_root: Some(repo_root.display().to_string()),
        installed_app_path: INSTALLED_APP_PATH.to_string(),
        update_available: false,
        behind_count: 0,
        upstream: None,
        head,
        checked_at,
        error: Some(error),
    }
}

fn git_stdout<const N: usize>(repo_root: &Path, args: [&str; N]) -> anyhow::Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .context("Failed to run git for Helmor update check")?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "{}",
            if stderr.trim().is_empty() {
                "Git update check failed".to_string()
            } else {
                stderr.trim().to_string()
            }
        );
    }
}

fn git_success<const N: usize>(repo_root: &Path, args: [&str; N]) -> anyhow::Result<()> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .context("Failed to run git for Helmor update check")?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "{}",
            if stderr.trim().is_empty() {
                "Git update check failed".to_string()
            } else {
                stderr.trim().to_string()
            }
        );
    }
}

fn non_empty_trimmed(value: String) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn parse_git_count(stdout: &str) -> Option<u32> {
    stdout.trim().parse().ok()
}

fn resolve_repo_root_with_events(channel: &Channel<AppInstallEvent>) -> anyhow::Result<PathBuf> {
    start_step(channel, InstallStepId::ResolveRepo);
    match resolve_repo_root() {
        Ok(repo_root) => {
            finish_step(
                channel,
                InstallStepId::ResolveRepo,
                AppInstallStepStatus::Ok,
                Some(repo_root.display().to_string()),
            );
            Ok(repo_root)
        }
        Err(error) => {
            let _ = channel.send(AppInstallEvent::Error {
                step_id: Some(InstallStepId::ResolveRepo.as_str().to_string()),
                message: error.to_string(),
            });
            Err(error)
        }
    }
}

fn resolve_repo_root() -> anyhow::Result<PathBuf> {
    if let Some(repo_root) = std::env::var_os(APP_INSTALL_REPO_ENV).map(PathBuf::from) {
        return validate_repo_root(repo_root).with_context(|| {
            format!(
                "{} does not point at a Helmor checkout",
                APP_INSTALL_REPO_ENV
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

    bail!(
        "Unable to find a Helmor checkout. Expected ~/{} or set {} to the checkout path.",
        DEFAULT_REPO_DIR,
        APP_INSTALL_REPO_ENV
    )
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
        bail!("{} is not a Helmor repo root", canonical.display())
    }
}

fn find_repo_root_from(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|candidate| is_helmor_repo_root(candidate))
        .map(Path::to_path_buf)
}

fn is_helmor_repo_root(path: &Path) -> bool {
    path.join("package.json").is_file() && path.join("src-tauri/tauri.conf.json").is_file()
}
