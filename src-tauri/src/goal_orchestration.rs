use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::{
    agents::AgentStreamEvent,
    service::{self, SendMessageParams},
    workspace_state::WorkspaceState,
    workspace_status::WorkspaceStatus,
};

const MIN_AUTO_START_PROMPT_CHARS: usize = 20;
const TRUNCATED_PROMPT_ERROR: &str =
    "create_kanban_card rejected: prompt appears truncated. Please retry with full assignee brief.";

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
    pub background_send_id: Option<String>,
    pub assignee_prompt: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
}

pub(crate) struct PreparedGoalChildStart {
    pub result: GoalChildWorkspaceCreateResult,
    pub send_params: Option<SendMessageParams>,
}

pub(crate) fn prepare_goal_child_workspace_start(
    params: GoalChildWorkspaceCreateParams,
) -> Result<PreparedGoalChildStart> {
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
    if let Some(prompt) = prompt {
        validate_auto_start_prompt(prompt, params.description.as_deref())?;
    }
    if prompt.is_some() && params.finalize == Some(false) {
        bail!("Cannot start a Goal child prompt without finalizing the worktree");
    }
    let goal_detail = service::get_workspace(&goal_workspace_id)?;

    let prepared = crate::workspaces::create_goal_child_workspace(
        crate::workspaces::GoalChildWorkspaceRequest {
            goal_workspace_id: goal_workspace_id.clone(),
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
    let mut result = GoalChildWorkspaceCreateResult {
        workspace_id: prepared.workspace_id.clone(),
        directory_name: prepared.directory_name.clone(),
        directory: detail.root_path,
        branch: prepared.branch.clone(),
        session_id: prepared.initial_session_id.clone(),
        state,
        status: prepared.status,
        intended_target_branch: prepared.intended_target_branch.clone(),
        prompt_queued: prompt.is_some(),
        agent_started: false,
        pending_send_id: None,
        background_send_id: None,
        assignee_prompt: None,
        provider: params.assigned_provider.clone(),
        model: params.assigned_model_id.clone(),
    };

    let send_params = prompt.map(|prompt| {
        let assigned_name = params
            .assigned_provider
            .as_deref()
            .or(params.assigned_model_id.as_deref());
        let prompt = crate::goal_assignees::assignee_bootstrap_prompt(
            crate::goal_assignees::AssigneeBootstrapPromptInput {
                goal_title: goal_detail.goal_title.as_deref(),
                goal_description: goal_detail.goal_description.as_deref(),
                card_title: title,
                card_description: params.description.as_deref(),
                assigned_name,
                workspace_id: &prepared.workspace_id,
                branch: &prepared.branch,
                initial_task: prompt,
            },
        );
        result.assignee_prompt = Some(prompt.clone());
        SendMessageParams {
            workspace_ref: prepared.workspace_id,
            session_id: Some(prepared.initial_session_id),
            prompt,
            model: params.assigned_model_id.clone(),
            permission_mode: params.permission_mode.clone(),
            linked_directories: Vec::new(),
            delegate_to_running_app: true,
        }
    });

    if send_params.is_none() {
        result.prompt_queued = false;
    }

    Ok(PreparedGoalChildStart {
        result,
        send_params,
    })
}

fn validate_auto_start_prompt(prompt: &str, description: Option<&str>) -> Result<()> {
    let has_description = description
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    if !has_description && prompt.chars().count() < MIN_AUTO_START_PROMPT_CHARS {
        bail!(TRUNCATED_PROMPT_ERROR);
    }
    Ok(())
}

pub fn create_goal_child_workspace_and_start(
    params: GoalChildWorkspaceCreateParams,
    on_event: &mut dyn FnMut(&AgentStreamEvent),
) -> Result<GoalChildWorkspaceCreateResult> {
    let PreparedGoalChildStart {
        mut result,
        send_params,
    } = prepare_goal_child_workspace_start(params)?;

    if let Some(send_params) = send_params {
        let send_result = service::send_message(send_params, on_event)?;
        result.prompt_queued = send_result.queued;
        result.agent_started = send_result.agent_started;
        result.pending_send_id = send_result.pending_send_id;
        result.provider = Some(send_result.provider);
        result.model = Some(send_result.model);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_likely_truncated_auto_start_prompt_without_description() {
        let error = validate_auto_start_prompt("You are cap", None).unwrap_err();

        assert_eq!(error.to_string(), TRUNCATED_PROMPT_ERROR);
    }

    #[test]
    fn allows_short_prompt_when_card_description_carries_context() {
        validate_auto_start_prompt("Fix it", Some("Implement the auth callback flow")).unwrap();
    }

    #[test]
    fn allows_complete_prompt_without_description() {
        validate_auto_start_prompt("Implement the auth callback flow.", None).unwrap();
    }
}
