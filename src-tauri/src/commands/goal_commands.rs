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
    source_start_branch: Option<String>,
) -> CmdResult<workspaces::FinalizeGoalWorkspaceResponse> {
    let result = run_blocking(move || {
        workspaces::finalize_goal_workspace(
            &workspace_id,
            &description,
            source_start_branch.as_deref(),
        )
    })
    .await?;
    notify_workspace_changed_in_background(app);
    Ok(result)
}

#[tauri::command]
pub async fn convert_workspace_to_goal(
    app: AppHandle,
    workspace_id: String,
) -> CmdResult<workspaces::ConvertWorkspaceToGoalResponse> {
    let result = run_blocking(move || workspaces::convert_workspace_to_goal(&workspace_id)).await?;
    ui_sync::publish(&app, UiMutationEvent::WorkspaceListChanged);
    ui_sync::publish(
        &app,
        UiMutationEvent::WorkspaceChanged {
            workspace_id: result.workspace_id.clone(),
        },
    );
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
    let prepared = run_blocking(move || {
        crate::goal_orchestration::prepare_goal_child_workspace_start(request)
    })
    .await?;
    let mut result = prepared.result;
    if let Some(send_params) = prepared.send_params {
        let receipt = crate::background_agents::enqueue(app.clone(), send_params)?;
        result.agent_started = receipt.started;
        result.prompt_queued = true;
        result.background_send_id = Some(receipt.task_id);
    }
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
pub async fn send_assignee_message(
    app: AppHandle,
    request: crate::goal_assignees::SendAssigneeMessageRequest,
) -> CmdResult<crate::goal_assignees::SendAssigneeMessageResult> {
    let goal_workspace_id = request.goal_workspace_id.clone();
    let prepared =
        run_blocking(move || crate::goal_assignees::prepare_assignee_message(request)).await?;
    let mut result = prepared.result;
    let receipt = crate::background_agents::enqueue(app.clone(), prepared.send_params)?;
    result.started = receipt.started;
    result.pending_send_id = receipt.task_id;
    result.execution_state = receipt.execution_state.to_string();
    publish_goal_child_workspace_changes(
        &app,
        goal_workspace_id,
        Some(result.workspace_id.clone()),
    );
    Ok(result)
}

#[tauri::command]
pub async fn send_thread_message(
    app: AppHandle,
    request: crate::goal_assignees::SendThreadMessageRequest,
) -> CmdResult<crate::goal_assignees::SendAssigneeMessageResult> {
    let goal_workspace_id = request.goal_workspace_id.clone();
    let prepared =
        run_blocking(move || crate::goal_assignees::prepare_thread_message(request)).await?;
    let mut result = prepared.result;
    let receipt = crate::background_agents::enqueue(app.clone(), prepared.send_params)?;
    result.started = receipt.started;
    result.pending_send_id = receipt.task_id;
    result.execution_state = receipt.execution_state.to_string();
    publish_goal_child_workspace_changes(
        &app,
        goal_workspace_id,
        Some(result.workspace_id.clone()),
    );
    Ok(result)
}

#[tauri::command]
pub async fn set_card_assignee_thread(
    app: AppHandle,
    request: crate::goal_assignees::SetCardAssigneeThreadRequest,
) -> CmdResult<crate::goal_assignees::SetCardAssigneeThreadResult> {
    let goal_workspace_id = request.goal_workspace_id.clone();
    let result =
        run_blocking(move || crate::goal_assignees::set_card_assignee_thread(request)).await?;
    publish_goal_child_workspace_changes(
        &app,
        goal_workspace_id,
        Some(result.workspace_id.clone()),
    );
    Ok(result)
}

#[tauri::command]
pub async fn read_assignee_thread(
    request: crate::goal_assignees::ReadAssigneeThreadRequest,
) -> CmdResult<crate::goal_assignees::AssigneeThreadResult> {
    run_blocking(move || crate::goal_assignees::read_assignee_thread(request)).await
}

#[tauri::command]
pub async fn summarize_assignee_status(
    request: crate::goal_assignees::SummarizeAssigneeStatusRequest,
) -> CmdResult<crate::goal_assignees::AssigneeStatusSummary> {
    run_blocking(move || crate::goal_assignees::summarize_assignee_status(request)).await
}

#[tauri::command]
pub async fn list_assignees(
    request: crate::goal_assignees::ListAssigneesRequest,
) -> CmdResult<Vec<crate::goal_assignees::AssigneeSummary>> {
    run_blocking(move || crate::goal_assignees::list_assignees(request)).await
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

#[tauri::command]
pub async fn assign_workspace_to_goal(
    app: AppHandle,
    request: workspaces::AssignWorkspaceToGoalRequest,
) -> CmdResult<()> {
    let goal_workspace_id = request.goal_workspace_id.clone();
    let workspace_id = request.workspace_id.clone();
    run_blocking(move || workspaces::assign_workspace_to_goal(request)).await?;
    publish_goal_child_workspace_changes(&app, goal_workspace_id, Some(workspace_id));
    Ok(())
}
