//! Managed lifecycle for the standalone Helmor web companion daemon.

mod network;

pub(crate) use network::web_reachability;

use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::error::CommandError;

type CmdResult<T> = std::result::Result<T, CommandError>;

const PROD_PORT: u16 = 17_777;
const DEV_PORT: u16 = 17_778;
const PREVIEW_PORT_START: u16 = 18_000;
const PREVIEW_PORT_SPAN: u16 = 5_000;

#[derive(Clone, Default)]
pub struct WebDaemonManager {
    inner: Arc<Mutex<WebDaemonState>>,
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
    pub open_url: String,
    pub reachable_urls: Vec<String>,
    pub host: String,
    pub listen_host: String,
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

    fn task_handle(&self) -> Self {
        self.clone()
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
        cleanup_current_mode(&config)?;
        let mut command = build_command(&config)?;
        let mut child = command
            .spawn()
            .with_context(|| format!("Failed to start web daemon via {}", config.command))?;
        if let Err(error) = wait_for_ready(&mut child, &config) {
            terminate_child(&mut child);
            state.last_error = Some(error.to_string());
            return Err(error);
        }
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
        self.cleanup()
    }

    pub fn cleanup(&self) -> Result<WebDaemonStatus> {
        let mut state = self.inner.lock().expect("web daemon mutex poisoned");
        if let Some(mut managed) = state.child.take() {
            terminate_child(&mut managed.child);
            remove_pid_file(&managed.config);
        } else {
            let config = resolve_config(None);
            cleanup_current_mode(&config)?;
        }
        state.last_error = None;
        let config = resolve_config(None);
        Ok(status_from_state(&state, config))
    }
}

#[tauri::command]
pub async fn get_web_daemon_status(
    manager: tauri::State<'_, WebDaemonManager>,
) -> CmdResult<WebDaemonStatus> {
    run_manager_task(manager.task_handle(), |manager| manager.status()).await
}

#[tauri::command]
pub async fn start_web_daemon(
    manager: tauri::State<'_, WebDaemonManager>,
    config: Option<WebDaemonStartConfig>,
) -> CmdResult<WebDaemonStatus> {
    run_manager_task(manager.task_handle(), move |manager| manager.start(config)).await
}

#[tauri::command]
pub async fn stop_web_daemon(
    manager: tauri::State<'_, WebDaemonManager>,
) -> CmdResult<WebDaemonStatus> {
    run_manager_task(manager.task_handle(), |manager| manager.stop()).await
}

#[tauri::command]
pub async fn delete_web_daemon(
    manager: tauri::State<'_, WebDaemonManager>,
) -> CmdResult<WebDaemonStatus> {
    run_manager_task(manager.task_handle(), |manager| manager.delete()).await
}

#[tauri::command]
pub async fn cleanup_web_daemon(
    manager: tauri::State<'_, WebDaemonManager>,
) -> CmdResult<WebDaemonStatus> {
    run_manager_task(manager.task_handle(), |manager| manager.cleanup()).await
}

