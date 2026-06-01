use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::repos;
use crate::ui_sync::{self, UiMutationEvent};
use crate::workspace::scripts::{ScriptContext, ScriptEvent, ScriptProcessManager};

use super::common::CmdResult;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn execute_repo_script(
    app: AppHandle,
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    script_type: String,
    workspace_id: Option<String>,
    process_scope: Option<String>,
    working_directory_override: Option<String>,
    channel: Channel<ScriptEvent>,
) -> CmdResult<()> {
    let scripts = tauri::async_runtime::spawn_blocking({
        let repo_id = repo_id.clone();
        let ws_id = workspace_id.clone();
        move || repos::load_repo_scripts(&repo_id, ws_id.as_deref())
    })
    .await
    .map_err(|e| anyhow::anyhow!("spawn_blocking join failed: {e}"))??;

    let script = match script_type.as_str() {
        "setup" => scripts.setup_script,
        "run" => scripts.run_script,
        "archive" => scripts.archive_script,
        _ => None,
    };

    let Some(script) = script.filter(|s| !s.trim().is_empty()) else {
        let _ = channel.send(ScriptEvent::Error {
            message: format!("No {script_type} script configured"),
        });
        return Ok(());
    };

    let (repo, workspace) = tauri::async_runtime::spawn_blocking({
        let repo_id = repo_id.clone();
        let ws_id = workspace_id.clone();
        move || -> anyhow::Result<(repos::RepositoryRecord, Option<crate::models::workspaces::WorkspaceRecord>)> {
            let repo = repos::load_repository_by_id(&repo_id)?
                .ok_or_else(|| anyhow::anyhow!("Repository not found: {repo_id}"))?;
            let ws = match ws_id {
                Some(id) => crate::models::workspaces::load_workspace_record_by_id(&id)?,
                None => None,
            };
            Ok((repo, ws))
        }
    })
    .await
    .map_err(|e| anyhow::anyhow!("spawn_blocking join failed: {e}"))??;

    // Run in the workspace directory when available, otherwise repo root.
    let workspace_root = workspace
        .as_ref()
        .and_then(|ws| crate::data_dir::workspace_dir(&ws.repo_name, &ws.directory_name).ok());
    let working_dir = resolve_script_working_dir(
        working_directory_override.as_deref(),
        workspace_root.as_deref(),
        &repo.root_path,
    )?;
    let context = ScriptContext {
        root_path: repo.root_path.clone(),
        workspace_path: Some(working_dir.clone()),
        workspace_name: workspace.as_ref().map(|ws| ws.directory_name.clone()),
        default_branch: repo.default_branch.clone(),
    };
    let mgr = manager.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        match crate::workspace::scripts::run_script(
            &mgr,
            &repo_id,
            &script_type,
            process_scope.as_deref().or(workspace_id.as_deref()),
            &script,
            &working_dir,
            &context,
            channel.clone(),
        ) {
            Ok(Some(0)) if script_type == "setup" => {
                if let Some(ws_id) = &workspace_id {
                    if let Ok(ts) = crate::models::db::current_timestamp() {
                        let _ = crate::models::workspaces::update_workspace_state(
                            ws_id,
                            crate::workspace_state::WorkspaceState::Ready,
                            &ts,
                        );
                    }
                    ui_sync::publish(
                        &app,
                        UiMutationEvent::WorkspaceChanged {
                            workspace_id: ws_id.clone(),
                        },
                    );
                    crate::git::watcher::notify_workspace_changed(&app);
                }
            }
            Ok(_) => {}
            Err(e) => {
                let _ = channel.send(ScriptEvent::Error {
                    message: e.to_string(),
                });
            }
        }
    });

    Ok(())
}

