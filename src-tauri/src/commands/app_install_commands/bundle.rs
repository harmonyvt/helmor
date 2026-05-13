use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::bail;
use tauri::ipc::Channel;

use super::manager::AppInstallRunState;
use super::runner::{command_failure_message, command_spec, run_checked_command, CommandCapture};
use super::types::{AppInstallEvent, InstallStepId};

#[derive(Default)]
pub(super) struct BundleMetadata {
    pub(super) stdout: String,
    pub(super) stderr: String,
    pub(super) version: Option<String>,
    pub(super) bundle_id: Option<String>,
    pub(super) size: Option<String>,
}

pub(super) fn inspect_bundle(
    state: &Arc<AppInstallRunState>,
    channel: &Channel<AppInstallEvent>,
    step: InstallStepId,
    app_path: &Path,
) -> anyhow::Result<BundleMetadata> {
    let info_path = app_path.join("Contents/Info");
    let parent = app_path.parent().unwrap_or_else(|| Path::new("/"));

    let version = run_checked_command(
        state,
        channel,
        step,
        command_spec(
            "defaults",
            [
                "read".as_ref(),
                info_path.as_os_str(),
                "CFBundleShortVersionString".as_ref(),
            ],
            parent,
        ),
    )?;
    let bundle_id = run_checked_command(
        state,
        channel,
        step,
        command_spec(
            "defaults",
            [
                "read".as_ref(),
                info_path.as_os_str(),
                "CFBundleIdentifier".as_ref(),
            ],
            parent,
        ),
    )?;
    let size = run_checked_command(
        state,
        channel,
        step,
        command_spec("du", ["-sh".as_ref(), app_path.as_os_str()], parent),
    )?;

    Ok(BundleMetadata {
        stdout: format!("{}{}{}", version.stdout, bundle_id.stdout, size.stdout),
        stderr: format!("{}{}{}", version.stderr, bundle_id.stderr, size.stderr),
        version: first_non_empty_line(&version.stdout),
        bundle_id: first_non_empty_line(&bundle_id.stdout),
        size: first_non_empty_line(&size.stdout)
            .map(|line| line.split_whitespace().next().unwrap_or(&line).to_string()),
    })
}

pub(super) fn validate_build_result(
    capture: &CommandCapture,
    built_app: &Path,
    built_executable: &Path,
    build_started_at: u64,
) -> anyhow::Result<Option<String>> {
    if !built_app.is_dir() || !built_executable.is_file() {
        bail!(command_failure_message(InstallStepId::BuildApp, capture));
    }

    if capture.success {
        return Ok(None);
    }

    let app_mtime = built_app
        .metadata()
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(unix_seconds_from_system_time)
        .unwrap_or(0);
    if app_mtime < build_started_at {
        bail!(command_failure_message(InstallStepId::BuildApp, capture));
    }

    Ok(Some(
        "Build produced the app bundle, but updater signing appears unavailable. Continuing with local app install.".to_string(),
    ))
}

pub(super) fn unix_seconds_now() -> u64 {
    unix_seconds_from_system_time(SystemTime::now()).unwrap_or(0)
}

fn first_non_empty_line(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn unix_seconds_from_system_time(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}
