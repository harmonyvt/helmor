use tauri::{AppHandle, State};

use crate::{
    knowledge::{
        KnowledgeIndexResult, KnowledgeQueryRequest, KnowledgeQueryResult, KnowledgeSidecarManager,
        KnowledgeStatus, RecordGoalKnowledgeNoteRequest,
    },
    ui_sync::{self, UiMutationEvent},
};

use super::common::CmdResult;

#[tauri::command]
pub async fn get_knowledge_status(
    manager: State<'_, KnowledgeSidecarManager>,
) -> CmdResult<KnowledgeStatus> {
    manager.status().map_err(Into::into)
}

#[tauri::command]
pub async fn reindex_project_knowledge(
    app: AppHandle,
    manager: State<'_, KnowledgeSidecarManager>,
    repo_id: String,
) -> CmdResult<KnowledgeIndexResult> {
    let result = manager.index_project(&repo_id)?;
    ui_sync::publish(
        &app,
        UiMutationEvent::KnowledgeChanged {
            repo_id: Some(repo_id),
            goal_workspace_id: None,
        },
    );
    Ok(result)
}

#[tauri::command]
pub async fn reindex_goal_knowledge(
    app: AppHandle,
    manager: State<'_, KnowledgeSidecarManager>,
    goal_workspace_id: String,
) -> CmdResult<KnowledgeIndexResult> {
    let result = manager.index_goal(&goal_workspace_id)?;
    ui_sync::publish(
        &app,
        UiMutationEvent::KnowledgeChanged {
            repo_id: None,
            goal_workspace_id: Some(goal_workspace_id),
        },
    );
    Ok(result)
}

#[tauri::command]
pub async fn query_knowledge(
    manager: State<'_, KnowledgeSidecarManager>,
    request: KnowledgeQueryRequest,
) -> CmdResult<KnowledgeQueryResult> {
    manager.query(request).map_err(Into::into)
}

#[tauri::command]
pub async fn record_goal_knowledge_note(
    app: AppHandle,
    manager: State<'_, KnowledgeSidecarManager>,
    request: RecordGoalKnowledgeNoteRequest,
) -> CmdResult<KnowledgeIndexResult> {
    let goal_workspace_id = request.goal_workspace_id.clone();
    let repo_id = request.repo_id.clone();
    let result = manager.record_goal_note(request)?;
    ui_sync::publish(
        &app,
        UiMutationEvent::KnowledgeChanged {
            repo_id,
            goal_workspace_id: Some(goal_workspace_id),
        },
    );
    Ok(result)
}
