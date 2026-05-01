//! Shared serialisable types for the `forge` module.

use std::str::FromStr;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ForgeProvider {
    Github,
    Gitlab,
    Unknown,
}

impl ForgeProvider {
    pub fn as_storage_str(self) -> &'static str {
        match self {
            ForgeProvider::Github => "github",
            ForgeProvider::Gitlab => "gitlab",
            ForgeProvider::Unknown => "unknown",
        }
    }
}

impl FromStr for ForgeProvider {
    type Err = ();

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "github" => Ok(ForgeProvider::Github),
            "gitlab" => Ok(ForgeProvider::Gitlab),
            "unknown" | "" => Ok(ForgeProvider::Unknown),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForgeLabels {
    pub provider_name: String,
    pub cli_name: String,
    pub change_request_name: String,
    pub change_request_full_name: String,
    pub connect_action: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ForgeCliStatus {
    Ready {
        provider: ForgeProvider,
        host: String,
        cli_name: String,
        login: String,
        version: String,
        message: String,
    },
    Unauthenticated {
        provider: ForgeProvider,
        host: String,
        cli_name: String,
        version: Option<String>,
        message: String,
        login_command: String,
    },
    Error {
        provider: ForgeProvider,
        host: String,
        cli_name: String,
        version: Option<String>,
        message: String,
    },
}

/// Human-readable signal that the layered detector fired on. Surfaced in
/// the frontend tooltip so the user can see *why* we classified their
/// remote a given way.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetectionSignal {
    pub layer: &'static str,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForgeDetection {
    pub provider: ForgeProvider,
    pub host: Option<String>,
    pub namespace: Option<String>,
    pub repo: Option<String>,
    pub remote_url: Option<String>,
    pub labels: ForgeLabels,
    pub cli: Option<ForgeCliStatus>,
    /// Signals that led to the current provider classification — shown in
    /// the UI tooltip. Empty for `Unknown`.
    pub detection_signals: Vec<DetectionSignal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestInfo {
    pub url: String,
    pub number: i64,
    pub state: String,
    pub title: String,
    pub is_merged: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ActionStatusKind {
    Success,
    Pending,
    Running,
    Failure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ActionProvider {
    Github,
    Gitlab,
    Vercel,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteState {
    Ok,
    NoPr,
    Unauthenticated,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeActionItem {
    pub id: String,
    pub name: String,
    pub provider: ActionProvider,
    pub status: ActionStatusKind,
    pub duration: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeActionStatus {
    pub change_request: Option<ChangeRequestInfo>,
    pub review_decision: Option<String>,
    pub mergeable: Option<String>,
    pub deployments: Vec<ForgeActionItem>,
    pub checks: Vec<ForgeActionItem>,
    pub remote_state: RemoteState,
    pub message: Option<String>,
}

impl ForgeActionStatus {
    pub(crate) fn unavailable(message: impl Into<String>) -> Self {
        Self {
            change_request: None,
            review_decision: None,
            mergeable: None,
            deployments: Vec::new(),
            checks: Vec::new(),
            remote_state: RemoteState::Unavailable,
            message: Some(message.into()),
        }
    }

    pub(crate) fn unauthenticated(message: impl Into<String>) -> Self {
        Self {
            change_request: None,
            review_decision: None,
            mergeable: None,
            deployments: Vec::new(),
            checks: Vec::new(),
            remote_state: RemoteState::Unauthenticated,
            message: Some(message.into()),
        }
    }

    pub(crate) fn no_change_request() -> Self {
        Self {
            change_request: None,
            review_decision: None,
            mergeable: None,
            deployments: Vec::new(),
            checks: Vec::new(),
            remote_state: RemoteState::NoPr,
            message: None,
        }
    }

    pub(crate) fn error(message: impl Into<String>) -> Self {
        Self {
            change_request: None,
            review_decision: None,
            mergeable: None,
            deployments: Vec::new(),
            checks: Vec::new(),
            remote_state: RemoteState::Error,
            message: Some(message.into()),
        }
    }
}

/// A single comment from a PR — either the root comment of an inline review
/// thread or a general issue-style comment on the PR itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    /// Stable ID for this comment.
    ///
    /// - Inline review thread root: `"review-thread-{threadId}-comment-{dbId}"`
    /// - General PR comment: `"comment-{dbId}"`
    pub id: String,
    pub author: String,
    pub body: String,
    pub url: String,
    /// File path for inline review thread comments; `None` for general comments.
    pub file_path: Option<String>,
    /// `true` when the parent review thread has been marked resolved on GitHub.
    /// Always `false` for general PR comments (they have no resolution state).
    pub is_thread_resolved: bool,
    pub created_at: String,
}

/// All PR comments for a workspace's current branch, fetched from GitHub.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PrCommentData {
    /// Flat list of comments ordered: unresolved inline threads first, then
    /// resolved inline threads, then general comments; within each group
    /// oldest-first by `created_at`.
    pub comments: Vec<PrComment>,
    pub pr_number: Option<i64>,
    pub pr_url: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forge_provider_round_trips_through_storage_str() {
        for provider in [
            ForgeProvider::Github,
            ForgeProvider::Gitlab,
            ForgeProvider::Unknown,
        ] {
            let encoded = provider.as_storage_str();
            assert_eq!(ForgeProvider::from_str(encoded).unwrap(), provider);
        }
    }
}
