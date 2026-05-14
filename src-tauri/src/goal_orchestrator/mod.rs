//! Symphony-oriented Goals orchestration primitives.
//!
//! Phase 1 intentionally keeps this module side-effect free: it defines the
//! repository-owned workflow contract, typed config view, and normalized domain
//! types without changing existing Goal board behavior.

pub mod config;
pub mod runner;
pub mod scheduler;
pub mod telemetry;
pub mod tracker;
pub mod types;
pub mod workflow;
pub mod workspace_manager;

use anyhow::{Context, Result};
use serde::Serialize;

use self::{
    config::{RetryConfig, RuntimeConfig},
    runner::{HelmorGoalRunner, PreparedRun},
    scheduler::GoalScheduler,
    telemetry::GoalOrchestratorStatus,
    tracker::{IssueTracker, LocalGoalTracker},
    workflow::WorkflowDocument,
};

#[derive(Debug)]
pub(crate) struct PreparedTick {
    pub status: GoalOrchestratorStatus,
    pub prepared_runs: Vec<PreparedRun>,
    pub skipped: usize,
    pub released: usize,
    pub retry: RetryConfig,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickSummary {
    pub goal_workspace_id: String,
    pub dispatched: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
    pub status: GoalOrchestratorStatus,
}

pub(crate) fn load_status(goal_workspace_id: &str) -> Result<GoalOrchestratorStatus> {
    let loaded = load_parts(goal_workspace_id)?;
    let runtime = scheduler::runtime_snapshot(goal_workspace_id);
    Ok(GoalOrchestratorStatus::from_parts(
        goal_workspace_id,
        loaded.workflow.as_ref(),
        &loaded.config,
        loaded.issues,
        runtime,
        loaded.errors,
    ))
}

pub(crate) fn prepare_tick(goal_workspace_id: &str) -> Result<PreparedTick> {
    let loaded = load_parts(goal_workspace_id)?;
    let mut scheduler = GoalScheduler::for_goal(goal_workspace_id, loaded.config.scheduler.clone());
    let tick = scheduler.tick(loaded.issues.clone())?;
    let runner = HelmorGoalRunner::new(loaded.config.clone(), loaded.prompt_body.clone());
    let mut prepared_runs = Vec::new();
    let mut errors = loaded.errors;

    for dispatch in &tick.dispatches {
        match runner.prepare(&dispatch.issue) {
            Ok(run) => prepared_runs.push(run),
            Err(error) => {
                errors.push(format!(
                    "{}: {error:#}",
                    dispatch
                        .issue
                        .identifier
                        .as_deref()
                        .unwrap_or(&dispatch.issue.id)
                ));
                scheduler::record_run_failure_with_retry(
                    goal_workspace_id,
                    &dispatch.issue.id,
                    &error,
                    &loaded.config.scheduler.retry,
                );
            }
        }
    }

    let status = GoalOrchestratorStatus::from_parts(
        goal_workspace_id,
        loaded.workflow.as_ref(),
        &loaded.config,
        loaded.issues,
        scheduler::runtime_snapshot(goal_workspace_id),
        errors,
    );

    Ok(PreparedTick {
        status,
        prepared_runs,
        skipped: tick.skipped,
        released: tick.released,
        retry: loaded.config.scheduler.retry,
    })
}

pub(crate) fn tick_summary(
    goal_workspace_id: String,
    dispatched: usize,
    skipped: usize,
    status: GoalOrchestratorStatus,
    errors: Vec<String>,
) -> TickSummary {
    TickSummary {
        goal_workspace_id,
        dispatched,
        skipped,
        errors,
        status,
    }
}

struct LoadedParts {
    workflow: Option<WorkflowDocument>,
    config: RuntimeConfig,
    prompt_body: String,
    issues: Vec<types::OrchestratorIssue>,
    errors: Vec<String>,
}

fn load_parts(goal_workspace_id: &str) -> Result<LoadedParts> {
    let goal = crate::models::workspaces::load_goal_workspace_record(goal_workspace_id)?;
    let workflow = goal
        .root_path
        .as_deref()
        .and_then(|root| workflow::try_load_workflow(root).transpose())
        .transpose()
        .context("Failed to load WORKFLOW.md")?;
    let workflow_dir = goal
        .root_path
        .as_deref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    let mut errors = Vec::new();
    let mut config = match RuntimeConfig::from_workflow(workflow.as_ref(), &workflow_dir) {
        Ok(config) => config,
        Err(error) => {
            errors.push(error.to_string());
            RuntimeConfig::default_for_goal(goal_workspace_id)
        }
    };
    config.goal_workspace_id = goal_workspace_id.to_string();
    if let Err(error) = config.validate_for_dispatch() {
        errors.push(error.to_string());
    }
    let tracker = LocalGoalTracker::new(goal_workspace_id.to_string());
    let issues = tracker.fetch_issues()?;
    Ok(LoadedParts {
        prompt_body: workflow
            .as_ref()
            .map(|workflow| workflow.prompt_body.clone())
            .unwrap_or_else(|| config.agent.default_prompt.clone()),
        workflow,
        config,
        issues,
        errors,
    })
}
