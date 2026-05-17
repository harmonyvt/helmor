use tauri::ipc::Channel;
use tauri::State;

use crate::workspace::scripts::{PtySize, ScriptContext, ScriptEvent, ScriptProcessManager};
use crate::{repos, terminal_profiles, tmux};

use super::common::CmdResult;

/// Internal `script_type` namespace for Terminal-tab PTY sessions.
///
/// The `ScriptProcessManager` keys processes by `(repo_id, script_type,
/// workspace_id)`. To support multiple concurrent terminals per workspace
/// (each Terminal sub-tab is one) without changing the manager's key shape,
/// we encode the per-instance UUID into the script_type as
/// `"terminal:<instance_id>"`. Setup/Run still use the bare `"setup"` and
/// `"run"` strings, so they're unaffected.
fn make_workspace_script_type(instance_id: &str) -> String {
    format!("terminal:{instance_id}")
}

fn make_session_script_type(instance_id: &str) -> String {
    format!("session-terminal:{instance_id}")
}

/// Spawn a blank interactive shell ($SHELL -i -l) on a fresh PTY in the
/// workspace directory and stream its output to the frontend over `channel`.
///
/// The shell stays alive until the user types `exit`, the process tree dies,
/// or the frontend invokes `stop_terminal`. Nothing is persisted to disk —
/// closing the app discards the session entirely.
#[tauri::command]
pub async fn spawn_terminal(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    instance_id: String,
    channel: Channel<ScriptEvent>,
) -> CmdResult<()> {
    let (repo, workspace) = tauri::async_runtime::spawn_blocking({
        let repo_id = repo_id.clone();
        let ws_id = workspace_id.clone();
        move || -> anyhow::Result<(
            repos::RepositoryRecord,
            Option<crate::models::workspaces::WorkspaceRecord>,
        )> {
            let repo = repos::load_repository_by_id(&repo_id)?
                .ok_or_else(|| anyhow::anyhow!("Repository not found: {repo_id}"))?;
            let ws = crate::models::workspaces::load_workspace_record_by_id(&ws_id)?;
            Ok((repo, ws))
        }
    })
    .await
    .map_err(|e| anyhow::anyhow!("spawn_blocking join failed: {e}"))??;

    // Workspace path is required — Terminal tabs only ever spawn inside an
    // active workspace. Fall back to the repo root only if, for some reason,
    // we couldn't resolve the workspace directory.
    let workspace_root = workspace
        .as_ref()
        .and_then(|ws| crate::data_dir::workspace_dir(&ws.repo_name, &ws.directory_name).ok());
    let working_dir = workspace_root
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| repo.root_path.clone());
    let context = ScriptContext {
        root_path: repo.root_path.clone(),
        workspace_path: Some(working_dir.clone()),
        workspace_name: workspace.as_ref().map(|ws| ws.directory_name.clone()),
        default_branch: repo.default_branch.clone(),
    };
    let mgr = manager.inner().clone();
    let script_type = make_workspace_script_type(&instance_id);

    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = crate::workspace::scripts::run_terminal_session(
            &mgr,
            &repo_id,
            &script_type,
            Some(&workspace_id),
            &working_dir,
            &context,
            channel.clone(),
            None,
        ) {
            let _ = channel.send(ScriptEvent::Error {
                message: e.to_string(),
            });
        }
    });

    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn spawn_session_terminal(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    session_id: String,
    runtime: Option<String>,
    initial_cols: Option<u16>,
    initial_rows: Option<u16>,
    channel: Channel<ScriptEvent>,
) -> CmdResult<()> {
    let (repo, workspace) = tauri::async_runtime::spawn_blocking({
        let repo_id = repo_id.clone();
        let ws_id = workspace_id.clone();
        move || -> anyhow::Result<(
            repos::RepositoryRecord,
            Option<crate::models::workspaces::WorkspaceRecord>,
        )> {
            let repo = repos::load_repository_by_id(&repo_id)?
                .ok_or_else(|| anyhow::anyhow!("Repository not found: {repo_id}"))?;
            let ws = crate::models::workspaces::load_workspace_record_by_id(&ws_id)?;
            Ok((repo, ws))
        }
    })
    .await
    .map_err(|e| anyhow::anyhow!("spawn_blocking join failed: {e}"))??;

    let workspace_root = workspace
        .as_ref()
        .and_then(|ws| crate::data_dir::workspace_dir(&ws.repo_name, &ws.directory_name).ok());
    let working_dir = workspace_root
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| repo.root_path.clone());
    crate::sessions::update_terminal_started(&session_id, &working_dir)?;

    let context = ScriptContext {
        root_path: repo.root_path.clone(),
        workspace_path: Some(working_dir.clone()),
        workspace_name: workspace.as_ref().map(|ws| ws.directory_name.clone()),
        default_branch: repo.default_branch.clone(),
    };
    let mgr = manager.inner().clone();
    let script_type = make_session_script_type(&session_id);
    let profile =
        terminal_profiles::resolve_terminal_profile(runtime.as_deref().unwrap_or("shell"));
    let runtime_label = profile.label.clone();
    let profile_command = profile.command_line();
    let tmux_session_name = tmux::session_name(&workspace_id, &session_id);
    let tmux_available = tmux::is_available();
    let initial_size = match (initial_cols, initial_rows) {
        (Some(cols), Some(rows)) if cols > 0 && rows > 0 => Some(PtySize { cols, rows }),
        _ => None,
    };

    tauri::async_runtime::spawn_blocking(move || {
        let result = if tmux_available {
            let script = tmux::attach_or_create_script(
                &tmux_session_name,
                &working_dir,
                profile_command.as_deref(),
            );
            let args = vec!["-lc".to_string(), script];
            crate::workspace::scripts::run_terminal_command(
                &mgr,
                &repo_id,
                &script_type,
                Some(&workspace_id),
                &working_dir,
                &context,
                channel.clone(),
                "/bin/sh",
                &args,
                initial_size,
            )
        } else {
            let _ = channel.send(ScriptEvent::Stdout {
                data: "\r\n\x1b[33mtmux not found; running in a transient Helmor PTY.\x1b[0m\r\n"
                    .to_string(),
            });
            crate::workspace::scripts::run_terminal_session_with_size(
                &mgr,
                &repo_id,
                &script_type,
                Some(&workspace_id),
                &working_dir,
                &context,
                channel.clone(),
                profile_command.as_deref(),
                initial_size,
            )
        };
        match result {
            Ok(exit_code) => {
                if !tmux_available || !tmux::session_exists(&tmux_session_name) {
                    let _ = crate::sessions::update_terminal_stopped(&session_id, exit_code);
                }
            }
            Err(e) => {
                let _ = crate::sessions::update_terminal_stopped(&session_id, Some(1));
                let _ = channel.send(ScriptEvent::Error {
                    message: format!("Failed to start {runtime_label} terminal: {e}"),
                });
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn list_terminal_profiles() -> CmdResult<Vec<terminal_profiles::TerminalProfile>> {
    Ok(terminal_profiles::list_terminal_profiles())
}

#[tauri::command]
pub async fn get_session_terminal_status(
    workspace_id: String,
    session_id: String,
) -> CmdResult<tmux::TmuxSessionStatus> {
    let session_name = tmux::session_name(&workspace_id, &session_id);
    Ok(tmux::status(&session_name)?)
}

#[tauri::command]
pub async fn capture_session_terminal(
    workspace_id: String,
    session_id: String,
    lines: Option<u16>,
) -> CmdResult<String> {
    let session_name = tmux::session_name(&workspace_id, &session_id);
    Ok(tmux::capture_pane(&session_name, lines.unwrap_or(80))?)
}

#[tauri::command]
pub async fn stop_terminal(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    instance_id: String,
) -> CmdResult<bool> {
    let key = (
        repo_id,
        make_workspace_script_type(&instance_id),
        Some(workspace_id),
    );
    Ok(manager.kill(&key))
}

#[tauri::command]
pub async fn stop_session_terminal(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    session_id: String,
) -> CmdResult<bool> {
    let tmux_session_name = tmux::session_name(&workspace_id, &session_id);
    let tmux_killed = tmux::kill_session(&tmux_session_name)?;
    let key = (
        repo_id,
        make_session_script_type(&session_id),
        Some(workspace_id),
    );
    Ok(manager.kill(&key) || tmux_killed)
}

#[tauri::command]
pub async fn write_terminal_stdin(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    instance_id: String,
    data: String,
) -> CmdResult<bool> {
    let key = (
        repo_id,
        make_workspace_script_type(&instance_id),
        Some(workspace_id),
    );
    Ok(manager.write_stdin(&key, data.as_bytes())?)
}

#[tauri::command]
pub async fn write_session_terminal_stdin(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    session_id: String,
    data: String,
) -> CmdResult<bool> {
    let key = (
        repo_id,
        make_session_script_type(&session_id),
        Some(workspace_id),
    );
    Ok(manager.write_stdin(&key, data.as_bytes())?)
}

#[tauri::command]
pub async fn resize_terminal(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    instance_id: String,
    cols: u16,
    rows: u16,
) -> CmdResult<bool> {
    let key = (
        repo_id,
        make_workspace_script_type(&instance_id),
        Some(workspace_id),
    );
    Ok(manager.resize(&key, cols, rows)?)
}

#[tauri::command]
pub async fn resize_session_terminal(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    workspace_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
) -> CmdResult<bool> {
    let key = (
        repo_id,
        make_session_script_type(&session_id),
        Some(workspace_id),
    );
    Ok(manager.resize(&key, cols, rows)?)
}
