use serde::{Deserialize, Serialize};

use super::{
    config::RuntimeConfig,
    types::{OrchestratorIssue, RuntimeState},
    workflow::WorkflowDocument,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalOrchestratorStatus {
    pub goal_workspace_id: String,
    pub workflow_loaded: bool,
    pub workflow_path: Option<String>,
    pub tracker_type: String,
    pub polling_enabled: bool,
    pub max_concurrent: usize,
    pub issue_count: usize,
    pub dispatchable_count: usize,
    pub running_count: usize,
    pub retry_count: usize,
    pub completed_count: usize,
    pub issues: Vec<OrchestratorIssue>,
    pub runtime: RuntimeState,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorStatusEvent {
    pub goal_workspace_id: String,
    pub status: GoalOrchestratorStatus,
}

impl GoalOrchestratorStatus {
    pub fn from_parts(
        goal_workspace_id: &str,
        workflow: Option<&WorkflowDocument>,
        config: &RuntimeConfig,
        issues: Vec<OrchestratorIssue>,
        runtime: RuntimeState,
        mut errors: Vec<String>,
    ) -> Self {
        errors.extend(runtime.config_errors.clone());
        Self {
            goal_workspace_id: goal_workspace_id.to_string(),
            workflow_loaded: workflow.is_some(),
            workflow_path: workflow.map(|workflow| workflow.source_path.clone()),
            tracker_type: format!("{:?}", config.tracker.kind).to_ascii_lowercase(),
            polling_enabled: config.polling.enabled,
            max_concurrent: config.scheduler.max_concurrent,
            issue_count: issues.len(),
            dispatchable_count: issues
                .iter()
                .filter(|issue| issue.is_dispatchable())
                .count(),
            running_count: runtime
                .running
                .iter()
                .filter(|run| {
                    matches!(
                        run.phase,
                        super::types::RunPhase::Claimed | super::types::RunPhase::Running
                    )
                })
                .count(),
            retry_count: runtime.retries.len(),
            completed_count: runtime.completed_issue_ids.len(),
            issues,
            runtime,
            errors,
        }
    }
}
