/// Pi Kanban / Thread / Assignee / Merge tool handlers — executed entirely in
/// the backend without a frontend round-trip.
///
/// Every tool call from the Pi supervisor that is NOT `delegate_agent` is
/// routed here by the streaming event loop instead of being forwarded to the
/// frontend via `AgentStreamEvent::KanbanToolCall`.  The result is sent back
/// to the sidecar with `send_pi_tool_result` exactly as the delegation path
/// does.
///
/// # Adding a new tool
/// 1. Add a match arm in `execute_pi_tool_call`.
/// 2. Write a `handle_<tool>` function.
/// 3. Call `publish_board_changed` / `publish_workspace_changed` as needed.
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::future::Future;
use std::str::FromStr;
use tauri::AppHandle;

use crate::ui_sync::{self, UiMutationEvent};
use crate::workspace_status::WorkspaceStatus;

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

fn block_on_pi_tool_db<T>(future: impl Future<Output = Result<T>>) -> Result<T> {
    let handle = tokio::runtime::Handle::try_current()
        .context("Pi tool DB access requires an active Tokio runtime")?;
    tokio::task::block_in_place(|| handle.block_on(future))
}

/// Dispatch a Pi custom tool call to the appropriate handler.
///
/// Returns `Ok(value)` on success (the JSON result to send back to Pi) or
/// `Err(...)` on failure (the caller turns it into an is_error result).
pub(super) fn execute_pi_tool_call(
    app: AppHandle,
    tool: &str,
    args: &Value,
    goal_workspace_id: &str,
) -> Result<Value> {
    tracing::debug!(tool, goal_workspace_id, "execute_pi_tool_call");
    match tool {
        // ── Board ─────────────────────────────────────────────────────────────
        "list_kanban_cards" => handle_list_kanban_cards(goal_workspace_id),
        "create_kanban_card" => handle_create_kanban_card(&app, goal_workspace_id, args),
        "move_kanban_card" => handle_move_kanban_card(&app, goal_workspace_id, args),
        "update_kanban_card" => handle_update_kanban_card(&app, goal_workspace_id, args),
        "list_assignee_models" => super::pi_assignee_models::handle_list_assignee_models(),
        // ── Thread management ─────────────────────────────────────────────────
        "list_threads" => handle_list_threads(args),
        "create_thread" => handle_create_thread(&app, args),
        "get_thread" => handle_get_thread(goal_workspace_id, args),
        "update_thread" => handle_update_thread(args),
        "delete_thread" => handle_delete_thread(args),
        "send_thread_message" => handle_send_thread_message(app, goal_workspace_id, args),
        // ── Assignee coordination ─────────────────────────────────────────────
        "send_assignee_message" => handle_send_assignee_message(app, goal_workspace_id, args),
        "set_card_assignee_thread" => {
            handle_set_card_assignee_thread(&app, goal_workspace_id, args)
        }
        "read_assignee_thread" => handle_read_assignee_thread(goal_workspace_id, args),
        "summarize_assignee_status" => handle_summarize_assignee_status(goal_workspace_id, args),
        "list_assignees" => handle_list_assignees(goal_workspace_id, args),
        // ── Merge / landing ───────────────────────────────────────────────────
        "inspect_workspace_merge_state" => handle_inspect_workspace_merge_state(args),
        "refresh_change_request" => handle_refresh_change_request(&app, args),
        "sync_workspace_target_branch" => handle_sync_workspace_target_branch(&app, args),
        "push_workspace_branch" => handle_push_workspace_branch(&app, args),
        "merge_change_request" => handle_merge_change_request(&app, args),
        "check_workspace_landed" => handle_check_workspace_landed(&app, args),
        "mark_workspace_landed" => handle_mark_workspace_landed(&app, args),
        _ => anyhow::bail!("Unknown Pi tool: {tool}"),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Board tools
// ─────────────────────────────────────────────────────────────────────────────

fn handle_list_kanban_cards(goal_workspace_id: &str) -> Result<Value> {
    let workspaces = crate::workspaces::list_goal_child_workspaces(goal_workspace_id)?;
    let cards: Vec<Value> = workspaces
        .iter()
        .map(|ws| {
            let lane = if ws.landing_state == crate::workspace_landing::LandingState::Landed {
                "merged".to_string()
            } else {
                ws.status.to_string()
            };
            json!({
                "id": ws.id,
                "title": ws.title,
                "lane": lane,
                "branch": ws.branch,
                "prUrl": ws.pr_url,
                "prSyncState": serde_json::to_value(ws.pr_sync_state).ok(),
                "landingState": ws.landing_state.as_str(),
                "landingSource": ws.landing_source.as_ref().map(|s| format!("{s:?}").to_lowercase()),
                "sessionCount": ws.session_count,
                "activeSessionId": ws.active_session_id,
                "activeSessionStatus": ws.active_session_status,
                "activeSessionAgentType": ws.active_session_agent_type,
            })
        })
        .collect();
    Ok(json!(cards))
}

fn handle_create_kanban_card(
    app: &AppHandle,
    goal_workspace_id: &str,
    args: &Value,
) -> Result<Value> {
    let title = req_str(args, "title")?;
    let lane = args
        .get("lane")
        .and_then(Value::as_str)
        .map(WorkspaceStatus::from_str)
        .transpose()
        .map_err(|e| anyhow::anyhow!("Invalid lane: {e}"))?;

    let params = crate::goal_orchestration::GoalChildWorkspaceCreateParams {
        goal_workspace: goal_workspace_id.to_string(),
        title: title.to_string(),
        description: opt_str(args, "description"),
        lane,
        target_branch: opt_str(args, "targetBranch"),
        assigned_provider: opt_str(args, "assignedProvider"),
        assigned_model_id: opt_str(args, "assignedModelId"),
        assigned_effort_level: opt_str(args, "assignedEffortLevel"),
        prompt: opt_str(args, "prompt"),
        permission_mode: opt_str(args, "permissionMode"),
        finalize: args.get("finalize").and_then(Value::as_bool),
    };

    let prepared = crate::goal_orchestration::prepare_goal_child_workspace_start(params)?;
    if let Some(send_params) = prepared.send_params {
        crate::background_agents::enqueue(app.clone(), send_params)?;
    }

    publish_board_changed(app, goal_workspace_id, &prepared.result.workspace_id);

    Ok(serde_json::to_value(&prepared.result)?)
}

fn handle_move_kanban_card(
    app: &AppHandle,
    goal_workspace_id: &str,
    args: &Value,
) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    let lane_str = req_str(args, "lane")?;

    if lane_str == "merged" {
        anyhow::bail!(
            "Cannot move a card to the 'merged' lane directly. \
             Use merge/landing tools to land a workspace into the goal branch."
        );
    }

    let status = WorkspaceStatus::from_str(lane_str).map_err(|_| {
        anyhow::anyhow!(
            "Invalid lane '{}'. Valid lanes: backlog, in-progress, review, done, canceled",
            lane_str
        )
    })?;

    crate::workspaces::set_goal_child_workspace_status(
        crate::workspaces::GoalChildWorkspaceStatusRequest {
            goal_workspace_id: goal_workspace_id.to_string(),
            child_workspace_id: card_id.to_string(),
            status,
        },
    )?;

    publish_board_changed(app, goal_workspace_id, card_id);

    Ok(json!({ "success": true, "cardId": card_id, "lane": lane_str }))
}

fn handle_update_kanban_card(
    app: &AppHandle,
    goal_workspace_id: &str,
    args: &Value,
) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    let new_title = args.get("title").and_then(Value::as_str);

    if new_title.is_none() {
        // Nothing to update — return success without touching the DB.
        return Ok(json!({ "success": true, "cardId": card_id, "changed": false }));
    }

    if let Some(title) = new_title {
        let title = title.trim();
        if title.is_empty() {
            anyhow::bail!("title cannot be empty");
        }
        let card_id = card_id.to_string();
        let goal_workspace_id = goal_workspace_id.to_string();
        let title = title.to_string();
        block_on_pi_tool_db(crate::models::db::libsql_write_async(
            |connection| async move {
                connection
                    .execute(
                        "UPDATE workspaces \
                         SET pr_title = ?2, updated_at = datetime('now') \
                         WHERE id = ?1 AND goal_workspace_id = ?3",
                        libsql::params![card_id, title, goal_workspace_id],
                    )
                    .await
                    .context("Failed to update card title")?;
                Ok(())
            },
        ))?;
    }

    publish_board_changed(app, goal_workspace_id, card_id);

    Ok(json!({ "success": true, "cardId": card_id, "changed": true }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Thread tools
// ─────────────────────────────────────────────────────────────────────────────

fn handle_list_threads(args: &Value) -> Result<Value> {
    let workspace_id = req_str(args, "workspaceId")?;
    let sessions = crate::sessions::list_workspace_sessions(workspace_id)?;
    let threads: Vec<Value> = sessions
        .iter()
        .map(|s| {
            json!({
                "id": s.id,
                "workspaceId": s.workspace_id,
                "title": s.title,
                "status": s.status,
                "agentType": s.agent_type,
                "model": s.model,
                "permissionMode": s.permission_mode,
                "createdAt": s.created_at,
                "updatedAt": s.updated_at,
                "lastUserMessageAt": s.last_user_message_at,
                "threadRole": s.thread_role,
                "threadStatus": s.thread_status,
                "active": s.active,
            })
        })
        .collect();
    Ok(json!(threads))
}

fn handle_create_thread(app: &AppHandle, args: &Value) -> Result<Value> {
    let workspace_id = req_str(args, "workspaceId")?;
    let title = args.get("title").and_then(Value::as_str);
    let model_id = args
        .get("modelId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let permission_mode = args
        .get("permissionMode")
        .and_then(Value::as_str)
        .map(str::to_string);

    let response = crate::sessions::create_session(workspace_id, None, permission_mode.as_deref())?;
    let session_id = &response.session_id;

    if let Some(t) = title {
        let _ = crate::sessions::rename_session(session_id, t);
    }

    if let Some(model) = model_id.as_deref() {
        // Best-effort model assignment on the newly created session.
        let session_id = session_id.to_string();
        let model = model.to_string();
        let _ = block_on_pi_tool_db(crate::models::db::libsql_write_async(
            |connection| async move {
                connection
                    .execute(
                        "UPDATE sessions SET model = ?2 WHERE id = ?1",
                        libsql::params![session_id, model],
                    )
                    .await?;
                Ok(())
            },
        ));
    }

    ui_sync::publish(
        app,
        UiMutationEvent::SessionListChanged {
            workspace_id: workspace_id.to_string(),
        },
    );

    Ok(json!({
        "sessionId": session_id,
        "workspaceId": workspace_id,
    }))
}

fn handle_get_thread(goal_workspace_id: &str, args: &Value) -> Result<Value> {
    let workspace_id = req_str(args, "workspaceId")?;
    let thread_id = req_str(args, "threadId")?;
    let since_message_id = args
        .get("sinceMessageId")
        .and_then(Value::as_str)
        .map(str::to_string);

    let request = crate::goal_assignees::ReadAssigneeThreadRequest {
        goal_workspace_id: goal_workspace_id.to_string(),
        card_id: workspace_id.to_string(),
        thread_id: Some(thread_id.to_string()),
        since_message_id,
    };
    let result = crate::goal_assignees::read_assignee_thread(request)?;
    Ok(serde_json::to_value(&result)?)
}

fn handle_update_thread(args: &Value) -> Result<Value> {
    let thread_id = req_str(args, "threadId")?;
    let title = req_str(args, "title")?;

    crate::sessions::rename_session(thread_id, title)?;

    Ok(json!({ "success": true, "threadId": thread_id }))
}

fn handle_delete_thread(args: &Value) -> Result<Value> {
    let thread_id = req_str(args, "threadId")?;
    crate::sessions::delete_session(thread_id)?;
    Ok(json!({ "success": true, "threadId": thread_id }))
}

fn handle_send_thread_message(
    app: AppHandle,
    goal_workspace_id: &str,
    args: &Value,
) -> Result<Value> {
    let workspace_id = req_str(args, "workspaceId")?;
    let thread_id = req_str(args, "threadId")?;
    let message = req_str(args, "message")?;

    let request = crate::goal_assignees::SendThreadMessageRequest {
        goal_workspace_id: goal_workspace_id.to_string(),
        workspace_id: workspace_id.to_string(),
        thread_id: thread_id.to_string(),
        message: message.to_string(),
        priority: args
            .get("priority")
            .and_then(Value::as_str)
            .map(str::to_string),
        model_id: args
            .get("modelId")
            .and_then(Value::as_str)
            .map(str::to_string),
        permission_mode: args
            .get("permissionMode")
            .and_then(Value::as_str)
            .map(str::to_string),
    };

    let mut prepared = crate::goal_assignees::prepare_thread_message(request)?;
    let receipt = crate::background_agents::enqueue_assignee(
        app.clone(),
        prepared.send_params,
        prepared.goal_workspace_id.clone(),
        prepared.run_id,
    )?;
    prepared.result.started = receipt.started;
    prepared.result.run_id = receipt.task_id;
    prepared.result.execution_state = receipt.execution_state.to_string();
    let result_value = serde_json::to_value(&prepared.result)?;

    ui_sync::publish(
        &app,
        UiMutationEvent::GoalOrchestratorStateChanged {
            goal_workspace_id: goal_workspace_id.to_string(),
        },
    );

    Ok(result_value)
}

// ─────────────────────────────────────────────────────────────────────────────
// Assignee tools
// ─────────────────────────────────────────────────────────────────────────────

fn handle_send_assignee_message(
    app: AppHandle,
    goal_workspace_id: &str,
    args: &Value,
) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    let message = req_str(args, "message")?;

    let request = crate::goal_assignees::SendAssigneeMessageRequest {
        goal_workspace_id: goal_workspace_id.to_string(),
        card_id: card_id.to_string(),
        message: message.to_string(),
        priority: args
            .get("priority")
            .and_then(Value::as_str)
            .map(str::to_string),
        thread_id: args
            .get("threadId")
            .and_then(Value::as_str)
            .map(str::to_string),
    };

    let mut prepared = crate::goal_assignees::prepare_assignee_message(request)?;
    let receipt = crate::background_agents::enqueue_assignee(
        app.clone(),
        prepared.send_params,
        prepared.goal_workspace_id.clone(),
        prepared.run_id,
    )?;
    prepared.result.started = receipt.started;
    prepared.result.run_id = receipt.task_id;
    prepared.result.execution_state = receipt.execution_state.to_string();
    let result_value = serde_json::to_value(&prepared.result)?;

    ui_sync::publish(
        &app,
        UiMutationEvent::GoalOrchestratorStateChanged {
            goal_workspace_id: goal_workspace_id.to_string(),
        },
    );

    Ok(result_value)
}

fn handle_set_card_assignee_thread(
    app: &AppHandle,
    goal_workspace_id: &str,
    args: &Value,
) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    let thread_id = req_str(args, "threadId")?;

    let request = crate::goal_assignees::SetCardAssigneeThreadRequest {
        goal_workspace_id: goal_workspace_id.to_string(),
        card_id: card_id.to_string(),
        thread_id: thread_id.to_string(),
        reason: args
            .get("reason")
            .and_then(Value::as_str)
            .map(str::to_string),
        supersedes_thread_id: args
            .get("supersedesThreadId")
            .and_then(Value::as_str)
            .map(str::to_string),
    };

    let result = crate::goal_assignees::set_card_assignee_thread(request)?;

    ui_sync::publish(
        app,
        UiMutationEvent::GoalOrchestratorStateChanged {
            goal_workspace_id: goal_workspace_id.to_string(),
        },
    );

    Ok(serde_json::to_value(&result)?)
}

fn handle_read_assignee_thread(goal_workspace_id: &str, args: &Value) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    let request = crate::goal_assignees::ReadAssigneeThreadRequest {
        goal_workspace_id: goal_workspace_id.to_string(),
        card_id: card_id.to_string(),
        thread_id: args
            .get("threadId")
            .and_then(Value::as_str)
            .map(str::to_string),
        since_message_id: args
            .get("sinceMessageId")
            .and_then(Value::as_str)
            .map(str::to_string),
    };
    let result = crate::goal_assignees::read_assignee_thread(request)?;
    Ok(serde_json::to_value(&result)?)
}

fn handle_summarize_assignee_status(goal_workspace_id: &str, args: &Value) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    let request = crate::goal_assignees::SummarizeAssigneeStatusRequest {
        goal_workspace_id: goal_workspace_id.to_string(),
        card_id: card_id.to_string(),
    };
    let result = crate::goal_assignees::summarize_assignee_status(request)?;
    Ok(serde_json::to_value(&result)?)
}

