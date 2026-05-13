use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;

use anyhow::{bail, Context};
use tauri::ipc::Channel;

use super::manager::AppInstallRunState;
use super::types::{AppInstallEvent, AppInstallOutputStream, AppInstallStepStatus, InstallStepId};

#[derive(Default)]
pub(super) struct CommandCapture {
    pub(super) stdout: String,
    pub(super) stderr: String,
    pub(super) status_code: Option<i32>,
    pub(super) success: bool,
}

#[derive(Debug)]
pub(super) struct CommandSpec {
    program: String,
    args: Vec<std::ffi::OsString>,
    current_dir: PathBuf,
}

pub(super) fn command_spec<I, S>(program: &str, args: I, current_dir: &Path) -> CommandSpec
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    CommandSpec {
        program: program.to_string(),
        args: args
            .into_iter()
            .map(|arg| arg.as_ref().to_os_string())
            .collect(),
        current_dir: current_dir.to_path_buf(),
    }
}

pub(super) fn run_checked_command(
    state: &Arc<AppInstallRunState>,
    channel: &Channel<AppInstallEvent>,
    step: InstallStepId,
    spec: CommandSpec,
) -> anyhow::Result<CommandCapture> {
    let capture = run_command(state, channel, step, spec)?;
    if !capture.success {
        let message = command_failure_message(step, &capture);
        let _ = channel.send(AppInstallEvent::Error {
            step_id: Some(step.as_str().to_string()),
            message: message.clone(),
        });
        bail!(message);
    }
    finish_step(channel, step, AppInstallStepStatus::Ok, None);
    Ok(capture)
}

pub(super) fn run_command(
    state: &Arc<AppInstallRunState>,
    channel: &Channel<AppInstallEvent>,
    step: InstallStepId,
    spec: CommandSpec,
) -> anyhow::Result<CommandCapture> {
    state.check_cancelled()?;
    start_step(channel, step);

    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    command.current_dir(&spec.current_dir);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    use std::os::unix::process::CommandExt;
    command.process_group(0);

    let mut child = command.spawn().with_context(|| {
        format!(
            "Failed to start {} while {}",
            spec.program,
            step.label().to_lowercase()
        )
    })?;
    state.set_child_pid(Some(child.id()));

    let stdout = child
        .stdout
        .take()
        .context("Failed to capture child stdout")?;
    let stderr = child
        .stderr
        .take()
        .context("Failed to capture child stderr")?;
    let stdout_reader = spawn_reader(
        stdout,
        channel.clone(),
        step.as_str().to_string(),
        AppInstallOutputStream::Stdout,
    );
    let stderr_reader = spawn_reader(
        stderr,
        channel.clone(),
        step.as_str().to_string(),
        AppInstallOutputStream::Stderr,
    );

    let status = child
        .wait()
        .context("Failed to wait for installer command")?;
    state.set_child_pid(None);

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();

    if state.check_cancelled().is_err() {
        finish_step(
            channel,
            step,
            AppInstallStepStatus::Skipped,
            Some("Cancelled".to_string()),
        );
        bail!("Helmor update cancelled");
    }

    Ok(CommandCapture {
        stdout,
        stderr,
        status_code: status.code(),
        success: status.success(),
    })
}

fn spawn_reader<R>(
    reader: R,
    channel: Channel<AppInstallEvent>,
    step_id: String,
    stream: AppInstallOutputStream,
) -> thread::JoinHandle<String>
where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || read_stream(reader, channel, step_id, stream))
}

fn read_stream<R: std::io::Read>(
    mut reader: R,
    channel: Channel<AppInstallEvent>,
    step_id: String,
    stream: AppInstallOutputStream,
) -> String {
    let mut captured = String::new();
    let mut buffer = [0u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                let data = String::from_utf8_lossy(&buffer[..n]).into_owned();
                captured.push_str(&data);
                let _ = channel.send(AppInstallEvent::Output {
                    step_id: step_id.clone(),
                    stream,
                    data,
                });
            }
            Err(error) => {
                captured.push_str(&format!("\nFailed to read process output: {error}\n"));
                break;
            }
        }
    }
    captured
}

pub(super) fn command_failure_message(step: InstallStepId, capture: &CommandCapture) -> String {
    let detail = if !capture.stderr.trim().is_empty() {
        capture.stderr.trim()
    } else if !capture.stdout.trim().is_empty() {
        capture.stdout.trim()
    } else {
        "No command output"
    };
    format!(
        "{} failed with status {}.\n{}",
        step.label(),
        capture
            .status_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "terminated by signal".to_string()),
        detail
    )
}

pub(super) fn start_step(channel: &Channel<AppInstallEvent>, step: InstallStepId) {
    let _ = channel.send(AppInstallEvent::StepStarted {
        step_id: step.as_str().to_string(),
        label: step.label().to_string(),
    });
}

pub(super) fn finish_step(
    channel: &Channel<AppInstallEvent>,
    step: InstallStepId,
    status: AppInstallStepStatus,
    message: Option<String>,
) {
    let _ = channel.send(AppInstallEvent::StepFinished {
        step_id: step.as_str().to_string(),
        status,
        message,
    });
}
