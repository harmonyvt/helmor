use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::{
    config::{config_url, RemoteAccessConfig},
    http::HttpRequest,
};

pub(crate) fn handle_api(
    request: HttpRequest,
    app: AppHandle,
    config: &RemoteAccessConfig,
) -> Result<Value> {
    let segments = request
        .path
        .trim_matches('/')
        .split('/')
        .collect::<Vec<_>>();

    match (request.method.as_str(), segments.as_slice()) {
        ("GET", ["api", "bootstrap"]) => Ok(json!({
            "app": "Helmor",
            "remote": {
                "url": config_url(config),
                "bindAddr": config.bind_addr,
                "port": config.port,
            },
        })),
        ("GET", ["api", "workspaces"]) => Ok(serde_json::to_value(
            crate::service::list_workspace_groups()?,
        )?),
        ("GET", ["api", "workspaces", workspace_id, "sessions"]) => Ok(serde_json::to_value(
            crate::service::list_workspace_sessions(workspace_id)?,
        )?),
        ("GET", ["api", "sessions", session_id, "messages"]) => {
            let historical = crate::sessions::list_session_historical_records(session_id)?;
            Ok(serde_json::to_value(
                crate::pipeline::MessagePipeline::convert_historical(&historical),
            )?)
        }
        ("POST", ["api", "sessions", session_id, "send"]) => {
            let body: SendBody = parse_body(&request.body)?;
            let workspace_id = match body.workspace_id {
                Some(id) => id,
                None => lookup_session_workspace(session_id)?,
            };
            let mut sink = |_event: &crate::agents::AgentStreamEvent| {};
            let result = crate::service::send_message(
                crate::service::SendMessageParams {
                    workspace_ref: workspace_id,
                    session_id: Some((*session_id).to_string()),
                    prompt: body.prompt,
                    model: body.model_id,
                    permission_mode: body.permission_mode,
                    linked_directories: Vec::new(),
                },
                &mut sink,
            )?;
            Ok(serde_json::to_value(result)?)
        }
        ("POST", ["api", "sessions", session_id, "stop"]) => {
            let provider = lookup_session_provider(session_id)?.unwrap_or_else(|| "claude".into());
            let sidecar = app.state::<crate::sidecar::ManagedSidecar>();
            sidecar
                .send(&crate::sidecar::SidecarRequest {
                    id: Uuid::new_v4().to_string(),
                    method: "stopSession".to_string(),
                    params: json!({
                        "sessionId": session_id,
                        "provider": provider,
                    }),
                })
                .map_err(|error| anyhow!("Failed to stop session: {error}"))?;
            Ok(json!({ "ok": true }))
        }
        ("POST", ["api", "interactions", interaction_id, "respond"]) => {
            let body: InteractionResponseBody = parse_body(&request.body)?;
            respond_to_interaction(&app, interaction_id, body)?;
            Ok(json!({ "ok": true }))
        }
        _ => Ok(json!({ "error": "not found" })),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendBody {
    workspace_id: Option<String>,
    prompt: String,
    model_id: Option<String>,
    permission_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InteractionResponseBody {
    kind: String,
    behavior: Option<String>,
    action: Option<String>,
    reason: Option<String>,
    message: Option<String>,
    updated_input: Option<Value>,
    content: Option<Value>,
}

fn parse_body<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T> {
    serde_json::from_slice(body).context("Invalid JSON body")
}

fn lookup_session_workspace(session_id: &str) -> Result<String> {
    let conn = crate::db::read_conn()?;
    conn.query_row(
        "SELECT workspace_id FROM sessions WHERE id = ?1",
        [session_id],
        |row| row.get(0),
    )
    .with_context(|| format!("Failed to resolve workspace for session {session_id}"))
}

fn lookup_session_provider(session_id: &str) -> Result<Option<String>> {
    let conn = crate::db::read_conn()?;
    conn.query_row(
        "SELECT agent_type FROM sessions WHERE id = ?1",
        [session_id],
        |row| row.get(0),
    )
    .with_context(|| format!("Failed to resolve provider for session {session_id}"))
}

fn respond_to_interaction(
    app: &AppHandle,
    interaction_id: &str,
    body: InteractionResponseBody,
) -> Result<()> {
    let sidecar = app.state::<crate::sidecar::ManagedSidecar>();
    let (method, params) = match body.kind.as_str() {
        "permission" => (
            "permissionResponse",
            json!({
                "permissionId": interaction_id,
                "behavior": body.behavior.unwrap_or_else(|| "deny".into()),
                "message": body.message,
            }),
        ),
        "deferredTool" => (
            "deferredToolResponse",
            json!({
                "toolUseId": interaction_id,
                "behavior": body.behavior.unwrap_or_else(|| "deny".into()),
                "reason": body.reason,
                "updatedInput": body.updated_input,
            }),
        ),
        "elicitation" => (
            "elicitationResponse",
            json!({
                "elicitationId": interaction_id,
                "action": body.action.unwrap_or_else(|| "decline".into()),
                "content": body.content,
            }),
        ),
        other => anyhow::bail!("Unsupported interaction kind: {other}"),
    };

    sidecar
        .send(&crate::sidecar::SidecarRequest {
            id: Uuid::new_v4().to_string(),
            method: method.to_string(),
            params,
        })
        .map_err(|error| anyhow!("Failed to send interaction response: {error}"))
}
