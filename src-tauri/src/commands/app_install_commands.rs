mod bundle;
mod manager;
mod runner;
mod steps;
#[cfg(test)]
mod tests;
mod types;

use std::path::{Path, PathBuf};

use super::common::{run_blocking, CmdResult};
use anyhow::{bail, Context};
use tauri::{ipc::Channel, State};

pub use manager::AppInstallManager;
pub use types::{AppInstallEvent, HelmorAppInstallResult};

use bundle::{inspect_bundle, unix_seconds_now, validate_build_result};
use runner::{command_spec, finish_step, run_checked_command, run_command, start_step};
use steps::{run_data_info_if_available, verify_installed_app};
use types::{
    AppInstallStepStatus, InstallStepId, APP_INSTALL_REPO_ENV, BUILT_APP_EXECUTABLE_RELATIVE_PATH,
    BUILT_APP_RELATIVE_PATH, DEFAULT_REPO_DIR, ENTITLEMENTS_RELATIVE_PATH, INSTALLED_APP_PATH,
};

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