fn handle_list_assignees(goal_workspace_id: &str, args: &Value) -> Result<Value> {
    let request = crate::goal_assignees::ListAssigneesRequest {
        goal_workspace_id: goal_workspace_id.to_string(),
        status: args
            .get("status")
            .and_then(Value::as_str)
            .map(str::to_string),
    };
    let result = crate::goal_assignees::list_assignees(request)?;
    Ok(serde_json::to_value(&result)?)
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge / landing tools
// ─────────────────────────────────────────────────────────────────────────────

fn handle_inspect_workspace_merge_state(args: &Value) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    let change_request = crate::forge::refresh_workspace_change_request(card_id)?;
    let action_status = crate::forge::lookup_workspace_forge_action_status(card_id)?;
    Ok(json!({
        "cardId": card_id,
        "changeRequest": change_request,
        "actionStatus": serde_json::to_value(&action_status).ok(),
    }))
}

fn handle_refresh_change_request(app: &AppHandle, args: &Value) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    let change_request = crate::forge::refresh_workspace_change_request(card_id)?;
    let changed = crate::workspaces::sync_workspace_pr_state(card_id, change_request.as_ref())?;
    if changed {
        ui_sync::publish(
            app,
            UiMutationEvent::WorkspaceChangeRequestChanged {
                workspace_id: card_id.to_string(),
            },
        );
        ui_sync::publish(app, UiMutationEvent::WorkspaceListChanged);
    }
    Ok(json!({
        "cardId": card_id,
        "changed": changed,
        "changeRequest": change_request,
    }))
}

