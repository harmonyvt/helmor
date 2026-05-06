use tauri::AppHandle;

use crate::{
    git_watcher,
    ui_sync::{self, UiMutationEvent},
    workspaces,
};

use super::common::{run_blocking, CmdResult};

fn notify_workspace_changed_in_background(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            git_watcher::notify_workspace_changed(&app);
        })
        .await;
    });
}

fn publish_goal_child_workspace_changes(
    app: &AppHandle,
    goal_workspace_id: String,
    child_workspace_id: Option<String>,
) {
    ui_sync::publish(app, UiMutationEvent::WorkspaceListChanged);
    ui_sync::publish(
        app,
        UiMutationEvent::WorkspaceChanged {
            workspace_id: goal_workspace_id,
        },
    );
    if let Some(workspace_id) = child_workspace_id {
        ui_sync::publish(app, UiMutationEvent::WorkspaceChanged { workspace_id });
    }
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
    let goal_workspace_id = request.goal_workspace_id.clone();
    let result = run_blocking(move || workspaces::create_goal_child_workspace(request)).await?;
    publish_goal_child_workspace_changes(
        &app,
        goal_workspace_id,
        Some(result.workspace_id.clone()),
    );
    notify_workspace_changed_in_background(app);
    Ok(result)
}

#[tauri::command]
pub async fn create_goal_child_workspace_and_start(
    app: AppHandle,
    request: crate::goal_orchestration::GoalChildWorkspaceCreateParams,
) -> CmdResult<crate::goal_orchestration::GoalChildWorkspaceCreateResult> {
    let goal_workspace_ref = request.goal_workspace.clone();
    let result = run_blocking(move || {
        fn ignore_event(_: &crate::agents::AgentStreamEvent) {}
        let mut on_event = ignore_event;
        crate::goal_orchestration::create_goal_child_workspace_and_start(request, &mut on_event)
    })
    .await?;
    let goal_workspace_id =
        crate::service::resolve_workspace_ref(&goal_workspace_ref).unwrap_or(goal_workspace_ref);
    publish_goal_child_workspace_changes(
        &app,
        goal_workspace_id,
        Some(result.workspace_id.clone()),
    );
    notify_workspace_changed_in_background(app);
    Ok(result)
}

#[tauri::command]
pub async fn set_goal_child_workspace_status(
    app: AppHandle,
    request: workspaces::GoalChildWorkspaceStatusRequest,
) -> CmdResult<()> {
    let goal_workspace_id = request.goal_workspace_id.clone();
    let child_workspace_id = request.child_workspace_id.clone();
    run_blocking(move || workspaces::set_goal_child_workspace_status(request)).await?;
    publish_goal_child_workspace_changes(&app, goal_workspace_id, Some(child_workspace_id));
    Ok(())
}
