//! Minimal MCP (Model Context Protocol) server over stdio.
//!
//! Implements JSON-RPC 2.0 with tools capability. Each request is one
//! line of JSON on stdin; each response is one line on stdout.

use anyhow::Result;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::sync::OnceLock;
use tauri::AppHandle;

use crate::agents::AgentStreamEvent;
use crate::commands::browser_commands;
use crate::pipeline::types::{ExtendedMessagePart, MessagePart};
use crate::service;

static MCP_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn set_app_handle(app: AppHandle) {
    let _ = MCP_APP_HANDLE.set(app);
}

pub fn run_mcp_server() -> Result<()> {
    // Bootstrap DB (same as CLI)
    crate::data_dir::ensure_directory_structure()?;
    let db_path = crate::data_dir::db_path()?;
    let conn = rusqlite::Connection::open(&db_path)?;
    crate::schema_init(&conn);
    drop(conn);

    let stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();

    for line in stdin.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let request: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let resp = json_rpc_error(Value::Null, -32700, &format!("Parse error: {e}"));
                writeln!(stdout, "{}", serde_json::to_string(&resp)?)?;
                stdout.flush()?;
                continue;
            }
        };

        let method = request.get("method").and_then(Value::as_str).unwrap_or("");

        // Notifications have no id — don't send a response
        if method.starts_with("notifications/") {
            continue;
        }

        let response = match method {
            "initialize" => handle_initialize(&request),
            "ping" => handle_ping(&request),
            "tools/list" => handle_tools_list(&request),
            "tools/call" => handle_tools_call(&request),
            _ => json_rpc_error(
                request["id"].clone(),
                -32601,
                &format!("Method not found: {method}"),
            ),
        };

        writeln!(stdout, "{}", serde_json::to_string(&response)?)?;
        stdout.flush()?;
    }

    Ok(())
}

fn handle_initialize(request: &Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": request["id"],
        "result": {
            "protocolVersion": "2025-06-18",
            "capabilities": { "tools": {} },
            "serverInfo": {
                "name": "helmor",
                "version": "0.1.0"
            }
        }
    })
}

fn handle_ping(request: &Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": request["id"], "result": {} })
}

fn handle_tools_list(request: &Value) -> Value {
    let tools = json!([
        tool_def("helmor_data_info", "Show Helmor data directory, database path, and mode", json!({})),
        tool_def("helmor_repo_list", "List all registered repositories", json!({})),
        tool_def("helmor_repo_add", "Register a local Git repository (creates first workspace automatically)", json!({
            "path": { "type": "string", "description": "Absolute path to the repository root" }
        }).as_object().map(|o| json!({ "type": "object", "properties": o, "required": ["path"] })).unwrap()),
        tool_def("helmor_workspace_list", "List all active workspaces grouped by status", json!({})),
        tool_def("helmor_workspace_show", "Show details for a workspace", json!({
            "ref": { "type": "string", "description": "Workspace UUID or repo-name/directory-name" }
        }).as_object().map(|o| json!({ "type": "object", "properties": o, "required": ["ref"] })).unwrap()),
        tool_def("helmor_workspace_create", "Create a new workspace for a repository", json!({
            "repo": { "type": "string", "description": "Repository UUID or name" }
        }).as_object().map(|o| json!({ "type": "object", "properties": o, "required": ["repo"] })).unwrap()),
        tool_def("helmor_session_list", "List sessions in a workspace", json!({
            "workspace": { "type": "string", "description": "Workspace UUID or repo-name/directory-name" }
        }).as_object().map(|o| json!({ "type": "object", "properties": o, "required": ["workspace"] })).unwrap()),
        tool_def("helmor_session_create", "Create a new session in a workspace", json!({
            "workspace": { "type": "string", "description": "Workspace UUID or repo-name/directory-name" }
        }).as_object().map(|o| json!({ "type": "object", "properties": o, "required": ["workspace"] })).unwrap()),
        tool_def("helmor_goal_child_create", "Create/finalize a child workspace attached to a Goal board and optionally start an agent prompt", json!({
            "goal_workspace": { "type": "string", "description": "Goal workspace UUID or repo-name/directory-name" },
            "title": { "type": "string", "description": "Child workspace title" },
            "description": { "type": "string", "description": "Optional child/card description" },
            "lane": { "type": "string", "description": "backlog | in-progress | review | done | canceled" },
            "target_branch": { "type": "string", "description": "Optional start/target branch (defaults to the Goal branch)" },
            "assigned_provider": { "type": "string", "description": "Optional provider metadata: claude | codex | pi" },
            "assigned_model_id": { "type": "string", "description": "Optional Helmor model id" },
            "prompt": { "type": "string", "description": "Optional prompt to start in the child workspace" },
            "permission_mode": { "type": "string", "description": "Optional permission mode for prompt" },
            "finalize": { "type": "boolean", "description": "Create worktree now (default true)" }
        }).as_object().map(|o| json!({ "type": "object", "properties": o, "required": ["goal_workspace", "title"] })).unwrap()),
        tool_def("helmor_browser_list_tabs", "List durable browser tabs for a workspace", json!({
            "workspace": { "type": "string", "description": "Workspace UUID or repo-name/directory-name" }
        }).as_object().map(|o| json!({ "type": "object", "properties": o, "required": ["workspace"] })).unwrap()),
        tool_def("helmor_browser_open", "Create a durable browser tab in a workspace", json!({
            "workspace": { "type": "string", "description": "Workspace UUID or repo-name/directory-name" },
            "url": { "type": "string", "description": "Initial http/https URL" }
        }).as_object().map(|o| json!({ "type": "object", "properties": o, "required": ["workspace"] })).unwrap()),
        tool_def("helmor_browser_navigate", "Navigate an existing browser tab", json!({
            "tab_id": { "type": "string", "description": "Browser tab UUID" },
            "url": { "type": "string", "description": "Destination http/https URL" }
        }).as_object().map(|o| json!({ "type": "object", "properties": o, "required": ["tab_id", "url"] })).unwrap()),
        tool_def("helmor_browser_close", "Close a durable browser tab", json!({
            "tab_id": { "type": "string", "description": "Browser tab UUID" }
        }).as_object().map(|o| json!({ "type": "object", "properties": o, "required": ["tab_id"] })).unwrap()),
        tool_def("helmor_send", "Send a prompt to an AI agent in a workspace", json!({
            "workspace": { "type": "string", "description": "Workspace UUID or repo-name/directory-name" },
            "prompt": { "type": "string", "description": "The prompt to send to the AI agent" },
            "model": { "type": "string", "description": "Model ID (default: opus-1m)" },
            "session_id": { "type": "string", "description": "Session UUID (default: active session)" }
        }).as_object().map(|o| json!({ "type": "object", "properties": o, "required": ["workspace", "prompt"] })).unwrap()),
    ]);

    json!({
        "jsonrpc": "2.0",
        "id": request["id"],
        "result": { "tools": tools }
    })
}