async fn run_manager_task<F>(manager: WebDaemonManager, task: F) -> CmdResult<WebDaemonStatus>
where
    F: FnOnce(WebDaemonManager) -> Result<WebDaemonStatus> + Send + 'static,
{
    let result = tauri::async_runtime::spawn_blocking(move || task(manager))
        .await
        .map_err(|error| anyhow::anyhow!("web daemon task failed: {error}"))?;
    Ok(result?)
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
    let reachability = network::web_reachability(&config.host, config.port);
    WebDaemonStatus {
        state: if managed.is_some() {
            WebDaemonStateLabel::Running
        } else {
            WebDaemonStateLabel::Stopped
        },
        pid: managed.map(|daemon| daemon.child.id()),
        url: reachability.open_url.clone(),
        open_url: reachability.open_url,
        reachable_urls: reachability.reachable_urls,
        host: config.host.clone(),
        listen_host: config.host,
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
    #[serde(default)]
    listen_host: Option<String>,
    #[serde(default)]
    open_url: Option<String>,
    #[serde(default)]
    reachable_urls: Vec<String>,
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
    let listen_host = pid_file.listen_host.unwrap_or(pid_file.host);
    let reachability = if pid_file.reachable_urls.is_empty() {
        network::web_reachability(&listen_host, pid_file.port)
    } else {
        network::WebReachability {
            open_url: pid_file.open_url.unwrap_or_else(|| pid_file.url.clone()),
            reachable_urls: pid_file.reachable_urls,
        }
    };
    WebDaemonStatus {
        state: WebDaemonStateLabel::Running,
        pid: Some(pid_file.pid),
        url: reachability.open_url.clone(),
        open_url: reachability.open_url,
        reachable_urls: reachability.reachable_urls,
        host: listen_host.clone(),
        listen_host,
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
    if process_is_alive(file.pid)
        && process_looks_like_helmor_web(file.pid)
        && tcp_listener_is_ready(&file.host, file.port)
    {
        Some(file)
    } else {
        remove_pid_file(config);
        None
    }
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

fn cleanup_current_mode(config: &ResolvedWebDaemonConfig) -> Result<()> {
    let run_dir = config.data_dir.join("run");
    let entries = match std::fs::read_dir(&run_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(error).with_context(|| {
                format!("Failed to read web daemon run dir {}", run_dir.display())
            })
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !is_web_daemon_pid_path(&path) {
            continue;
        }
        let file = std::fs::read_to_string(&path)
            .ok()
            .and_then(|body| serde_json::from_str::<WebDaemonPidFile>(&body).ok());
        if let Some(file) = file {
            cleanup_pid_file_process(file.pid);
        }
        let _ = std::fs::remove_file(path);
    }

    Ok(())
}

fn is_web_daemon_pid_path(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("web-daemon-") && name.ends_with(".json"))
}

fn cleanup_pid_file_process(pid: u32) {
    if process_is_alive(pid) && process_looks_like_helmor_web(pid) {
        terminate_pid(pid);
    }
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

fn process_looks_like_helmor_web(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        let output = Command::new("ps")
            .arg("-p")
            .arg(pid.to_string())
            .arg("-o")
            .arg("comm=")
            .arg("-o")
            .arg("args=")
            .output();
        let Ok(output) = output else {
            return false;
        };
        if !output.status.success() {
            return false;
        }
        String::from_utf8_lossy(&output.stdout).contains("helmor-web")
    }
    #[cfg(not(unix))]
    {
        false
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
        .or_else(env_host)
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
        if is_usable_binary(&candidate) {
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

fn is_usable_binary(path: &std::path::Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() || metadata.len() == 0 {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
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

fn wait_for_ready(child: &mut Child, config: &ResolvedWebDaemonConfig) -> Result<()> {
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(30);
    while start.elapsed() < timeout {
        match child.try_wait() {
            Ok(Some(status)) => bail!("Web daemon exited before listening: {status}"),
            Ok(None) => {}
            Err(error) => bail!("Failed to inspect web daemon process: {error}"),
        }
        if pid_file_is_ready(config) && tcp_listener_is_ready(&config.host, config.port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    bail!(
        "Timed out waiting for web daemon to listen on {}:{}",
        config.host,
        config.port
    )
}

fn pid_file_is_ready(config: &ResolvedWebDaemonConfig) -> bool {
    let Ok(body) = std::fs::read_to_string(pid_file_path(config)) else {
        return false;
    };
    let Ok(file) = serde_json::from_str::<WebDaemonPidFile>(&body) else {
        return false;
    };
    file.port == config.port && process_looks_like_helmor_web(file.pid)
}

fn tcp_listener_is_ready(host: &str, port: u16) -> bool {
    connect_addrs(host, port)
        .into_iter()
        .any(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok())
}

fn connect_addrs(host: &str, port: u16) -> Vec<SocketAddr> {
    let host = host.trim();
    if let Ok(ip) = host.parse::<IpAddr>() {
        let connect_ip = if ip.is_unspecified() {
            if ip.is_ipv6() {
                IpAddr::from([0, 0, 0, 0, 0, 0, 0, 1])
            } else {
                IpAddr::from([127, 0, 0, 1])
            }
        } else {
            ip
        };
        return vec![SocketAddr::new(connect_ip, port)];
    }

    (host, port)
        .to_socket_addrs()
        .map(|addrs| addrs.collect())
        .unwrap_or_default()
}

fn env_port() -> Option<u16> {
    std::env::var("HELMOR_WEB_PORT").ok()?.parse().ok()
}

fn env_host() -> Option<String> {
    std::env::var("HELMOR_WEB_HOST")
        .ok()
        .map(|host| host.trim().to_string())
        .filter(|host| !host.is_empty())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(data_dir: PathBuf, port: u16) -> ResolvedWebDaemonConfig {
        ResolvedWebDaemonConfig {
            host: "127.0.0.1".to_string(),
            port,
            data_dir,
            frontend_dir: PathBuf::from("/tmp/helmor-web-dist"),
            identity: "test".to_string(),
            command: "test".to_string(),
        }
    }

    fn with_env_var<T>(key: &str, value: &str, task: impl FnOnce() -> T) -> T {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        let result = task();
        match previous {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
        result
    }

    fn write_pid_file(data_dir: &std::path::Path, port: u16, pid: u32) -> PathBuf {
        let run_dir = data_dir.join("run");
        std::fs::create_dir_all(&run_dir).unwrap();
        let path = run_dir.join(format!("web-daemon-{port}.json"));
        let body = serde_json::json!({
            "pid": pid,
            "url": format!("http://127.0.0.1:{port}"),
            "host": "127.0.0.1",
            "port": port,
            "dataDir": data_dir.display().to_string(),
            "frontendDir": "/tmp/helmor-web-dist",
            "identity": "test",
            "startedAtMs": 1_u128,
        });
        std::fs::write(&path, serde_json::to_vec(&body).unwrap()).unwrap();
        path
    }

    #[test]
    fn cleanup_current_mode_removes_only_active_data_dir_pid_files() {
        let active = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let active_pid = write_pid_file(active.path(), 17_778, 0);
        let active_other_pid = write_pid_file(active.path(), 18_001, 0);
        let other_pid = write_pid_file(other.path(), 17_777, 0);
        let unrelated = active.path().join("run/not-web-daemon.json");
        std::fs::write(&unrelated, "{}").unwrap();

        cleanup_current_mode(&test_config(active.path().to_path_buf(), 17_778)).unwrap();

        assert!(!active_pid.exists());
        assert!(!active_other_pid.exists());
        assert!(other_pid.exists());
        assert!(unrelated.exists());
    }

    #[test]
    fn read_alive_pid_file_removes_stale_pid_file() {
        let dir = tempfile::tempdir().unwrap();
        let config = test_config(dir.path().to_path_buf(), 17_778);
        let pid_file = write_pid_file(dir.path(), 17_778, 0);

        assert!(read_alive_pid_file(&config).is_none());
        assert!(!pid_file.exists());
    }

    #[test]
    fn env_host_is_used_when_start_config_omits_host() {
        with_env_var("HELMOR_WEB_HOST", "0.0.0.0", || {
            let config = resolve_config(None);
            assert_eq!(config.host, "0.0.0.0");
        });
    }

    #[test]
    fn explicit_host_overrides_env_host() {
        with_env_var("HELMOR_WEB_HOST", "0.0.0.0", || {
            let config = resolve_config(Some(WebDaemonStartConfig {
                host: Some("127.0.0.1".to_string()),
                port: None,
                frontend_dir: None,
            }));
            assert_eq!(config.host, "127.0.0.1");
        });
    }

    #[test]
    fn wildcard_status_uses_reachable_url_instead_of_listen_address() {
        let mut config = test_config(PathBuf::from("/tmp/helmor-web-status"), 18_436);
        config.host = "0.0.0.0".to_string();
        let state = WebDaemonState::default();

        let status = status_from_state(&state, config);

        assert_eq!(status.host, "0.0.0.0");
        assert_eq!(status.listen_host, "0.0.0.0");
        assert!(!status.url.contains("0.0.0.0"));
        assert_eq!(status.url, status.open_url);
        assert!(status
            .reachable_urls
            .iter()
            .any(|url| url == "http://127.0.0.1:18436"));
    }
}
