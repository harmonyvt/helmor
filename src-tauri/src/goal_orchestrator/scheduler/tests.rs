use super::*;

fn issue(id: &str) -> OrchestratorIssue {
    OrchestratorIssue {
        id: id.to_string(),
        tracker: super::super::types::TrackerKind::Local,
        goal_workspace_id: "goal".to_string(),
        identifier: None,
        title: id.to_string(),
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
fn enforces_global_concurrency() {
    let mut scheduler = GoalScheduler::for_goal(
        "scheduler-test-global",
        SchedulerConfig {
            max_concurrent: 1,
            max_concurrent_per_state: Default::default(),
            retry: super::super::config::RetryConfig {
                max_attempts: 3,
                base_backoff_seconds: 1,
                max_backoff_seconds: 10,
            },
            stale_run_seconds: 600,
        },
    );

    let tick = scheduler.tick(vec![issue("a"), issue("b")]).unwrap();
    assert_eq!(tick.dispatches.len(), 1);
    assert_eq!(tick.skipped, 1);
}

#[test]
fn retry_delay_uses_exponential_backoff_cap() {
    let retry = super::super::config::RetryConfig {
        max_attempts: 5,
        base_backoff_seconds: 10,
        max_backoff_seconds: 25,
    };

    assert_eq!(retry_delay_seconds(&retry, 1), 10);
    assert_eq!(retry_delay_seconds(&retry, 2), 20);
    assert_eq!(retry_delay_seconds(&retry, 3), 25);
}