fn handle_tools_call(request: &Value) -> Value {
    let id = request["id"].clone();
    let tool_name = request["params"]["name"].as_str().unwrap_or("");
    let args = &request["params"]["arguments"];

    let result = dispatch_tool(tool_name, args);

    match result {
        Ok(text) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": text }],
                "isError": false
            }
        }),
        Err(e) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{ "type": "text", "text": format!("Error: {e:#}") }],
                "isError": true
            }
        }),
    }
}

fn dispatch_tool(name: &str, args: &Value) -> Result<String> {
    match name {
        "helmor_data_info" => {
            let info = service::get_data_info()?;
            Ok(serde_json::to_string_pretty(&info)?)
        }
        "helmor_repo_list" => {
            let repos = service::list_repositories()?;
            Ok(serde_json::to_string_pretty(&repos)?)
        }
        "helmor_repo_add" => {
            let path = args["path"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: path"))?;
            let resp = service::add_repository_from_local_path(path)?;
            Ok(serde_json::to_string_pretty(&resp)?)
        }
        "helmor_workspace_list" => {
            let groups = service::list_workspace_groups()?;
            Ok(serde_json::to_string_pretty(&groups)?)
        }
        "helmor_workspace_show" => {
            let ws_ref = args["ref"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: ref"))?;
            let ws_id = service::resolve_workspace_ref(ws_ref)?;
            let detail = service::get_workspace(&ws_id)?;
            Ok(serde_json::to_string_pretty(&detail)?)
        }
        "helmor_workspace_create" => {
            let repo_ref = args["repo"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: repo"))?;
            let repo_id = service::resolve_repo_ref(repo_ref)?;
            let resp = service::create_workspace_from_repo_impl(&repo_id)?;
            Ok(serde_json::to_string_pretty(&resp)?)
        }
        "helmor_session_list" => {
            let ws_ref = args["workspace"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: workspace"))?;
            let ws_id = service::resolve_workspace_ref(ws_ref)?;
            let sessions = service::list_workspace_sessions(&ws_id)?;
            Ok(serde_json::to_string_pretty(&sessions)?)
        }
        "helmor_session_create" => {
            let ws_ref = args["workspace"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: workspace"))?;
            let permission_mode = args["plan"]
                .as_bool()
                .and_then(|enabled| enabled.then_some("plan"));
            let ws_id = service::resolve_workspace_ref(ws_ref)?;
            let resp = service::create_session(&ws_id, None, permission_mode)?;
            Ok(serde_json::to_string_pretty(&resp)?)
        }
        "helmor_goal_child_create" => {
            let goal_workspace = args["goal_workspace"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: goal_workspace"))?;
            let title = args["title"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: title"))?;
            let lane = args["lane"].as_str().map(str::parse).transpose()?;
            let params = crate::goal_orchestration::GoalChildWorkspaceCreateParams {
                goal_workspace: goal_workspace.to_string(),
                title: title.to_string(),
                description: args["description"].as_str().map(String::from),
                lane,
                target_branch: args["target_branch"].as_str().map(String::from),
                assigned_provider: args["assigned_provider"].as_str().map(String::from),
                assigned_model_id: args["assigned_model_id"].as_str().map(String::from),
                assigned_effort_level: args["assigned_effort_level"].as_str().map(String::from),
                prompt: args["prompt"].as_str().map(String::from),
                permission_mode: args["permission_mode"].as_str().map(String::from),
                finalize: args["finalize"].as_bool(),
            };
            fn ignore_event(_: &crate::agents::AgentStreamEvent) {}
            let mut on_event = ignore_event;
            let result = crate::goal_orchestration::create_goal_child_workspace_and_start(
                params,
                &mut on_event,
            )?;
            Ok(serde_json::to_string_pretty(&result)?)
        }
        "helmor_browser_list_tabs" => {
            let ws_ref = args["workspace"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: workspace"))?;
            let ws_id = service::resolve_workspace_ref(ws_ref)?;
            let tabs = service::list_workspace_browser_tabs(&ws_id)?;
            Ok(serde_json::to_string_pretty(&tabs)?)
        }
        "helmor_browser_open" => {
            let ws_ref = args["workspace"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: workspace"))?;
            let ws_id = service::resolve_workspace_ref(ws_ref)?;
            let url = args["url"].as_str();
            let tab = if let Some(app) = MCP_APP_HANDLE.get() {
                browser_commands::create_browser_tab_and_publish(app, &ws_id, url)?
            } else {
                service::create_browser_tab(&ws_id, url)?
            };
            Ok(serde_json::to_string_pretty(&tab)?)
        }
        "helmor_browser_navigate" => {
            let tab_id = args["tab_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: tab_id"))?;
            let url = args["url"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: url"))?;
            let tab = if let Some(app) = MCP_APP_HANDLE.get() {
                browser_commands::navigate_browser_tab_and_publish(app, tab_id, url)?
            } else {
                service::navigate_browser_tab(tab_id, url)?
            };
            Ok(serde_json::to_string_pretty(&tab)?)
        }
        "helmor_browser_close" => {
            let tab_id = args["tab_id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: tab_id"))?;
            let fallback = if let Some(app) = MCP_APP_HANDLE.get() {
                browser_commands::close_browser_tab_and_publish(app, tab_id)?
            } else {
                service::close_browser_tab(tab_id)?
            };
            Ok(serde_json::to_string_pretty(&fallback)?)
        }
        "helmor_send" => {
            let ws_ref = args["workspace"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: workspace"))?;
            let prompt = args["prompt"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Missing required param: prompt"))?;
            let model = args["model"].as_str().map(String::from);
            let session_id = args["session_id"].as_str().map(String::from);
            let permission_mode = if args["plan"].as_bool().unwrap_or(false) {
                Some("plan".to_string())
            } else {
                Some("auto".to_string())
            };

            let params = service::SendMessageParams {
                workspace_ref: ws_ref.to_string(),
                session_id,
                prompt: prompt.to_string(),
                model,
                permission_mode,
                linked_directories: Vec::new(),
                delegate_to_running_app: true,
            };

            let mut output = String::new();
            let result = service::send_message(params, &mut |event| {
                if let AgentStreamEvent::StreamingPartial { message } = event {
                    for part in &message.content {
                        if let ExtendedMessagePart::Basic(MessagePart::Text { text, .. }) = part {
                            output.push_str(text);
                        }
                    }
                }
            })?;

            if output.is_empty() {
                output = format!(
                    "Task completed. Session: {}, Model: {}/{}",
                    result.session_id, result.provider, result.model
                );
            }

            Ok(output)
        }
        _ => anyhow::bail!("Unknown tool: {name}"),
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn tool_def(name: &str, description: &str, input_schema: Value) -> Value {
    let schema = if input_schema.is_object() && input_schema.get("type").is_some() {
        input_schema
    } else {
        json!({ "type": "object", "properties": input_schema })
    };
    json!({
        "name": name,
        "description": description,
        "inputSchema": schema
    })
}

fn json_rpc_error(id: Value, code: i32, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}
