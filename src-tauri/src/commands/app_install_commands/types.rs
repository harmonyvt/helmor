use serde::Serialize;

pub(super) const APP_INSTALL_REPO_ENV: &str = "HELMOR_APP_INSTALL_REPO";
pub(super) const DEFAULT_REPO_DIR: &str = "helmor";
pub(super) const INSTALLED_APP_PATH: &str = "/Applications/Helmor.app";
pub(super) const BUILT_APP_RELATIVE_PATH: &str = "src-tauri/target/release/bundle/macos/Helmor.app";
pub(super) const BUILT_APP_EXECUTABLE_RELATIVE_PATH: &str =
    "src-tauri/target/release/bundle/macos/Helmor.app/Contents/MacOS/helmor";
pub(super) const ENTITLEMENTS_RELATIVE_PATH: &str = "src-tauri/Entitlements.plist";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum InstallStepId {
    ResolveRepo,
    PullRepo,
    BuildApp,
    InspectBuiltApp,
    InstallApp,
    SignApp,
    VerifyApp,
    VerifyAppEntitlements,
    InspectInstalledApp,
    DataInfo,
}

impl InstallStepId {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::ResolveRepo => "resolveRepo",
            Self::PullRepo => "pullRepo",
            Self::BuildApp => "buildApp",
            Self::InspectBuiltApp => "inspectBuiltApp",
            Self::InstallApp => "installApp",
            Self::SignApp => "signApp",
            Self::VerifyApp => "verifyApp",
            Self::VerifyAppEntitlements => "verifyAppEntitlements",
            Self::InspectInstalledApp => "inspectInstalledApp",
            Self::DataInfo => "dataInfo",
        }
    }

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::ResolveRepo => "Finding Helmor checkout",
            Self::PullRepo => "Pulling latest changes",
            Self::BuildApp => "Building production app",
            Self::InspectBuiltApp => "Inspecting built bundle",
            Self::InstallApp => "Installing into Applications",
            Self::SignApp => "Ad-hoc signing installed app",
            Self::VerifyApp => "Verifying installed app",
            Self::VerifyAppEntitlements => "Verifying app entitlements",
            Self::InspectInstalledApp => "Reading installed app details",
            Self::DataInfo => "Checking installed app data mode",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmorAppInstallResult {
    pub repo_root: String,
    pub installed_app_path: String,
    pub restart_required: bool,
    pub pull_stdout: String,
    pub pull_stderr: String,
    pub stdout: String,
    pub stderr: String,
    pub version: Option<String>,
    pub bundle_id: Option<String>,
    pub size: Option<String>,
    pub signing_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AppInstallEvent {
    Started {
        repo_root: String,
        installed_app_path: String,
    },
    StepStarted {
        step_id: String,
        label: String,
    },
    Output {
        step_id: String,
        stream: AppInstallOutputStream,
        data: String,
    },
    StepFinished {
        step_id: String,
        status: AppInstallStepStatus,
        message: Option<String>,
    },
    Completed {
        result: HelmorAppInstallResult,
    },
    Error {
        step_id: Option<String>,
        message: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppInstallOutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppInstallStepStatus {
    Ok,
    Warning,
    Skipped,
}
