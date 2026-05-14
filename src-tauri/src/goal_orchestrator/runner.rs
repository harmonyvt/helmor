use anyhow::Result;

use crate::{
    goal_orchestration::{GoalChildWorkspaceCreateParams, PreparedGoalChildStart},
    service::SendMessageParams,
    workspace_status::WorkspaceStatus,
};

use super::{
    config::RuntimeConfig,
    types::{IssueState, OrchestratorIssue},
    workspace_manager,
};

#[derive(Debug)]
pub(crate) struct PreparedRun {
    pub issue_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub send_params: Option<SendMessageParams>,
}

pub struct HelmorGoalRunner {
    config: RuntimeConfig,
    workflow_prompt: String,
}

impl HelmorGoalRunner {
    pub fn new(config: RuntimeConfig, workflow_prompt: String) -> Self {
        Self {
            config,
            workflow_prompt,
        }
    }

    pub(crate) fn prepare(&self, issue: &OrchestratorIssue) -> Result<PreparedRun> {
        let params = self.build_params(issue);
        let PreparedGoalChildStart {
            result,
            send_params,
        } = crate::goal_orchestration::prepare_goal_child_workspace_start(params)?;
        let workspace_path = result.directory.as_deref().map(std::path::Path::new);
        let hook_context = workspace_manager::HookContext {
            goal_workspace_id: &issue.goal_workspace_id,
            issue,
            workspace_path,
        };
        workspace_manager::run_hooks(&self.config.hooks.after_create, hook_context.clone())?;
        workspace_manager::run_hooks(&self.config.hooks.before_run, hook_context)?;
        Ok(PreparedRun {
            issue_id: issue.id.clone(),
            workspace_id: result.workspace_id,
            session_id: result.session_id,
            send_params,
        })
    }

    fn build_params(&self, issue: &OrchestratorIssue) -> GoalChildWorkspaceCreateParams {
        GoalChildWorkspaceCreateParams {
            goal_workspace: issue.goal_workspace_id.clone(),
            title: issue.title.clone(),
            description: issue.description.clone(),
            lane: Some(state_to_status(issue.state)),
            target_branch: self.config.workspace.target_branch.clone(),
            assigned_provider: issue
                .assigned_provider
                .clone()
                .or_else(|| self.config.agent.provider.clone()),
            assigned_model_id: issue
                .assigned_model_id
                .clone()
                .or_else(|| self.config.agent.model_id.clone()),
            assigned_effort_level: issue
                .assigned_effort_level
                .clone()
                .or_else(|| self.config.agent.effort_level.clone()),
            prompt: Some(build_prompt(issue, &self.workflow_prompt)),
            permission_mode: self.config.agent.permission_mode.clone(),
            finalize: Some(self.config.workspace.finalize),
        }
    }
}

pub fn build_prompt(issue: &OrchestratorIssue, workflow_prompt: &str) -> String {
    let mut prompt = Vec::new();
    prompt.push("## Work item".to_string());
    if let Some(identifier) = issue.identifier.as_deref() {
        prompt.push(format!("Identifier: {identifier}"));
    }
    prompt.push(format!("Title: {}", issue.title));
    if let Some(description) = issue.description.as_deref() {
        prompt.push(format!("Description:\n{description}"));
    }
    if !issue.labels.is_empty() {
        prompt.push(format!("Labels: {}", issue.labels.join(", ")));
    }
    prompt.push("## Workflow".to_string());
    prompt.push(workflow_prompt.trim().to_string());
    prompt.join("\n\n")
}

pub fn plan_workspace(config: &RuntimeConfig, issue: &OrchestratorIssue) -> Result<String> {
    Ok(workspace_manager::workspace_plan(config, issue)?
        .path
        .display()
        .to_string())
}

fn state_to_status(state: IssueState) -> WorkspaceStatus {
    match state {
        IssueState::Backlog | IssueState::Ready | IssueState::Blocked => WorkspaceStatus::Backlog,
        IssueState::InProgress => WorkspaceStatus::InProgress,
        IssueState::Review => WorkspaceStatus::Review,
        IssueState::Done => WorkspaceStatus::Done,
        IssueState::Canceled => WorkspaceStatus::Canceled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::goal_orchestrator::types::TrackerKind;

    #[test]
    fn prompt_includes_issue_and_workflow() {
        let issue = OrchestratorIssue {
            id: "i".to_string(),
            tracker: TrackerKind::Local,
            goal_workspace_id: "goal".to_string(),
            identifier: Some("CARD-1".to_string()),
            title: "Do it".to_string(),
            description: Some("Details".to_string()),
            state: IssueState::Backlog,
            labels: vec!["backend".to_string()],
            blockers: Vec::new(),
            priority: 0,
            child_workspace_id: None,
            assigned_provider: None,
            assigned_model_id: None,
            assigned_effort_level: None,
            updated_at: None,
        };

        let prompt = build_prompt(&issue, "Follow repo rules.");
        assert!(prompt.contains("CARD-1"));
        assert!(prompt.contains("Follow repo rules."));
    }
}
