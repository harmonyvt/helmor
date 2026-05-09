use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::{
    agents::AgentStreamEvent,
    service::{self, SendMessageParams},
    workspace_state::WorkspaceState,
    workspace_status::WorkspaceStatus,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalChildWorkspaceCreateParams {
    pub goal_workspace: String,
    pub title: String,
    pub description: Option<String>,
    pub lane: Option<WorkspaceStatus>,
    pub target_branch: Option<String>,
    pub assigned_provider: Option<String>,
    pub assigned_model_id: Option<String>,
    pub assigned_effort_level: Option<String>,
    pub prompt: Option<String>,
    pub permission_mode: Option<String>,
    pub finalize: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalChildWorkspaceCreateResult {
    pub workspace_id: String,
    pub directory_name: String,
    pub directory: Option<String>,
    pub branch: String,
    pub session_id: String,
    pub state: WorkspaceState,
    pub status: WorkspaceStatus,
    pub intended_target_branch: String,
    pub prompt_queued: bool,
    pub agent_started: bool,
    pub pending_send_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
}

pub fn create_goal_child_workspace_and_start(
    params: GoalChildWorkspaceCreateParams,
    on_event: &mut dyn FnMut(&AgentStreamEvent),
) -> Result<GoalChildWorkspaceCreateResult> {
    let goal_workspace_id = service::resolve_workspace_ref(&params.goal_workspace)?;
    let title = params.title.trim();
    if title.is_empty() {
        bail!("Goal child title is required");
    }
    let prompt = params
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if prompt.is_some() && params.finalize == Some(false) {
        bail!("Cannot start a Goal child prompt without finalizing the worktree");
    }

    let prepared = crate::workspaces::create_goal_child_workspace(
        crate::workspaces::GoalChildWorkspaceRequest {
            goal_workspace_id,
            goal_card_id: None,
            title: Some(title.to_string()),
            description: params.description.clone(),
            lane: params.lane,
            target_branch: params.target_branch.clone(),
            assigned_provider: params.assigned_provider.clone(),
            assigned_model_id: params.assigned_model_id.clone(),
            assigned_effort_level: params.assigned_effort_level.clone(),
        },
    )?;

    let mut state = prepared.state;
    if params.finalize.unwrap_or(true) {
        let finalized = crate::workspaces::finalize_workspace_from_repo_with_options_impl(
            &prepared.workspace_id,
            crate::workspaces::FinalizeWorkspaceOptions {
                start_branch: prepared.source_start_branch.clone(),
                fetch_start_branch: Some(true),
                migrate_from_path: None,
            },
        )?;
        state = finalized.final_state;
    }

    let detail = service::get_workspace(&prepared.workspace_id)?;
    let mut prompt_queued = false;
    let mut agent_started = false;
    let mut pending_send_id = None;
    let mut provider = None;
    let mut model = params.assigned_model_id.clone();

    if let Some(prompt) = prompt {
        let send_result = service::send_message(
            SendMessageParams {
                workspace_ref: prepared.workspace_id.clone(),
                session_id: Some(prepared.initial_session_id.clone()),
                prompt: prompt.to_string(),
                model: params.assigned_model_id.clone(),
                permission_mode: params.permission_mode.clone(),
                linked_directories: Vec::new(),
                delegate_to_running_app: true,
            },
            on_event,
        )?;
        prompt_queued = send_result.queued;
        agent_started = send_result.agent_started;
        pending_send_id = send_result.pending_send_id;
        provider = Some(send_result.provider);
        model = Some(send_result.model);
    }

    Ok(GoalChildWorkspaceCreateResult {
        workspace_id: prepared.workspace_id,
        directory_name: prepared.directory_name,
        directory: detail.root_path,
        branch: prepared.branch,
        session_id: prepared.initial_session_id,
        state,
        status: prepared.status,
        intended_target_branch: prepared.intended_target_branch,
        prompt_queued,
        agent_started,
        pending_send_id,
        provider,
        model,
    })
}
