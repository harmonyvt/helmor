use super::support::*;
use crate::goal_assignees::{self, SendAssigneeMessageRequest};
use crate::pipeline::types::{CollectedTurn, MessageRole};
use serde_json::json;

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

fn insert_active_supervisor_session(connection: &Connection) {
    connection
        .execute(
            r#"
            INSERT INTO sessions (id, workspace_id, title, agent_type, status, model, permission_mode)
            VALUES ('session-supervisor', '00000000-0000-0000-0000-000000000001', 'Goal supervisor', 'pi', 'idle', 'gpt-5.4', 'default')
            "#,
            [],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE workspaces SET active_session_id = 'session-supervisor' WHERE id = '00000000-0000-0000-0000-000000000001'",
            [],
        )
        .unwrap();
}

fn insert_goal_card(connection: &Connection) {
    connection
        .execute(
            r#"
            INSERT INTO goal_cards (id, goal_workspace_id, title, lane, child_workspace_id)
            VALUES ('goal-card-assignee', '00000000-0000-0000-0000-000000000001', 'Build API', 'in-progress', '00000000-0000-0000-0000-000000000002')
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
        thread_id: None,
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
fn persisted_assignee_report_notifies_supervisor_once_with_priority_classification() {
    let _guard = TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let harness = CreateTestHarness::new();
    let connection = Connection::open(harness.db_path()).unwrap();
    insert_goal_with_child(&connection, &harness.repo_id);
    insert_active_supervisor_session(&connection);
    insert_goal_card(&connection);

    let content = json!({
        "type": "assistant",
        "message": {
            "id": "turn-report",
            "role": "assistant",
            "content": [{
                "type": "text",
                "text": "## Progress\nImplemented the storage path.\n\n## Completed\nReady for review."
            }]
        }
    });
    let turn = CollectedTurn {
        id: "assistant-report".to_string(),
        role: MessageRole::Assistant,
        content_json: content.to_string(),
    };

    crate::agents::persist_collected_turn_message(&connection, "session-assignee", &turn).unwrap();
    crate::agents::persist_collected_turn_message(&connection, "session-assignee", &turn).unwrap();

    let (notification_count, report_type): (i64, String) = connection
        .query_row(
            "SELECT COUNT(*), MAX(report_type) FROM goal_supervisor_notifications",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(notification_count, 1);
    assert_eq!(report_type, "completed");

    let supervisor_messages: Vec<String> = connection
        .prepare(
            "SELECT content FROM session_messages WHERE session_id = 'session-supervisor' ORDER BY sent_at",
        )
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(supervisor_messages.len(), 1);
    let supervisor_payload: serde_json::Value =
        serde_json::from_str(&supervisor_messages[0]).unwrap();
    assert_eq!(supervisor_payload["type"], "goal_assignee_report");
    assert_eq!(supervisor_payload["reportType"], "completed");
    assert!(supervisor_payload["message"]
        .as_str()
        .unwrap()
        .contains("## Assignee Report Received"));
    assert!(supervisor_payload["message"]
        .as_str()
        .unwrap()
        .contains("Card: Build API"));

    let last_report_id: String = connection
        .query_row(
            "SELECT last_milestone_report_id FROM sessions WHERE id = 'session-assignee'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(last_report_id, "assistant-report");
}

#[test]
fn runtime_issue_notifies_supervisor_when_no_report_was_persisted() {
    let _guard = TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let harness = CreateTestHarness::new();
    let connection = Connection::open(harness.db_path()).unwrap();
    insert_goal_with_child(&connection, &harness.repo_id);
    insert_active_supervisor_session(&connection);
    insert_goal_card(&connection);

    let notification_id = goal_assignees::notify_runtime_issue_for_session(
        "session-assignee",
        "missing_milestone_report",
        "Provider completed, but no milestone report was persisted.",
    )
    .unwrap()
    .expect("runtime issue should create a notification");
    let duplicate = goal_assignees::notify_runtime_issue_for_session(
        "session-assignee",
        "missing_milestone_report",
        "Provider completed, but no milestone report was persisted.",
    )
    .unwrap()
    .expect("existing runtime issue should be returned");
    assert_eq!(duplicate, notification_id);

    let notification_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM goal_supervisor_notifications WHERE report_type = 'runtime_issue'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(notification_count, 1);

    let supervisor_payload: String = connection
        .query_row(
            "SELECT content FROM session_messages WHERE session_id = 'session-supervisor'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let supervisor_payload: serde_json::Value = serde_json::from_str(&supervisor_payload).unwrap();
    assert_eq!(supervisor_payload["type"], "goal_assignee_runtime_issue");
    assert!(supervisor_payload["message"]
        .as_str()
        .unwrap()
        .contains("## Assignee Runtime Issue"));
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
        thread_id: None,
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
            thread_id: None,
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

#[test]
fn read_assignee_thread_resolves_goal_card_child_workspace() {
    let _guard = TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let harness = CreateTestHarness::new();
    let connection = Connection::open(harness.db_path()).unwrap();
    insert_goal_with_child(&connection, &harness.repo_id);
    let card_sql = r###"
        INSERT INTO goal_cards (id, goal_workspace_id, title, lane, child_workspace_id)
        VALUES ('goal-card-assignee', '00000000-0000-0000-0000-000000000001', 'Build API', 'in-progress', '00000000-0000-0000-0000-000000000002');
        INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at)
        VALUES (
          'card-thread-message',
          'session-assignee',
          'assistant',
          '{"type":"assistant","message":{"id":"turn-card","role":"assistant","content":[{"type":"text","text":"## Progress\nWorking from the linked card."}]}}',
          '2026-01-01T00:00:00',
          '2026-01-01T00:00:00'
        );
        "###;
    connection.execute_batch(card_sql).unwrap();

    let result =
        goal_assignees::read_assignee_thread(crate::goal_assignees::ReadAssigneeThreadRequest {
            goal_workspace_id: "00000000-0000-0000-0000-000000000001".to_string(),
            card_id: "goal-card-assignee".to_string(),
            thread_id: Some("session-assignee".to_string()),
            since_message_id: None,
        })
        .unwrap();

    assert_eq!(result.session_id, "session-assignee");
    assert_eq!(result.workspace_id, "00000000-0000-0000-0000-000000000002");
    assert_eq!(result.messages.len(), 1);
}

#[test]
fn thread_runtime_status_keeps_absolute_pi_session_paths_intact() {
    let _guard = TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let harness = CreateTestHarness::new();
    let connection = Connection::open(harness.db_path()).unwrap();
    insert_goal_with_child(&connection, &harness.repo_id);
    connection
        .execute(
            "UPDATE sessions SET provider_session_id = '/Users/harmony/.pi/agent/sessions/run.jsonl' WHERE id = 'session-assignee'",
            [],
        )
        .unwrap();

    let status = goal_assignees::get_thread_runtime_status(
        crate::goal_assignees::ThreadRuntimeStatusRequest {
            goal_workspace_id: "00000000-0000-0000-0000-000000000001".to_string(),
            workspace_id: "00000000-0000-0000-0000-000000000002".to_string(),
            thread_id: "session-assignee".to_string(),
        },
    )
    .unwrap();

    assert_eq!(
        status.provider_session_path.as_deref(),
        Some("/Users/harmony/.pi/agent/sessions/run.jsonl")
    );
    assert_eq!(status.persisted_message_count, 0);
    assert!(!status.terminal_event_seen);
}

#[test]
fn can_target_retry_thread_and_make_it_active_assignee() {
    let _guard = TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let harness = CreateTestHarness::new();
    let connection = Connection::open(harness.db_path()).unwrap();
    insert_goal_with_child(&connection, &harness.repo_id);
    connection
        .execute(
            r#"
            INSERT INTO sessions (id, workspace_id, title, agent_type, status, model, permission_mode, thread_role, thread_status)
            VALUES ('retry-session', '00000000-0000-0000-0000-000000000002', 'Retry — Build API', 'codex', 'idle', 'gpt-5.4', 'default', 'retry', 'active')
            "#,
            [],
        )
        .unwrap();

    let reassigned = goal_assignees::set_card_assignee_thread(
        crate::goal_assignees::SetCardAssigneeThreadRequest {
            goal_workspace_id: "00000000-0000-0000-0000-000000000001".to_string(),
            card_id: "00000000-0000-0000-0000-000000000002".to_string(),
            thread_id: "retry-session".to_string(),
            reason: Some("original model startup failed".to_string()),
            supersedes_thread_id: Some("session-assignee".to_string()),
        },
    )
    .unwrap();

    assert_eq!(reassigned.active_thread_id, "retry-session");
    assert_eq!(
        reassigned.superseded_thread_id.as_deref(),
        Some("session-assignee")
    );

    let result = goal_assignees::send_assignee_message(SendAssigneeMessageRequest {
        goal_workspace_id: "00000000-0000-0000-0000-000000000001".to_string(),
        card_id: "00000000-0000-0000-0000-000000000002".to_string(),
        message: "Retry with the known-good model.".to_string(),
        priority: None,
        thread_id: None,
    })
    .unwrap();

    assert_eq!(result.session_id, "retry-session");
    let active_session_id: String = connection
        .query_row(
            "SELECT active_session_id FROM workspaces WHERE id = '00000000-0000-0000-0000-000000000002'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(active_session_id, "retry-session");

    let (thread_status, stale_reason): (Option<String>, Option<String>) = connection
        .query_row(
            "SELECT thread_status, stale_reason FROM sessions WHERE id = 'session-assignee'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(thread_status.as_deref(), Some("superseded"));
    assert_eq!(
        stale_reason.as_deref(),
        Some("original model startup failed")
    );
}

#[test]
fn summarize_assignee_status_reports_stale_original_and_active_retry() {
    let _guard = TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let harness = CreateTestHarness::new();
    let connection = Connection::open(harness.db_path()).unwrap();
    insert_goal_with_child(&connection, &harness.repo_id);
    connection
        .execute(
            r#"
            INSERT INTO sessions (id, workspace_id, title, agent_type, status, model, permission_mode, thread_role, thread_status, supersedes_thread_id)
            VALUES ('retry-session', '00000000-0000-0000-0000-000000000002', 'Retry — Build API', 'codex', 'idle', 'gpt-5.4', 'default', 'assignee', 'active', 'session-assignee')
            "#,
            [],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE workspaces SET active_session_id = 'retry-session' WHERE id = '00000000-0000-0000-0000-000000000002'",
            [],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE sessions SET thread_status = 'superseded', stale_reason = 'model access failure' WHERE id = 'session-assignee'",
            [],
        )
        .unwrap();
    connection
        .execute(
            r#"INSERT INTO session_messages (id, session_id, role, content, created_at, sent_at)
               VALUES ('retry-progress', 'retry-session', 'assistant', ?1, '2026-01-01T00:10:00', '2026-01-01T00:10:00')"#,
            [r###"{"type":"assistant","message":{"id":"turn-retry","role":"assistant","content":[{"type":"text","text":"## Progress\nRetry is implementing the API."}]}}"###],
        )
        .unwrap();

    let summary = goal_assignees::summarize_assignee_status(
        crate::goal_assignees::SummarizeAssigneeStatusRequest {
            goal_workspace_id: "00000000-0000-0000-0000-000000000001".to_string(),
            card_id: "00000000-0000-0000-0000-000000000002".to_string(),
        },
    )
    .unwrap();

    assert_eq!(summary.active_thread_id, "retry-session");
    assert_eq!(summary.thread_count, 2);
    assert_eq!(summary.effective_status, "progress");
    assert_eq!(summary.stale_threads.len(), 1);
    assert_eq!(summary.stale_threads[0].thread_id, "session-assignee");
    assert_eq!(summary.stale_threads[0].reason, "model access failure");
}
