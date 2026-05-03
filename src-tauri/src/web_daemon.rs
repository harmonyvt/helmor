//! Managed lifecycle for the standalone Helmor web companion daemon.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::error::CommandError;

type CmdResult<T> = std::result::Result<T, CommandError>;

const PROD_PORT: u16 = 17_777;
const DEV_PORT: u16 = 17_778;
const PREVIEW_PORT_START: u16 = 18_000;
const PREVIEW_PORT_SPAN: u16 = 5_000;

#[derive(Default)]
pub struct WebDaemonManager {
    inner: Mutex<WebDaemonState>,
}

#[derive(Default)]
struct WebDaemonState {
    child: Option<ManagedWebDaemon>,
    last_error: Option<String>,
}

struct ManagedWebDaemon {
    child: Child,
    config: ResolvedWebDaemonConfig,
    started_at_ms: u128,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDaemonStartConfig {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub frontend_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDaemonStatus {
    pub state: WebDaemonStateLabel,
    pub pid: Option<u32>,
    pub url: String,
    pub host: String,
    pub port: u16,
    pub data_dir: String,
    pub frontend_dir: String,
    pub frontend_exists: bool,
    pub identity: String,
    pub command: String,
    pub started_at_ms: Option<u128>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WebDaemonStateLabel {
    Running,
    Stopped,
}

#[derive(Debug, Clone)]
struct ResolvedWebDaemonConfig {
    host: String,
    port: u16,
    data_dir: PathBuf,
    frontend_dir: PathBuf,
    identity: String,
    command: String,
}

impl WebDaemonManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn status(&self) -> Result<WebDaemonStatus> {
        let mut state = self.inner.lock().expect("web daemon mutex poisoned");
        reap_exited_child(&mut state);
        let config = state
            .child
            .as_ref()
            .map(|managed| managed.config.clone())
            .unwrap_or_else(|| resolve_config(None));
        if state.child.is_none() {
            if let Some(pid_file) = read_alive_pid_file(&config) {
                return Ok(status_from_pid_file(&state, config, pid_file));
            }
        }
        Ok(status_from_state(&state, config))
    }

    pub fn start(&self, config: Option<WebDaemonStartConfig>) -> Result<WebDaemonStatus> {
        let mut state = self.inner.lock().expect("web daemon mutex poisoned");
        reap_exited_child(&mut state);
        if let Some(managed) = &state.child {
            let config = managed.config.clone();
            return Ok(status_from_state(&state, config));
        }

        let config = resolve_config(config);
        if let Some(pid_file) = read_alive_pid_file(&config) {
            return Ok(status_from_pid_file(&state, config, pid_file));
        }
        let mut command = build_command(&config)?;
        let child = command
            .spawn()
            .with_context(|| format!("Failed to start web daemon via {}", config.command))?;
        state.child = Some(ManagedWebDaemon {
            child,
            config: config.clone(),
            started_at_ms: now_ms(),
        });
        state.last_error = None;
        Ok(status_from_state(&state, config))
    }

    pub fn stop(&self) -> Result<WebDaemonStatus> {
        let mut state = self.inner.lock().expect("web daemon mutex poisoned");
        if let Some(mut managed) = state.child.take() {
            terminate_child(&mut managed.child);
            remove_pid_file(&managed.config);
        } else {
            let config = resolve_config(None);
            stop_pid_file_process(&config);
        }
        let config = resolve_config(None);
        Ok(status_from_state(&state, config))
    }

    pub fn delete(&self) -> Result<WebDaemonStatus> {
        let mut state = self.inner.lock().expect("web daemon mutex poisoned");
        if let Some(mut managed) = state.child.take() {
            terminate_child(&mut managed.child);
            remove_pid_file(&managed.config);
        } else {
            let config = resolve_config(None);
            stop_pid_file_process(&config);
        }
        state.last_error = None;
        let config = resolve_config(None);
        Ok(status_from_state(&state, config))
    }
}

#[tauri::command]
pub fn get_web_daemon_status(
    manager: tauri::State<'_, WebDaemonManager>,
) -> CmdResult<WebDaemonStatus> {
    Ok(manager.status()?)
}

#[tauri::command]
pub fn start_web_daemon(
    manager: tauri::State<'_, WebDaemonManager>,
    config: Option<WebDaemonStartConfig>,
) -> CmdResult<WebDaemonStatus> {
    Ok(manager.start(config)?)
}

#[tauri::command]
pub fn stop_web_daemon(manager: tauri::State<'_, WebDaemonManager>) -> CmdResult<WebDaemonStatus> {
    Ok(manager.stop()?)
}

#[tauri::command]
pub fn delete_web_daemon(
    manager: tauri::State<'_, WebDaemonManager>,
) -> CmdResult<WebDaemonStatus> {
    Ok(manager.delete()?)
}

fn reap_exited_child(state: &mut WebDaemonState) {
    let Some(managed) = state.child.as_mut() else {
        return;
    };
    match managed.child.try_wait() {
        Ok(Some(status)) => {
            state.last_error = (!status.success()).then(|| format!("Daemon exited with {status}"));
            state.child = None;
        }
        Ok(None) => {}
        Err(error) => {
            state.last_error = Some(format!("Failed to inspect daemon process: {error}"));
            state.child = None;
        }
    }
}

fn status_from_state(state: &WebDaemonState, config: ResolvedWebDaemonConfig) -> WebDaemonStatus {
    let managed = state.child.as_ref();
    WebDaemonStatus {
        state: if managed.is_some() {
            WebDaemonStateLabel::Running
        } else {
            WebDaemonStateLabel::Stopped
        },
        pid: managed.map(|daemon| daemon.child.id()),
        url: format!("http://{}:{}", config.host, config.port),
        host: config.host,
        port: config.port,
        data_dir: config.data_dir.display().to_string(),
        frontend_exists: config.frontend_dir.join("index.html").is_file(),
        frontend_dir: config.frontend_dir.display().to_string(),
        identity: config.identity,
        command: config.command,
        started_at_ms: managed.map(|daemon| daemon.started_at_ms),
        last_error: state.last_error.clone(),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebDaemonPidFile {
    pid: u32,
    url: String,
    host: String,
    port: u16,
    data_dir: String,
    frontend_dir: String,
    identity: String,
    started_at_ms: u128,
}

fn status_from_pid_file(
    state: &WebDaemonState,
    config: ResolvedWebDaemonConfig,
    pid_file: WebDaemonPidFile,
) -> WebDaemonStatus {
    WebDaemonStatus {
        state: WebDaemonStateLabel::Running,
        pid: Some(pid_file.pid),
        url: pid_file.url,
        host: pid_file.host,
        port: pid_file.port,
        data_dir: pid_file.data_dir,
        frontend_exists: config.frontend_dir.join("index.html").is_file(),
        frontend_dir: pid_file.frontend_dir,
        identity: pid_file.identity,
        command: config.command,
        started_at_ms: Some(pid_file.started_at_ms),
        last_error: state.last_error.clone(),
    }
}

fn read_alive_pid_file(config: &ResolvedWebDaemonConfig) -> Option<WebDaemonPidFile> {
    let body = std::fs::read_to_string(pid_file_path(config)).ok()?;
    let file = serde_json::from_str::<WebDaemonPidFile>(&body).ok()?;
    process_is_alive(file.pid).then_some(file)
}

fn pid_file_path(config: &ResolvedWebDaemonConfig) -> PathBuf {
    config
        .data_dir
        .join("run")
        .join(format!("web-daemon-{}.json", config.port))
}

fn remove_pid_file(config: &ResolvedWebDaemonConfig) {
    let _ = std::fs::remove_file(pid_file_path(config));
}

fn stop_pid_file_process(config: &ResolvedWebDaemonConfig) {
    let Some(file) = read_alive_pid_file(config) else {
        remove_pid_file(config);
        return;
    };
    terminate_pid(file.pid);
    remove_pid_file(config);
}

fn process_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(pid as libc::pid_t, 0) == 0
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

fn terminate_pid(pid: u32) {
    if pid == std::process::id() {
        return;
    }
    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(pid as libc::pid_t, libc::SIGTERM);
    }
}

fn resolve_config(input: Option<WebDaemonStartConfig>) -> ResolvedWebDaemonConfig {
    let data_dir = crate::data_dir::data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let frontend_dir = input
        .as_ref()
        .and_then(|config| config.frontend_dir.as_ref())
        .map(PathBuf::from)
        .unwrap_or_else(crate::web::default_frontend_dir);
    let host = input
        .as_ref()
        .and_then(|config| config.host.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let port = input
        .as_ref()
        .and_then(|config| config.port)
        .or_else(env_port)
        .unwrap_or_else(|| default_port(&data_dir));
    let identity = daemon_identity(&data_dir);
    let command = resolve_command_label();

    ResolvedWebDaemonConfig {
        host,
        port,
        data_dir,
        frontend_dir,
        identity,
        command,
    }
}

fn build_command(config: &ResolvedWebDaemonConfig) -> Result<Command> {
    let resolved = resolve_command()?;
    let mut command = match resolved {
        WebDaemonCommand::Binary(path) => Command::new(path),
        WebDaemonCommand::CargoRun { cwd } => {
            let mut command = Command::new("cargo");
            command
                .current_dir(cwd)
                .arg("run")
                .arg("--bin")
                .arg("helmor-web")
                .arg("--");
            command
        }
    };

    command
        .arg("--host")
        .arg(&config.host)
        .arg("--port")
        .arg(config.port.to_string())
        .arg("--data-dir")
        .arg(&config.data_dir)
        .arg("--frontend-dir")
        .arg(&config.frontend_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    Ok(command)
}

#[derive(Debug, Clone)]
enum WebDaemonCommand {
    Binary(PathBuf),
    CargoRun { cwd: PathBuf },
}

fn resolve_command() -> Result<WebDaemonCommand> {
    if let Ok(path) = std::env::var("HELMOR_WEB_DAEMON_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(WebDaemonCommand::Binary(path));
        }
        bail!(
            "HELMOR_WEB_DAEMON_PATH does not point to a file: {}",
            path.display()
        );
    }

    for candidate in command_candidates() {
        if candidate.is_file() {
            return Ok(WebDaemonCommand::Binary(candidate));
        }
    }

    if let Some(cwd) = find_src_tauri_dir() {
        return Ok(WebDaemonCommand::CargoRun { cwd });
    }

    bail!("helmor-web binary was not found. Run `cargo build --bin helmor-web` first.")
}

fn resolve_command_label() -> String {
    match resolve_command() {
        Ok(WebDaemonCommand::Binary(path)) => path.display().to_string(),
        Ok(WebDaemonCommand::CargoRun { cwd }) => {
            format!("cargo run --bin helmor-web (cwd: {})", cwd.display())
        }
        Err(error) => format!("unavailable: {error:#}"),
    }
}

fn command_candidates() -> Vec<PathBuf> {
    let binary_name = if cfg!(windows) {
        "helmor-web.exe"
    } else {
        "helmor-web"
    };
    let mut candidates = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join(binary_name));
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        for base in [cwd.as_path(), cwd.parent().unwrap_or(cwd.as_path())] {
            candidates.push(base.join("target/debug").join(binary_name));
            candidates.push(base.join("src-tauri/target/debug").join(binary_name));
        }
    }

    candidates
}

fn find_src_tauri_dir() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    for base in [cwd.as_path(), cwd.parent().unwrap_or(cwd.as_path())] {
        let candidate = base.join("src-tauri/Cargo.toml");
        if candidate.is_file() {
            return candidate.parent().map(PathBuf::from);
        }
        let candidate = base.join("Cargo.toml");
        if candidate.is_file()
            && base.file_name().and_then(|name| name.to_str()) == Some("src-tauri")
        {
            return Some(base.to_path_buf());
        }
    }
    None
}

fn terminate_child(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(-(child.id() as libc::pid_t), libc::SIGTERM);
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }

    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn env_port() -> Option<u16> {
    std::env::var("HELMOR_WEB_PORT").ok()?.parse().ok()
}

fn default_port(data_dir: &std::path::Path) -> u16 {
    if !cfg!(debug_assertions) {
        return PROD_PORT;
    }
    let data_dir = data_dir.display().to_string();
    if data_dir.contains("helmor-dev-previews") {
        return PREVIEW_PORT_START + stable_hash_to_port(&data_dir, PREVIEW_PORT_SPAN);
    }
    DEV_PORT
}

fn daemon_identity(data_dir: &std::path::Path) -> String {
    let label = crate::data_dir::data_mode_label();
    if label == "custom" {
        let display = data_dir.display().to_string();
        if let Some(name) = data_dir.file_name().and_then(|name| name.to_str()) {
            return format!("custom:{name}:{}", stable_hash_to_port(&display, 10_000));
        }
    }
    label.to_string()
}

fn stable_hash_to_port(input: &str, span: u16) -> u16 {
    let mut hash: u32 = 2_166_136_261;
    for byte in input.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(16_777_619);
    }
    (hash % u32::from(span)) as u16
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
