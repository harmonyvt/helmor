use tauri::AppHandle;

use crate::{git_watcher, orca_import};

use super::common::{run_blocking, CmdResult};

#[tauri::command]
pub fn orca_source_available() -> bool {
    orca_import::orca_source_available()
}

#[tauri::command]
pub async fn list_orca_repos() -> CmdResult<Vec<orca_import::OrcaRepo>> {
    run_blocking(orca_import::list_orca_repos).await
}

#[tauri::command]
pub async fn list_orca_workspaces(repo_id: String) -> CmdResult<Vec<orca_import::OrcaWorkspace>> {
    run_blocking(move || orca_import::list_orca_workspaces(&repo_id)).await
}

#[tauri::command]
pub async fn import_orca_workspaces(
    app: AppHandle,
    workspace_ids: Vec<String>,
) -> CmdResult<orca_import::ImportOrcaWorkspacesResult> {
    let result = run_blocking(move || orca_import::import_orca_workspaces(&workspace_ids)).await?;
    git_watcher::notify_workspace_changed(&app);
    Ok(result)
}
