use tauri::AppHandle;

use crate::{git_watcher, workspaces};

use super::common::{run_blocking, CmdResult};

fn notify_workspace_changed_in_background(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            git_watcher::notify_workspace_changed(&app);
        })
        .await;
    });
}

#[tauri::command]
pub async fn prepare_goal_workspace(
    app: AppHandle,
    request: workspaces::PrepareGoalWorkspaceRequest,
) -> CmdResult<workspaces::PrepareGoalWorkspaceResponse> {
    let result = run_blocking(move || workspaces::prepare_goal_workspace(request)).await?;
    notify_workspace_changed_in_background(app);
    Ok(result)
}

#[tauri::command]
pub async fn finalize_goal_workspace(
    app: AppHandle,
    workspace_id: String,
    description: String,
) -> CmdResult<workspaces::FinalizeGoalWorkspaceResponse> {
    let result =
        run_blocking(move || workspaces::finalize_goal_workspace(&workspace_id, &description))
            .await?;
    notify_workspace_changed_in_background(app);
    Ok(result)
}

#[tauri::command]
pub async fn list_goal_cards(workspace_id: String) -> CmdResult<Vec<workspaces::GoalCard>> {
    run_blocking(move || workspaces::list_goal_cards(&workspace_id)).await
}

#[tauri::command]
pub async fn upsert_goal_card(
    input: workspaces::UpsertGoalCardInput,
) -> CmdResult<workspaces::GoalCard> {
    run_blocking(move || workspaces::upsert_goal_card(input)).await
}

#[tauri::command]
pub async fn link_goal_card_workspace(
    goal_card_id: String,
    workspace_id: String,
) -> CmdResult<workspaces::GoalCard> {
    run_blocking(move || workspaces::link_goal_card_workspace(&goal_card_id, &workspace_id)).await
}

#[tauri::command]
pub async fn create_goal_child_workspace(
    app: AppHandle,
    request: workspaces::GoalChildWorkspaceRequest,
) -> CmdResult<workspaces::PrepareWorkspaceResponse> {
    let result = run_blocking(move || workspaces::create_goal_child_workspace(request)).await?;
    notify_workspace_changed_in_background(app);
    Ok(result)
}
