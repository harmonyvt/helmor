use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::{types::TrackerKind, workflow::WorkflowDocument};
use raw::WorkflowConfigFrontMatter;

mod raw;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfig {
    pub goal_workspace_id: String,
    pub tracker: TrackerConfig,
    pub polling: PollingConfig,
    pub scheduler: SchedulerConfig,
    pub workspace: WorkspaceConfig,
    pub hooks: LifecycleHooks,
    pub agent: AgentConfig,
    pub codex: CodexConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerConfig {
    #[serde(rename = "type")]
    pub kind: TrackerKind,
    pub project: Option<String>,
    pub api_token_env: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollingConfig {
    pub enabled: bool,
    pub interval_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerConfig {
    pub max_concurrent: usize,
    pub max_concurrent_per_state: BTreeMap<String, usize>,
    pub retry: RetryConfig,
    pub stale_run_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub base_backoff_seconds: u64,
    pub max_backoff_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    pub root: PathBuf,
    pub key_prefix: String,
    pub finalize: bool,
    pub target_branch: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleHooks {
    pub after_create: Vec<String>,
    pub before_run: Vec<String>,
    pub after_run: Vec<String>,
    pub before_remove: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub provider: Option<String>,
    pub model_id: Option<String>,
    pub effort_level: Option<String>,
    pub permission_mode: Option<String>,
    pub default_prompt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConfig {
    pub app_server_url: Option<String>,
    pub use_app_server: bool,
}

impl RuntimeConfig {
    pub fn default_for_goal(goal_workspace_id: &str) -> Self {
        Self::from_raw(
            goal_workspace_id,
            WorkflowConfigFrontMatter::default(),
            &std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        )
        .expect("default goal orchestrator config must resolve")
    }

    pub fn from_workflow(workflow: Option<&WorkflowDocument>, workflow_dir: &Path) -> Result<Self> {
        let raw: WorkflowConfigFrontMatter = match workflow {
            Some(workflow) => serde_yaml::from_value(workflow.front_matter.clone())
                .context("Invalid Symphony workflow configuration")?,
            None => WorkflowConfigFrontMatter::default(),
        };
        Self::from_raw("", raw, workflow_dir)
    }

    fn from_raw(
        goal_workspace_id: &str,
        raw: WorkflowConfigFrontMatter,
        workflow_dir: &Path,
    ) -> Result<Self> {
        let root = raw
            .workspace
            .root
            .as_deref()
            .map(resolve_env)
            .transpose()?
            .map(PathBuf::from)
            .unwrap_or_else(|| workflow_dir.to_path_buf());
        let root = if root.is_absolute() {
            root
        } else {
            workflow_dir.join(root)
        };

        Ok(Self {
            goal_workspace_id: goal_workspace_id.to_string(),
            tracker: TrackerConfig {
                kind: raw.tracker.kind,
                project: raw
                    .tracker
                    .project
                    .map(trim_to_string)
                    .filter(|s| !s.is_empty()),
                api_token_env: raw
                    .tracker
                    .api_token_env
                    .map(trim_to_string)
                    .filter(|s| !s.is_empty()),
            },
            polling: PollingConfig {
                enabled: raw.polling.enabled.unwrap_or(false),
                interval_seconds: raw.polling.interval_seconds.unwrap_or(60),
            },
            scheduler: SchedulerConfig {
                max_concurrent: raw.scheduler.max_concurrent.unwrap_or(2),
                max_concurrent_per_state: raw.scheduler.max_concurrent_per_state,
                retry: RetryConfig {
                    max_attempts: raw.scheduler.retry.max_attempts.unwrap_or(3),
                    base_backoff_seconds: raw.scheduler.retry.base_backoff_seconds.unwrap_or(60),
                    max_backoff_seconds: raw.scheduler.retry.max_backoff_seconds.unwrap_or(15 * 60),
                },
                stale_run_seconds: raw.scheduler.stale_run_seconds.unwrap_or(30 * 60),
            },
            workspace: WorkspaceConfig {
                root,
                key_prefix: raw
                    .workspace
                    .key_prefix
                    .map(trim_to_string)
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "goal".to_string()),
                finalize: raw.workspace.finalize.unwrap_or(true),
                target_branch: raw
                    .workspace
                    .target_branch
                    .map(trim_to_string)
                    .filter(|s| !s.is_empty()),
            },
            hooks: raw.hooks,
            agent: AgentConfig {
                provider: raw
                    .agent
                    .provider
                    .map(trim_to_string)
                    .filter(|s| !s.is_empty()),
                model_id: raw
                    .agent
                    .model_id
                    .map(trim_to_string)
                    .filter(|s| !s.is_empty()),
                effort_level: raw
                    .agent
                    .effort_level
                    .map(trim_to_string)
                    .filter(|s| !s.is_empty()),
                permission_mode: raw
                    .agent
                    .permission_mode
                    .map(trim_to_string)
                    .filter(|s| !s.is_empty()),
                default_prompt: raw.agent.default_prompt.unwrap_or_default(),
            },
            codex: CodexConfig {
                app_server_url: raw
                    .codex
                    .app_server_url
                    .map(trim_to_string)
                    .filter(|s| !s.is_empty()),
                use_app_server: raw.codex.use_app_server.unwrap_or(false),
            },
        })
    }

    pub fn validate_for_dispatch(&self) -> Result<()> {
        if self.polling.enabled && self.polling.interval_seconds == 0 {
            bail!("polling.intervalSeconds must be greater than zero");
        }
        if self.scheduler.max_concurrent == 0 {
            bail!("scheduler.maxConcurrent must be greater than zero");
        }
        if self.scheduler.retry.max_attempts == 0 {
            bail!("scheduler.retry.maxAttempts must be greater than zero");
        }
        if self.scheduler.retry.base_backoff_seconds > self.scheduler.retry.max_backoff_seconds {
            bail!("scheduler.retry.baseBackoffSeconds cannot exceed maxBackoffSeconds");
        }
        if matches!(
            self.tracker.kind,
            TrackerKind::Linear | TrackerKind::Github | TrackerKind::Jira
        ) && self.tracker.api_token_env.is_none()
        {
            bail!("external trackers require tracker.apiTokenEnv");
        }
        if let Some(env_name) = self.tracker.api_token_env.as_deref() {
            if matches!(
                self.tracker.kind,
                TrackerKind::Linear | TrackerKind::Github | TrackerKind::Jira
            ) && std::env::var(env_name)
                .ok()
                .filter(|v| !v.trim().is_empty())
                .is_none()
            {
                bail!("tracker.apiTokenEnv references unset environment variable {env_name}");
            }
        }
        if self.codex.use_app_server && self.codex.app_server_url.is_none() {
            bail!("codex.useAppServer requires codex.appServerUrl");
        }
        Ok(())
    }
}

fn trim_to_string(value: String) -> String {
    value.trim().to_string()
}

fn resolve_env(value: &str) -> Result<String> {
    let mut out = String::new();
    let chars: Vec<char> = value.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '$' && chars.get(i + 1) == Some(&'{') {
            let start = i + 2;
            let mut end = start;
            while end < chars.len() && chars[end] != '}' {
                end += 1;
            }
            if end == chars.len() {
                bail!("Unclosed environment placeholder in {value:?}");
            }
            let name: String = chars[start..end].iter().collect();
            out.push_str(
                &std::env::var(&name)
                    .with_context(|| format!("Environment variable {name} is not set"))?,
            );
            i = end + 1;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    Ok(out)
}
