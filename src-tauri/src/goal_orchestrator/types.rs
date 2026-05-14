use serde::{Deserialize, Serialize};

use crate::workspace_status::WorkspaceStatus;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrackerKind {
    #[default]
    Local,
    Linear,
    Github,
    Jira,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IssueState {
    Backlog,
    Ready,
    InProgress,
    Review,
    Done,
    Canceled,
    Blocked,
}

impl IssueState {
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Done | Self::Canceled)
    }

    pub const fn is_dispatchable(self) -> bool {
        matches!(self, Self::Backlog | Self::Ready)
    }
}

impl From<WorkspaceStatus> for IssueState {
    fn from(status: WorkspaceStatus) -> Self {
        match status {
            WorkspaceStatus::Backlog => Self::Backlog,
            WorkspaceStatus::InProgress => Self::InProgress,
            WorkspaceStatus::Review => Self::Review,
            WorkspaceStatus::Done => Self::Done,
            WorkspaceStatus::Canceled => Self::Canceled,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorIssue {
    pub id: String,
    pub tracker: TrackerKind,
    pub goal_workspace_id: String,
    pub identifier: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub state: IssueState,
    pub labels: Vec<String>,
    pub blockers: Vec<String>,
    pub priority: i64,
    pub child_workspace_id: Option<String>,
    pub assigned_provider: Option<String>,
    pub assigned_model_id: Option<String>,
    pub assigned_effort_level: Option<String>,
    pub updated_at: Option<String>,
}

impl OrchestratorIssue {
    pub fn is_dispatchable(&self) -> bool {
        self.state.is_dispatchable()
            && self.child_workspace_id.is_none()
            && self.blockers.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBinding {
    pub issue_id: String,
    pub workspace_id: String,
    pub workspace_key: String,
    pub directory: Option<String>,
    pub branch: Option<String>,
    pub state: String,
    pub status: WorkspaceStatus,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunPhase {
    Claimed,
    Running,
    Succeeded,
    Failed,
    Released,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAttempt {
    pub attempt_id: String,
    pub issue_id: String,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub phase: RunPhase,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub error: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub pending_send_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryEntry {
    pub issue_id: String,
    pub attempts: u32,
    pub next_retry_at: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionState {
    pub workspace_id: String,
    pub session_id: String,
    pub status: String,
    pub pending_send_id: Option<String>,
    pub last_event_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateSnapshot {
    pub provider: String,
    pub remaining_tokens: Option<i64>,
    pub reset_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeState {
    pub goal_workspace_id: String,
    pub running: Vec<RunAttempt>,
    pub claimed: Vec<String>,
    pub retries: Vec<RetryEntry>,
    pub completed_issue_ids: Vec<String>,
    pub live_sessions: Vec<LiveSessionState>,
    pub token_snapshot: Option<RateSnapshot>,
    pub config_errors: Vec<String>,
    pub updated_at: String,
}

impl RuntimeState {
    pub fn empty(goal_workspace_id: impl Into<String>) -> Self {
        Self {
            goal_workspace_id: goal_workspace_id.into(),
            running: Vec::new(),
            claimed: Vec::new(),
            retries: Vec::new(),
            completed_issue_ids: Vec::new(),
            live_sessions: Vec::new(),
            token_snapshot: None,
            config_errors: Vec::new(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}
