use std::path::Path;
use std::sync::Arc;

use tauri::ipc::Channel;

use super::manager::AppInstallRunState;
use super::runner::{command_spec, finish_step, run_checked_command, run_command, start_step};
use super::types::{AppInstallEvent, AppInstallStepStatus, InstallStepId, INSTALLED_APP_PATH};

pub(super) fn verify_installed_app(
    state: &Arc<AppInstallRunState>,
    channel: &Channel<AppInstallEvent>,
    repo_root: &Path,
) -> anyhow::Result<()> {
    run_checked_command(
        state,
        channel,
        InstallStepId::VerifyApp,
        command_spec(
            "codesign",
            [
                "--verify".as_ref(),
                "--deep".as_ref(),
                "--strict".as_ref(),
                "--verbose=2".as_ref(),
                Path::new(INSTALLED_APP_PATH).as_os_str(),
            ],
            repo_root,
        ),
    )?;
    run_checked_command(
        state,
        channel,
        InstallStepId::VerifyApp,
        command_spec(
            "codesign",
            [
                "-d".as_ref(),
                "--entitlements".as_ref(),
                ":-".as_ref(),
                Path::new(INSTALLED_APP_PATH).as_os_str(),
            ],
            repo_root,
        ),
    )?;
    Ok(())
}

pub(super) fn run_data_info_if_available(
    state: &Arc<AppInstallRunState>,
    channel: &Channel<AppInstallEvent>,
) -> anyhow::Result<()> {
    let cli_path = Path::new(INSTALLED_APP_PATH).join("Contents/MacOS/helmor-cli");
    if !cli_path.is_file() {
        start_step(channel, InstallStepId::DataInfo);
        finish_step(
            channel,
            InstallStepId::DataInfo,
            AppInstallStepStatus::Skipped,
            Some("Installed app does not include helmor-cli".to_string()),
        );
        return Ok(());
    }

    let capture = run_command(
        state,
        channel,
        InstallStepId::DataInfo,
        command_spec(
            cli_path.to_string_lossy().as_ref(),
            ["data", "info", "--json"],
            Path::new(INSTALLED_APP_PATH),
        ),
    )?;
    finish_step(
        channel,
        InstallStepId::DataInfo,
        if capture.success {
            AppInstallStepStatus::Ok
        } else {
            AppInstallStepStatus::Warning
        },
        if capture.success {
            None
        } else {
            Some("Unable to read installed app data mode".to_string())
        },
    );
    Ok(())
}
