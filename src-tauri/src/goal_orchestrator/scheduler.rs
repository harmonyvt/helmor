use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock},
};

use anyhow::Result;
use serde::Serialize;

use super::{
    config::{RetryConfig, SchedulerConfig},
    types::{IssueState, OrchestratorIssue, RetryEntry, RunAttempt, RunPhase, RuntimeState},
};

#[cfg(test)]
mod tests;

static RUNTIMES: OnceLock<Mutex<HashMap<String, RuntimeState>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchPlan {
    pub issue: OrchestratorIssue,
    pub attempt_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerTick {
    pub dispatches: Vec<DispatchPlan>,
    pub skipped: usize,
    pub released: usize,
}

pub struct GoalScheduler {
    goal_workspace_id: String,
    config: SchedulerConfig,
}

impl GoalScheduler {
    pub fn for_goal(goal_workspace_id: &str, config: SchedulerConfig) -> Self {
        Self {
            goal_workspace_id: goal_workspace_id.to_string(),
            config,
        }
    }

    pub fn tick(&mut self, issues: Vec<OrchestratorIssue>) -> Result<SchedulerTick> {
        let mut runtime = runtime_snapshot(&self.goal_workspace_id);
        reconcile_completed(&mut runtime, &issues);
        let released = release_stale(&mut runtime, self.config.stale_run_seconds);

        let running_issue_ids: HashSet<String> = runtime
            .running
            .iter()
            .filter(|run| matches!(run.phase, RunPhase::Claimed | RunPhase::Running))
            .map(|run| run.issue_id.clone())
            .collect();
        let claimed: HashSet<String> = runtime.claimed.iter().cloned().collect();
        let retry_by_issue: HashMap<String, RetryEntry> = runtime
            .retries
            .iter()
            .cloned()
            .map(|entry| (entry.issue_id.clone(), entry))
            .collect();

        let mut by_state: HashMap<IssueState, usize> = HashMap::new();
        for issue in issues
            .iter()
            .filter(|issue| running_issue_ids.contains(&issue.id))
        {
            *by_state.entry(issue.state).or_default() += 1;
        }

        let mut dispatches = Vec::new();
        let mut skipped = 0;
        for issue in issues
            .into_iter()
            .filter(OrchestratorIssue::is_dispatchable)
        {
            if dispatches.len() + runtime.running.len() >= self.config.max_concurrent {
                skipped += 1;
                continue;
            }
            if claimed.contains(&issue.id) || running_issue_ids.contains(&issue.id) {
                skipped += 1;
                continue;
            }
            if retry_by_issue
                .get(&issue.id)
                .is_some_and(|entry| entry.next_retry_at > chrono::Utc::now().to_rfc3339())
            {
                skipped += 1;
                continue;
            }
            let state_limit = self
                .config
                .max_concurrent_per_state
                .get(state_key(issue.state))
                .copied()
                .unwrap_or(usize::MAX);
            let state_count = *by_state.get(&issue.state).unwrap_or(&0);
            if state_count >= state_limit {
                skipped += 1;
                continue;
            }

            let attempt_id = uuid::Uuid::new_v4().to_string();
            runtime.claimed.push(issue.id.clone());
            runtime.running.push(RunAttempt {
                attempt_id: attempt_id.clone(),
                issue_id: issue.id.clone(),
                workspace_id: None,
                session_id: None,
                phase: RunPhase::Claimed,
                started_at: chrono::Utc::now().to_rfc3339(),
                finished_at: None,
                error: None,
                provider: issue.assigned_provider.clone(),
                model: issue.assigned_model_id.clone(),
                pending_send_id: None,
            });
            *by_state.entry(issue.state).or_default() += 1;
            dispatches.push(DispatchPlan { issue, attempt_id });
        }

        runtime.updated_at = chrono::Utc::now().to_rfc3339();
        replace_runtime(runtime);
        Ok(SchedulerTick {
            dispatches,
            skipped,
            released,
        })
    }
}

pub fn runtime_snapshot(goal_workspace_id: &str) -> RuntimeState {
    let runtimes = RUNTIMES.get_or_init(|| Mutex::new(HashMap::new()));
    let runtimes = runtimes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    runtimes
        .get(goal_workspace_id)
        .cloned()
        .unwrap_or_else(|| RuntimeState::empty(goal_workspace_id))
}

pub fn record_run_started(
    goal_workspace_id: &str,
    issue_id: &str,
    workspace_id: String,
    session_id: String,
    pending_send_id: Option<String>,
) {
    mutate_runtime(goal_workspace_id, |runtime| {
        runtime.claimed.retain(|id| id != issue_id);
        if let Some(run) = runtime
            .running
            .iter_mut()
            .find(|run| run.issue_id == issue_id)
        {
            run.workspace_id = Some(workspace_id);
            run.session_id = Some(session_id);
            run.pending_send_id = pending_send_id;
            run.phase = RunPhase::Running;
        }
    });
}

pub fn record_run_failure(goal_workspace_id: &str, issue_id: &str, error: &anyhow::Error) {
    record_run_failure_with_retry(
        goal_workspace_id,
        issue_id,
        error,
        &RetryConfig {
            max_attempts: 3,
            base_backoff_seconds: 60,
            max_backoff_seconds: 15 * 60,
        },
    );
}

pub fn record_run_failure_with_retry(
    goal_workspace_id: &str,
    issue_id: &str,
    error: &anyhow::Error,
    retry: &RetryConfig,
) {
    mutate_runtime(goal_workspace_id, |runtime| {
        runtime.claimed.retain(|id| id != issue_id);
        if let Some(run) = runtime
            .running
            .iter_mut()
            .find(|run| run.issue_id == issue_id)
        {
            run.phase = RunPhase::Failed;
            run.finished_at = Some(chrono::Utc::now().to_rfc3339());
            run.error = Some(error.to_string());
        }
        let attempts = runtime
            .retries
            .iter()
            .find(|entry| entry.issue_id == issue_id)
            .map(|entry| entry.attempts.saturating_add(1))
            .unwrap_or(1)
            .min(retry.max_attempts);
        let delay = retry_delay_seconds(retry, attempts);
        runtime.retries.retain(|entry| entry.issue_id != issue_id);
        if attempts < retry.max_attempts {
            runtime.retries.push(RetryEntry {
                issue_id: issue_id.to_string(),
                attempts,
                next_retry_at: (chrono::Utc::now() + chrono::Duration::seconds(delay as i64))
                    .to_rfc3339(),
                last_error: Some(error.to_string()),
            });
        }
    });
}

fn retry_delay_seconds(retry: &RetryConfig, attempts: u32) -> u64 {
    let exponent = attempts.saturating_sub(1).min(16);
    retry
        .base_backoff_seconds
        .saturating_mul(2_u64.saturating_pow(exponent))
        .min(retry.max_backoff_seconds)
}

fn reconcile_completed(runtime: &mut RuntimeState, issues: &[OrchestratorIssue]) {
    let terminal: HashSet<String> = issues
        .iter()
        .filter(|issue| issue.state.is_terminal())
        .map(|issue| issue.id.clone())
        .collect();
    for id in terminal {
        if !runtime.completed_issue_ids.contains(&id) {
            runtime.completed_issue_ids.push(id);
        }
    }
}

fn release_stale(runtime: &mut RuntimeState, stale_run_seconds: u64) -> usize {
    let cutoff = chrono::Utc::now() - chrono::Duration::seconds(stale_run_seconds as i64);
    let mut released = 0;
    for run in &mut runtime.running {
        if matches!(run.phase, RunPhase::Claimed | RunPhase::Running)
            && chrono::DateTime::parse_from_rfc3339(&run.started_at)
                .map(|started| started.with_timezone(&chrono::Utc) < cutoff)
                .unwrap_or(false)
        {
            run.phase = RunPhase::Released;
            run.finished_at = Some(chrono::Utc::now().to_rfc3339());
            released += 1;
        }
    }
    runtime.claimed.retain(|issue_id| {
        runtime
            .running
            .iter()
            .any(|run| run.issue_id == *issue_id && run.phase == RunPhase::Claimed)
    });
    released
}

fn mutate_runtime(goal_workspace_id: &str, f: impl FnOnce(&mut RuntimeState)) {
    let mut runtime = runtime_snapshot(goal_workspace_id);
    f(&mut runtime);
    runtime.updated_at = chrono::Utc::now().to_rfc3339();
    replace_runtime(runtime);
}

fn replace_runtime(runtime: RuntimeState) {
    let runtimes = RUNTIMES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut runtimes = runtimes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    runtimes.insert(runtime.goal_workspace_id.clone(), runtime);
}

fn state_key(state: IssueState) -> &'static str {
    match state {
        IssueState::Backlog => "backlog",
        IssueState::Ready => "ready",
        IssueState::InProgress => "in-progress",
        IssueState::Review => "review",
        IssueState::Done => "done",
        IssueState::Canceled => "canceled",
        IssueState::Blocked => "blocked",
    }
}