fn handle_sync_workspace_target_branch(app: &AppHandle, args: &Value) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    // Branching domain functions acquire workspace_fs_mutation_lock internally.
    let result = crate::workspaces::sync_workspace_with_target_branch(card_id)?;
    ui_sync::publish(
        app,
        UiMutationEvent::WorkspaceGitStateChanged {
            workspace_id: card_id.to_string(),
        },
    );
    Ok(serde_json::to_value(&result)?)
}

fn handle_push_workspace_branch(app: &AppHandle, args: &Value) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    // Branching domain functions acquire workspace_fs_mutation_lock internally.
    let result = crate::workspaces::push_workspace_to_remote(card_id)?;
    ui_sync::publish(
        app,
        UiMutationEvent::WorkspaceGitStateChanged {
            workspace_id: card_id.to_string(),
        },
    );
    Ok(serde_json::to_value(&result)?)
}

fn handle_merge_change_request(app: &AppHandle, args: &Value) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    let change_request = crate::forge::merge_workspace_change_request(card_id)?;
    let changed = crate::workspaces::sync_workspace_pr_state(card_id, change_request.as_ref())?;
    if changed {
        ui_sync::publish(
            app,
            UiMutationEvent::WorkspaceChangeRequestChanged {
                workspace_id: card_id.to_string(),
            },
        );
        ui_sync::publish(app, UiMutationEvent::WorkspaceListChanged);
    }
    Ok(json!({
        "cardId": card_id,
        "merged": change_request.as_ref().is_some_and(|cr| cr.is_merged),
        "changeRequest": change_request,
    }))
}