fn resolve_script_working_dir(
    override_path: Option<&str>,
    workspace_root: Option<&std::path::Path>,
    repo_root: &str,
) -> anyhow::Result<String> {
    let Some(override_path) = override_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(workspace_root
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| repo_root.to_string()));
    };

    let override_path = std::path::PathBuf::from(override_path);
    if !override_path.is_absolute() {
        anyhow::bail!(
            "Script working directory override must be absolute: {}",
            override_path.display()
        );
    }
    if !override_path.is_dir() {
        anyhow::bail!(
            "Script working directory override is missing: {}",
            override_path.display()
        );
    }
    // We require a known workspace root to validate the override against.
    // Without it the only sane action is to refuse — accepting any
    // absolute path here would let a caller redirect script execution
    // anywhere on disk when the workspace lookup fails (TOCTOU / broken
    // state). Previously this branch silently accepted the override.
    let Some(workspace_root) = workspace_root else {
        anyhow::bail!(
            "Script working directory override requires a resolvable workspace root: {}",
            override_path.display()
        );
    };
    let canonical_override = override_path.canonicalize()?;
    let canonical_workspace = workspace_root.canonicalize()?;
    if !canonical_override.starts_with(&canonical_workspace) {
        anyhow::bail!(
            "Script working directory override must be inside the workspace: {}",
            override_path.display()
        );
    }
    Ok(override_path.display().to_string())
}

#[tauri::command]
pub async fn stop_repo_script(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    script_type: String,
    workspace_id: Option<String>,
    process_scope: Option<String>,
) -> CmdResult<bool> {
    let key = (repo_id, script_type, process_scope.or(workspace_id));
    Ok(manager.kill(&key))
}

/// Write raw bytes to the PTY master of a running script. The kernel's tty
/// line discipline turns `\x03` into SIGINT for the foreground process group,
/// so this is what makes Ctrl+C inside the terminal tab actually work.
#[tauri::command]
pub async fn write_repo_script_stdin(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    script_type: String,
    workspace_id: Option<String>,
    process_scope: Option<String>,
    data: String,
) -> CmdResult<bool> {
    let key = (repo_id, script_type, process_scope.or(workspace_id));
    Ok(manager.write_stdin(&key, data.as_bytes())?)
}

/// Update the PTY's window size. The kernel delivers SIGWINCH to the
/// foreground process group so interactive tools (vim, htop, less) re-layout.
#[tauri::command]
pub async fn resize_repo_script(
    manager: State<'_, ScriptProcessManager>,
    repo_id: String,
    script_type: String,
    workspace_id: Option<String>,
    process_scope: Option<String>,
    cols: u16,
    rows: u16,
) -> CmdResult<bool> {
    let key = (repo_id, script_type, process_scope.or(workspace_id));
    Ok(manager.resize(&key, cols, rows)?)
}

#[cfg(test)]
mod working_dir_tests {
    use super::resolve_script_working_dir;
    use std::fs;

    #[test]
    fn override_requires_resolvable_workspace_root() {
        let temp = tempfile::tempdir().unwrap();
        let override_dir = temp.path().join("submodule");
        fs::create_dir_all(&override_dir).unwrap();

        // Without a workspace root we must refuse the override — otherwise
        // a broken-workspace state could let scripts execute anywhere on
        // disk.
        let err = resolve_script_working_dir(
            Some(override_dir.to_str().unwrap()),
            None,
            "/does/not/matter",
        )
        .expect_err("override without workspace root must error");
        let msg = format!("{err:#}");
        assert!(
            msg.contains("resolvable workspace root"),
            "expected workspace-root error, got: {msg}",
        );
    }

    #[test]
    fn override_rejected_when_outside_workspace() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let err = resolve_script_working_dir(
            Some(outside.path().to_str().unwrap()),
            Some(workspace.path()),
            "/does/not/matter",
        )
        .expect_err("override outside workspace must error");
        let msg = format!("{err:#}");
        assert!(
            msg.contains("must be inside the workspace"),
            "expected inside-workspace error, got: {msg}",
        );
    }

    #[test]
    fn override_accepted_inside_workspace() {
        let workspace = tempfile::tempdir().unwrap();
        let submodule = workspace.path().join("vendor").join("lib");
        fs::create_dir_all(&submodule).unwrap();

        let resolved = resolve_script_working_dir(
            Some(submodule.to_str().unwrap()),
            Some(workspace.path()),
            "/repo/root",
        )
        .expect("override inside workspace should resolve");
        // The helper returns the caller-supplied path verbatim — it
        // only canonicalizes internally for the safety check. So
        // assert against the original non-canonical path.
        assert_eq!(resolved, submodule.display().to_string());
    }

    #[test]
    fn override_must_be_absolute() {
        let workspace = tempfile::tempdir().unwrap();
        let err =
            resolve_script_working_dir(Some("relative/path"), Some(workspace.path()), "/repo/root")
                .expect_err("relative override must error");
        assert!(format!("{err:#}").contains("must be absolute"));
    }
}
