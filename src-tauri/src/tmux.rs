use std::process::Command;

use anyhow::{anyhow, Context, Result};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSessionStatus {
    pub available: bool,
    pub session_name: String,
    pub exists: bool,
    pub attached_clients: u32,
    pub windows: u32,
    pub panes: u32,
    pub current_command: Option<String>,
    pub current_path: Option<String>,
    pub pane_title: Option<String>,
    pub dead: bool,
}

pub fn session_name(workspace_id: &str, session_id: &str) -> String {
    format!(
        "helmor_{}_{}",
        sanitize_target_part(workspace_id),
        sanitize_target_part(session_id)
    )
}

pub fn is_available() -> bool {
    tmux_command().arg("-V").output().is_ok()
}

pub fn attach_or_create_script(
    session_name: &str,
    working_dir: &str,
    command_line: Option<&str>,
) -> String {
    let tmux = "tmux -L helmor -f /dev/null";
    let target = shell_quote(session_name);
    let working_dir = shell_quote(working_dir);
    let command = command_line
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!(" {}", shell_quote(value)))
        .unwrap_or_default();

    format!(
        "{tmux} has-session -t {target} 2>/dev/null || {tmux} new-session -d -s {target} -c {working_dir}{command}\n\
         {tmux} set-option -g extended-keys on >/dev/null 2>&1 || true\n\
         {tmux} set-option -g extended-keys-format csi-u >/dev/null 2>&1 || true\n\
         {tmux} set-option -t {target} extended-keys on >/dev/null 2>&1 || true\n\
         {tmux} set-option -t {target} extended-keys-format csi-u >/dev/null 2>&1 || true\n\
         {tmux} set-option -t {target} status off >/dev/null 2>&1 || true\n\
         {tmux} set-option -t {target} pane-border-status off >/dev/null 2>&1 || true\n\
         {tmux} set-option -t {target} message-style 'fg=default,bg=default' >/dev/null 2>&1 || true\n\
         {tmux} set-option -t {target} mode-style 'fg=default,bg=default' >/dev/null 2>&1 || true\n\
         exec {tmux} attach-session -t {target}"
    )
}

pub fn session_exists(session_name: &str) -> bool {
    tmux_command()
        .args(["has-session", "-t", session_name])
        .output()
        .is_ok_and(|output| output.status.success())
}

pub fn kill_session(session_name: &str) -> Result<bool> {
    if !is_available() || !session_exists(session_name) {
        return Ok(false);
    }
    let output = tmux_command()
        .args(["kill-session", "-t", session_name])
        .output()
        .context("Failed to run tmux kill-session")?;
    if output.status.success() {
        return Ok(true);
    }
    Err(tmux_error("tmux kill-session failed", output.stderr))
}

pub fn capture_pane(session_name: &str, lines: u16) -> Result<String> {
    if !is_available() {
        return Ok("tmux is not installed or is not on PATH.".to_string());
    }
    if !session_exists(session_name) {
        return Ok(String::new());
    }
    let start = format!("-{}", lines.max(1));
    let output = tmux_command()
        .args(["capture-pane", "-t", session_name, "-p", "-S", &start])
        .output()
        .context("Failed to run tmux capture-pane")?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    Err(tmux_error("tmux capture-pane failed", output.stderr))
}

pub fn status(session_name: &str) -> Result<TmuxSessionStatus> {
    if !is_available() {
        return Ok(TmuxSessionStatus {
            available: false,
            session_name: session_name.to_string(),
            exists: false,
            attached_clients: 0,
            windows: 0,
            panes: 0,
            current_command: None,
            current_path: None,
            pane_title: None,
            dead: false,
        });
    }
    if !session_exists(session_name) {
        return Ok(TmuxSessionStatus {
            available: true,
            session_name: session_name.to_string(),
            exists: false,
            attached_clients: 0,
            windows: 0,
            panes: 0,
            current_command: None,
            current_path: None,
            pane_title: None,
            dead: false,
        });
    }

    let output = tmux_command()
        .args([
            "display-message",
            "-p",
            "-t",
            session_name,
            "#{session_attached}\t#{session_windows}\t#{window_panes}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_title}\t#{pane_dead_status}",
        ])
        .output()
        .context("Failed to run tmux display-message")?;
    if !output.status.success() {
        return Err(tmux_error("tmux display-message failed", output.stderr));
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.trim_end_matches(['\r', '\n']).split('\t');
    Ok(TmuxSessionStatus {
        available: true,
        session_name: session_name.to_string(),
        exists: true,
        attached_clients: parse_u32(parts.next()),
        windows: parse_u32(parts.next()),
        panes: parse_u32(parts.next()),
        current_command: non_empty(parts.next()),
        current_path: non_empty(parts.next()),
        pane_title: non_empty(parts.next()),
        dead: matches!(parts.next(), Some("1")),
    })
}

fn sanitize_target_part(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

fn parse_u32(value: Option<&str>) -> u32 {
    value.and_then(|value| value.parse().ok()).unwrap_or(0)
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn tmux_command() -> Command {
    let mut command = Command::new("tmux");
    command.args(["-L", "helmor", "-f", "/dev/null"]);
    command
}

fn tmux_error(message: &str, stderr: Vec<u8>) -> anyhow::Error {
    let stderr = String::from_utf8_lossy(&stderr);
    let detail = stderr.trim();
    if detail.is_empty() {
        anyhow!(message.to_string())
    } else {
        anyhow!("{message}: {detail}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_name_is_safe_for_tmux_targets() {
        assert_eq!(
            session_name("workspace:1", "session/2"),
            "helmor_workspace_1_session_2"
        );
    }

    #[test]
    fn attach_script_disables_tmux_status_and_includes_optional_command() {
        let script = attach_or_create_script("helmor_w_s", "/tmp/project", Some("'codex'"));
        assert_eq!(
            script,
            "tmux -L helmor -f /dev/null has-session -t 'helmor_w_s' 2>/dev/null || tmux -L helmor -f /dev/null new-session -d -s 'helmor_w_s' -c '/tmp/project' ''\\''codex'\\'''\n\
             tmux -L helmor -f /dev/null set-option -g extended-keys on >/dev/null 2>&1 || true\n\
             tmux -L helmor -f /dev/null set-option -g extended-keys-format csi-u >/dev/null 2>&1 || true\n\
             tmux -L helmor -f /dev/null set-option -t 'helmor_w_s' extended-keys on >/dev/null 2>&1 || true\n\
             tmux -L helmor -f /dev/null set-option -t 'helmor_w_s' extended-keys-format csi-u >/dev/null 2>&1 || true\n\
             tmux -L helmor -f /dev/null set-option -t 'helmor_w_s' status off >/dev/null 2>&1 || true\n\
             tmux -L helmor -f /dev/null set-option -t 'helmor_w_s' pane-border-status off >/dev/null 2>&1 || true\n\
             tmux -L helmor -f /dev/null set-option -t 'helmor_w_s' message-style 'fg=default,bg=default' >/dev/null 2>&1 || true\n\
             tmux -L helmor -f /dev/null set-option -t 'helmor_w_s' mode-style 'fg=default,bg=default' >/dev/null 2>&1 || true\n\
             exec tmux -L helmor -f /dev/null attach-session -t 'helmor_w_s'"
        );
    }
}