fn handle_check_workspace_landed(app: &AppHandle, args: &Value) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    let result = crate::workspaces::reconcile_workspace_landing_state(card_id)?;
    ui_sync::publish(
        app,
        UiMutationEvent::WorkspaceLandingChanged {
            workspace_id: card_id.to_string(),
        },
    );
    Ok(serde_json::to_value(&result)?)
}

fn handle_mark_workspace_landed(app: &AppHandle, args: &Value) -> Result<Value> {
    let card_id = req_str(args, "cardId")?;
    let result = crate::workspaces::mark_workspace_landed_manually(card_id)?;
    ui_sync::publish(
        app,
        UiMutationEvent::WorkspaceLandingChanged {
            workspace_id: card_id.to_string(),
        },
    );
    ui_sync::publish(app, UiMutationEvent::WorkspaceListChanged);
    Ok(serde_json::to_value(&result)?)
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Fire the standard set of UI mutation events after a board card was created
/// or mutated (lane/title change).
fn publish_board_changed(app: &AppHandle, goal_workspace_id: &str, workspace_id: &str) {
    ui_sync::publish(app, UiMutationEvent::WorkspaceListChanged);
    ui_sync::publish(
        app,
        UiMutationEvent::WorkspaceChanged {
            workspace_id: goal_workspace_id.to_string(),
        },
    );
    ui_sync::publish(
        app,
        UiMutationEvent::WorkspaceChanged {
            workspace_id: workspace_id.to_string(),
        },
    );
    ui_sync::publish(
        app,
        UiMutationEvent::GoalOrchestratorStateChanged {
            goal_workspace_id: goal_workspace_id.to_string(),
        },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Arg extraction helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Extract a required string field from the tool args JSON.
fn req_str<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("Missing required arg: {key}"))
}

/// Extract an optional string field, returning `None` if absent or not a string.
fn opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).map(str::to_string)
}
