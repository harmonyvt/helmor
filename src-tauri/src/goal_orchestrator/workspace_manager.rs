use std::{
    collections::BTreeMap,
    path::{Component, Path, PathBuf},
    process::Command,
};

use anyhow::{bail, Context, Result};
use serde::Serialize;

use super::{config::RuntimeConfig, types::OrchestratorIssue};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePlan {
    pub issue_id: String,
    pub workspace_key: String,
    pub path: PathBuf,
    pub contained: bool,
}

#[derive(Debug, Clone)]
pub struct HookContext<'a> {
    pub goal_workspace_id: &'a str,
    pub issue: &'a OrchestratorIssue,
    pub workspace_path: Option<&'a Path>,
}

pub fn workspace_plan(config: &RuntimeConfig, issue: &OrchestratorIssue) -> Result<WorkspacePlan> {
    let workspace_key = deterministic_workspace_key(&config.workspace.key_prefix, issue);
    let path = contained_join(&config.workspace.root, &workspace_key)?;
    Ok(WorkspacePlan {
        issue_id: issue.id.clone(),
        workspace_key,
        path,
        contained: true,
    })
}

pub fn deterministic_workspace_key(prefix: &str, issue: &OrchestratorIssue) -> String {
    let raw = issue
        .identifier
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&issue.title);
    let suffix = sanitize_key(raw);
    let prefix = sanitize_key(prefix);
    if prefix.is_empty() {
        suffix
    } else if suffix.is_empty() {
        prefix
    } else {
        format!("{prefix}-{suffix}")
    }
}

pub fn sanitize_key(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.trim().chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '-'
        };
        if mapped == '-' {
            if !last_dash && !out.is_empty() {
                out.push(mapped);
                last_dash = true;
            }
        } else {
            out.push(mapped);
            last_dash = false;
        }
        if out.len() >= 64 {
            break;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

pub fn contained_join(base: &Path, child: &str) -> Result<PathBuf> {
    let child_path = Path::new(child);
    for component in child_path.components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            bail!("workspace key {child:?} escapes the configured workspace root");
        }
    }
    Ok(base.join(child_path))
}

pub fn run_hooks(hooks: &[String], context: HookContext<'_>) -> Result<()> {
    for hook in hooks {
        run_hook(hook, &context)?;
    }
    Ok(())
}

fn run_hook(hook: &str, context: &HookContext<'_>) -> Result<()> {
    let hook = hook.trim();
    if hook.is_empty() {
        return Ok(());
    }
    let mut env = BTreeMap::new();
    env.insert("HELMOR_GOAL_WORKSPACE_ID", context.goal_workspace_id);
    env.insert("HELMOR_GOAL_ISSUE_ID", context.issue.id.as_str());
    env.insert("HELMOR_GOAL_ISSUE_TITLE", context.issue.title.as_str());
    if let Some(identifier) = context.issue.identifier.as_deref() {
        env.insert("HELMOR_GOAL_ISSUE_IDENTIFIER", identifier);
    }

    let mut command = Command::new("sh");
    command.arg("-lc").arg(hook);
    if let Some(path) = context.workspace_path {
        command.current_dir(path);
    }
    for (key, value) in env {
        command.env(key, value);
    }
    let output = command
        .output()
        .with_context(|| format!("Failed to run lifecycle hook {hook:?}"))?;
    if !output.status.success() {
        bail!(
            "Lifecycle hook {hook:?} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::goal_orchestrator::types::{IssueState, TrackerKind};

    fn issue() -> OrchestratorIssue {
        OrchestratorIssue {
            id: "issue-1".to_string(),
            tracker: TrackerKind::Local,
            goal_workspace_id: "goal".to_string(),
            identifier: Some("LIN-123".to_string()),
            title: "Build API!".to_string(),
            description: None,
            state: IssueState::Backlog,
            labels: Vec::new(),
            blockers: Vec::new(),
            priority: 0,
            child_workspace_id: None,
            assigned_provider: None,
            assigned_model_id: None,
            assigned_effort_level: None,
            updated_at: None,
        }
    }

    #[test]
    fn creates_deterministic_sanitized_keys() {
        assert_eq!(
            deterministic_workspace_key("goal", &issue()),
            "goal-lin-123"
        );
    }

    #[test]
    fn rejects_path_escape() {
        assert!(contained_join(Path::new("/tmp/root"), "../x").is_err());
    }
}
