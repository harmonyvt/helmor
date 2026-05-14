use std::collections::BTreeMap;

use serde::Deserialize;

use super::LifecycleHooks;
use crate::goal_orchestrator::types::TrackerKind;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct WorkflowConfigFrontMatter {
    pub(super) tracker: RawTrackerConfig,
    pub(super) polling: RawPollingConfig,
    pub(super) scheduler: RawSchedulerConfig,
    pub(super) workspace: RawWorkspaceConfig,
    pub(super) hooks: LifecycleHooks,
    pub(super) agent: RawAgentConfig,
    pub(super) codex: RawCodexConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct RawTrackerConfig {
    #[serde(rename = "type")]
    pub(super) kind: TrackerKind,
    pub(super) project: Option<String>,
    pub(super) api_token_env: Option<String>,
}

impl Default for RawTrackerConfig {
    fn default() -> Self {
        Self {
            kind: TrackerKind::Local,
            project: None,
            api_token_env: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct RawPollingConfig {
    pub(super) enabled: Option<bool>,
    pub(super) interval_seconds: Option<u64>,
}

impl Default for RawPollingConfig {
    fn default() -> Self {
        Self {
            enabled: Some(false),
            interval_seconds: Some(60),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct RawSchedulerConfig {
    pub(super) max_concurrent: Option<usize>,
    pub(super) max_concurrent_per_state: BTreeMap<String, usize>,
    pub(super) retry: RawRetryConfig,
    pub(super) stale_run_seconds: Option<u64>,
}

impl Default for RawSchedulerConfig {
    fn default() -> Self {
        Self {
            max_concurrent: Some(2),
            max_concurrent_per_state: BTreeMap::new(),
            retry: RawRetryConfig::default(),
            stale_run_seconds: Some(30 * 60),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct RawRetryConfig {
    pub(super) max_attempts: Option<u32>,
    pub(super) base_backoff_seconds: Option<u64>,
    pub(super) max_backoff_seconds: Option<u64>,
}

impl Default for RawRetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: Some(3),
            base_backoff_seconds: Some(60),
            max_backoff_seconds: Some(15 * 60),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct RawWorkspaceConfig {
    pub(super) root: Option<String>,
    pub(super) key_prefix: Option<String>,
    pub(super) finalize: Option<bool>,
    pub(super) target_branch: Option<String>,
}

impl Default for RawWorkspaceConfig {
    fn default() -> Self {
        Self {
            root: None,
            key_prefix: Some("goal".to_string()),
            finalize: Some(true),
            target_branch: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct RawAgentConfig {
    pub(super) provider: Option<String>,
    pub(super) model_id: Option<String>,
    pub(super) effort_level: Option<String>,
    pub(super) permission_mode: Option<String>,
    pub(super) default_prompt: Option<String>,
}

impl Default for RawAgentConfig {
    fn default() -> Self {
        Self {
            provider: None,
            model_id: None,
            effort_level: None,
            permission_mode: None,
            default_prompt: Some(
                "Work this issue to completion. Report blockers and final status in the thread."
                    .to_string(),
            ),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct RawCodexConfig {
    pub(super) app_server_url: Option<String>,
    pub(super) use_app_server: Option<bool>,
}

impl Default for RawCodexConfig {
    fn default() -> Self {
        Self {
            app_server_url: None,
            use_app_server: Some(false),
        }
    }
}
