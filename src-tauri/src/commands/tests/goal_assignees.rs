use super::support::*;
use crate::goal_assignees::{self, SendAssigneeMessageRequest};

fn insert_goal_with_child(connection: &Connection, repo_id: &str) {
    connection
        .execute(
            r#"
            INSERT INTO workspaces (
              id, repository_id, directory_name, active_session_id, branch,
              state, initialization_parent_branch, intended_target_branch,
              status, workspace_kind, goal_workspace_id, pr_sync_state, unread,
              goal_title, goal_description
            ) VALUES (
              '00000000-0000-0000-0000-000000000001', ?1, '00000000-0000-0000-0000-000000000001', NULL, 'helmor/goal/assignees',
              'ready', 'main', 'main', 'in-progress', 'goal', NULL, 'open', 0,
              'Launch feature', 'Coordinate implementation'
            )
            "#,
            [repo_id],
        )
        .unwrap();
    connection
        .execute(
            r#"
            INSERT INTO workspaces (
              id, repository_id, directory_name, active_session_id, branch,
              state, initialization_parent_branch, intended_target_branch,
              status, workspace_kind, goal_workspace_id, pr_sync_state, unread
            ) VALUES (
              '00000000-0000-0000-0000-000000000002', ?1, '00000000-0000-0000-0000-000000000002', 'session-assignee', 'helmor/goal/child',
              'ready', 'helmor/goal/assignees', 'main', 'in-progress', 'code', '00000000-0000-0000-0000-000000000001', 'none', 0
            )
            "#,
            [repo_id],
        )
        .unwrap();
    connection
        .execute(
            r#"
            INSERT INTO sessions (id, workspace_id, title, agent_type, status, model, permission_mode)
            VALUES ('session-assignee', '00000000-0000-0000-0000-000000000002', 'Build API', 'codex', 'streaming', 'gpt-5.4', 'default')
            "#,
            [],
        )
        .unwrap();
}

#[test]
fn send_assignee_message_queues_follow_up_without_changing_lane() {
    let _guard = TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let harness = CreateTestHarness::new();
    let connection = Connection::open(harness.db_path()).unwrap();
    insert_goal_with_child(&connection, &harness.repo_id);

    let result = goal_assignees::send_assignee_message(SendAssigneeMessageRequest {
        goal_workspace_id: "00000000-0000-0000-0000-000000000001".to_string(),
        card_id: "00000000-0000-0000-0000-000000000002".to_string(),
        message: "Use the new cache API.".to_string(),
        priority: Some("high".to_string()),
    })
    .unwrap();

    assert!(result.queued);
    assert!(
        !result.started,
        "running sessions should receive a queued follow-up"
    );
    assert_eq!(result.session_id, "session-assignee");
    assert_eq!(result.workspace_id, "00000000-0000-0000-0000-000000000002");

    let (prompt, model_id, permission_mode): (String, Option<String>, Option<String>) = connection
        .query_row(
            "SELECT prompt, model_id, permission_mode FROM pending_cli_sends WHERE session_id = 'session-assignee'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert!(prompt.starts_with("Supervisor update from Goals Pi"));
    assert!(prompt.contains("Use the new cache API."));
    assert_eq!(model_id.as_deref(), Some("gpt-5.4"));
    assert_eq!(permission_mode.as_deref(), Some("default"));

    let lane: String = connection
        .query_row(
            "SELECT status FROM workspaces WHERE id = '00000000-0000-0000-0000-000000000002'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(lane, "in-progress");
}

#[test]
fn send_assignee_message_rolls_back_prompt_when_queue_insert_fails() {
    let _guard = TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let harness = CreateTestHarness::new();
    let connection = Connection::open(harness.db_path()).unwrap();
    insert_goal_with_child(&connection, &harness.repo_id);
    connection
        .execute_batch(
            r#"
            CREATE TRIGGER reject_pending_assignee_send
            BEFORE INSERT ON pending_cli_sends
            BEGIN
              SELECT RAISE(ABORT, 'pending send blocked');
            END;
            "#,
        )
        .unwrap();

    let error = goal_assignees::send_assignee_message(SendAssigneeMessageRequest {
        goal_workspace_id: "00000000-0000-0000-0000-000000000001".to_string(),
        card_id: "00000000-0000-0000-0000-000000000002".to_string(),
        message: "This should not persist without a queue row.".to_string(),
        priority: None,
    })
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("Failed to insert pending CLI send"));

    let message_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM session_messages WHERE session_id = 'session-assignee'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(message_count, 0);
}

#[test]
fn read_assignee_thread_is_limited_to_assigned_session_and_reports_marker() {
    let _guard = TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let harness = CreateTestHarness::new();
    let connection = Connection::open(harness.db_path()).unwrap();
    insert_goal_with_child(&connection, &harness.repo_id);
    connection
        .execute(
            r#"
            INSERT INTO sessions (id, workspace_id, title, agent_type, status, model, permission_mode)
            VALUES ('other-session', '00000000-0000-0000-0000-000000000002', 'Other', 'claude', 'idle', 'opus', 'default')
            "#,
            [],
        )
        .unwrap();
    connection
        .execute(
            r#"INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at)
               VALUES ('assistant-report', 'session-assignee', 'assistant', ?1, '2026-01-01T00:00:00', '2026-01-01T00:00:00')"#,
            [r###"{"type":"assistant","message":{"id":"turn-1","role":"assistant","content":[{"type":"text","text":"## Blocked\nNeed API credentials."}]}}"###],
        )
        .unwrap();
    connection
        .execute(
            r#"INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at)
               VALUES ('other-message', 'other-session', 'assistant', ?1, '2026-01-01T00:00:00', '2026-01-01T00:00:00')"#,
            [r###"{"type":"assistant","message":{"id":"turn-other","role":"assistant","content":[{"type":"text","text":"Completed: unrelated"}]}}"###],
        )
        .unwrap();

    let result =
        goal_assignees::read_assignee_thread(crate::goal_assignees::ReadAssigneeThreadRequest {
            goal_workspace_id: "00000000-0000-0000-0000-000000000001".to_string(),
            card_id: "00000000-0000-0000-0000-000000000002".to_string(),
            since_message_id: None,
        })
        .unwrap();

    assert_eq!(result.session_id, "session-assignee");
    assert_eq!(result.messages.len(), 1);
    assert_eq!(
        result
            .latest_report
            .as_ref()
            .map(|report| report.report_type.as_str()),
        Some("blocked"),
    );
}
