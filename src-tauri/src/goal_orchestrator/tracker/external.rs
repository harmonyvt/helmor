use serde::{Deserialize, Serialize};

use super::super::types::{IssueState, OrchestratorIssue, TrackerKind};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalIssueInput {
    pub external_id: String,
    pub key: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub labels: Vec<String>,
    pub blockers: Vec<String>,
    pub priority: Option<i64>,
    pub updated_at: Option<String>,
}

pub trait ExternalTrackerAdapter {
    fn kind(&self) -> TrackerKind;
    fn normalize(&self, goal_workspace_id: &str, input: ExternalIssueInput) -> OrchestratorIssue;
}

#[derive(Debug, Clone, Copy)]
pub struct LinearAdapter;

#[derive(Debug, Clone, Copy)]
pub struct GithubIssuesAdapter;

#[derive(Debug, Clone, Copy)]
pub struct JiraAdapter;

impl ExternalTrackerAdapter for LinearAdapter {
    fn kind(&self) -> TrackerKind {
        TrackerKind::Linear
    }

    fn normalize(&self, goal_workspace_id: &str, input: ExternalIssueInput) -> OrchestratorIssue {
        normalize_external_issue(self.kind(), goal_workspace_id, input, linear_state)
    }
}

impl ExternalTrackerAdapter for GithubIssuesAdapter {
    fn kind(&self) -> TrackerKind {
        TrackerKind::Github
    }

    fn normalize(&self, goal_workspace_id: &str, input: ExternalIssueInput) -> OrchestratorIssue {
        normalize_external_issue(self.kind(), goal_workspace_id, input, github_state)
    }
}

impl ExternalTrackerAdapter for JiraAdapter {
    fn kind(&self) -> TrackerKind {
        TrackerKind::Jira
    }

    fn normalize(&self, goal_workspace_id: &str, input: ExternalIssueInput) -> OrchestratorIssue {
        normalize_external_issue(self.kind(), goal_workspace_id, input, jira_state)
    }
}

fn normalize_external_issue(
    tracker: TrackerKind,
    goal_workspace_id: &str,
    input: ExternalIssueInput,
    state_mapper: fn(&str) -> IssueState,
) -> OrchestratorIssue {
    OrchestratorIssue {
        id: format!("{tracker:?}:{}", input.external_id),
        tracker,
        goal_workspace_id: goal_workspace_id.to_string(),
        identifier: input.key,
        title: input.title,
        description: input.description,
        state: state_mapper(&input.state),
        labels: input.labels,
        blockers: input.blockers,
        priority: input.priority.unwrap_or(0),
        child_workspace_id: None,
        assigned_provider: None,
        assigned_model_id: None,
        assigned_effort_level: None,
        updated_at: input.updated_at,
    }
}

fn linear_state(value: &str) -> IssueState {
    match normalized(value).as_str() {
        "backlog" | "triage" => IssueState::Backlog,
        "todo" | "ready" => IssueState::Ready,
        "started" | "inprogress" | "in-progress" => IssueState::InProgress,
        "review" | "inreview" => IssueState::Review,
        "done" | "completed" => IssueState::Done,
        "canceled" | "cancelled" => IssueState::Canceled,
        "blocked" => IssueState::Blocked,
        _ => IssueState::Backlog,
    }
}

fn github_state(value: &str) -> IssueState {
    match normalized(value).as_str() {
        "closed" | "done" => IssueState::Done,
        "blocked" => IssueState::Blocked,
        _ => IssueState::Backlog,
    }
}

fn jira_state(value: &str) -> IssueState {
    match normalized(value).as_str() {
        "selectedfordevelopment" | "todo" => IssueState::Ready,
        "inprogress" | "in-progress" => IssueState::InProgress,
        "inreview" | "review" => IssueState::Review,
        "done" => IssueState::Done,
        "canceled" | "cancelled" => IssueState::Canceled,
        "blocked" => IssueState::Blocked,
        _ => IssueState::Backlog,
    }
}

fn normalized(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_adapter_normalizes_started_issue() {
        let issue = LinearAdapter.normalize(
            "goal-1",
            ExternalIssueInput {
                external_id: "abc".to_string(),
                key: Some("LIN-1".to_string()),
                title: "Build".to_string(),
                description: None,
                state: "Started".to_string(),
                labels: vec!["backend".to_string()],
                blockers: Vec::new(),
                priority: Some(3),
                updated_at: None,
            },
        );

        assert_eq!(issue.tracker, TrackerKind::Linear);
        assert_eq!(issue.state, IssueState::InProgress);
        assert_eq!(issue.identifier.as_deref(), Some("LIN-1"));
    }
}
