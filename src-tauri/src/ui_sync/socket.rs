use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

use super::{events::UiMutationEnvelope, manager::UiSyncManager, UiMutationEvent};

const SOCKET_FILENAME: &str = "ui-sync.sock";

pub fn socket_path() -> Result<PathBuf> {
    Ok(crate::data_dir::run_dir()?.join(SOCKET_FILENAME))
}

pub fn start_listener<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    #[cfg(unix)]
    {
        let socket_path = socket_path()?;
        if socket_path.exists() {
            let _ = std::fs::remove_file(&socket_path);
        }

        let listener = std::os::unix::net::UnixListener::bind(&socket_path)
            .with_context(|| format!("Failed to bind UI sync socket {}", socket_path.display()))?;
        listener
            .set_nonblocking(false)
            .context("Failed to configure UI sync socket")?;

        std::thread::Builder::new()
            .name("ui-sync-listener".into())
            .spawn(move || {
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else {
                        continue;
                    };

                    let mut line = String::new();
                    let read_result = {
                        let mut reader = BufReader::new(&mut stream);
                        reader.read_line(&mut line)
                    };

                    let response = match read_result {
                        Ok(0) => socket_response_error("empty request"),
                        Ok(_) => handle_socket_line(&app, &line),
                        Err(_) => socket_response_error("read failed"),
                    };

                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.write_all(b"\n");
                    let _ = stream.flush();
                }
            })
            .context("Failed to spawn UI sync socket listener")?;

        Ok(())
    }

    #[cfg(not(unix))]
    {
        let _ = app;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "request", rename_all = "camelCase")]
enum UiSyncRequest {
    #[serde(rename = "debugIngestOverview")]
    Overview,
    #[serde(rename = "debugIngestEnsure")]
    Ensure {
        workspace_id: String,
        public_forward: Option<crate::debug_ingest::DebugIngestPublicForwardConfig>,
    },
    #[serde(rename = "debugIngestStop")]
    Stop { workspace_id: String },
}

fn handle_socket_line<R: Runtime>(app: &AppHandle<R>, line: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return socket_response_error("invalid payload");
    };

    if value.get("request").is_some() {
        return match serde_json::from_value::<UiSyncRequest>(value) {
            Ok(request) => handle_request(app, request),
            Err(_) => socket_response_error("invalid request"),
        };
    }

    match serde_json::from_value::<UiMutationEnvelope>(value) {
        Ok(envelope) if envelope.version == UiMutationEnvelope::VERSION => {
            publish_socket_event(app, envelope.event);
            socket_response_ok(serde_json::json!(null))
        }
        Ok(_) => socket_response_error("unsupported version"),
        Err(_) => socket_response_error("invalid payload"),
    }
}

fn handle_request<R: Runtime>(app: &AppHandle<R>, request: UiSyncRequest) -> String {
    match request {
        UiSyncRequest::Overview => {
            let manager = app.state::<crate::debug_ingest::DebugIngestManager>();
            let overview = tauri::async_runtime::block_on(manager.overview());
            socket_response_ok(overview)
        }
        UiSyncRequest::Ensure {
            workspace_id,
            public_forward,
        } => {
            let manager = app.state::<crate::debug_ingest::DebugIngestManager>();
            match tauri::async_runtime::block_on(manager.ensure(&workspace_id, public_forward)) {
                Ok(status) => socket_response_ok(status),
                Err(error) => socket_response_error(&format!("{error:#}")),
            }
        }
        UiSyncRequest::Stop { workspace_id } => {
            let manager = app.state::<crate::debug_ingest::DebugIngestManager>();
            manager.stop(&workspace_id);
            socket_response_ok(serde_json::json!(true))
        }
    }
}

fn publish_socket_event<R: Runtime>(app: &AppHandle<R>, event: UiMutationEvent) {
    if matches!(event, UiMutationEvent::DebugIngestNgrokResetRequested) {
        app.state::<crate::debug_ingest::DebugIngestManager>()
            .reset_public_tunnels();
    }
    let manager = app.state::<UiSyncManager>();
    manager.publish(event);
}

fn socket_response_ok(data: impl Serialize) -> String {
    serde_json::to_string(&serde_json::json!({ "ok": true, "data": data }))
        .unwrap_or_else(|_| r#"{"ok":false,"error":"response serialization failed"}"#.to_string())
}

fn socket_response_error(error: &str) -> String {
    serde_json::to_string(&serde_json::json!({ "ok": false, "error": error }))
        .unwrap_or_else(|_| r#"{"ok":false,"error":"response serialization failed"}"#.to_string())
}

pub fn notify_running_app(event: super::events::UiMutationEvent) -> Result<bool> {
    #[cfg(unix)]
    {
        let socket_path = socket_path()?;
        if !socket_path.exists() {
            return Ok(false);
        }

        let mut stream = match std::os::unix::net::UnixStream::connect(&socket_path) {
            Ok(stream) => stream,
            Err(_) => return Ok(false),
        };

        let payload = serde_json::to_string(&UiMutationEnvelope::new(event))
            .context("Failed to serialize UI mutation envelope")?;
        stream
            .write_all(payload.as_bytes())
            .context("Failed to write UI sync payload")?;
        stream
            .write_all(b"\n")
            .context("Failed to terminate UI sync payload")?;
        stream.flush().context("Failed to flush UI sync payload")?;

        let mut reader = BufReader::new(stream);
        let mut response = String::new();
        reader
            .read_line(&mut response)
            .context("Failed to read UI sync response")?;

        let ok = serde_json::from_str::<serde_json::Value>(&response)
            .ok()
            .and_then(|value| value.get("ok").and_then(|ok| ok.as_bool()))
            .unwrap_or(false);

        Ok(ok)
    }

    #[cfg(not(unix))]
    {
        let _ = event;
        Ok(false)
    }
}

pub fn request_debug_ingest_overview() -> Result<Option<crate::debug_ingest::DebugIngestOverview>> {
    request_running_app(serde_json::json!({ "request": "debugIngestOverview" }))
}

pub fn ensure_running_app_debug_ingest(
    workspace_id: &str,
    public_forward: Option<crate::debug_ingest::DebugIngestPublicForwardConfig>,
) -> Result<Option<crate::debug_ingest::DebugIngestStatus>> {
    request_running_app(serde_json::json!({
        "request": "debugIngestEnsure",
        "workspaceId": workspace_id,
        "publicForward": public_forward,
    }))
}

pub fn stop_running_app_debug_ingest(workspace_id: &str) -> Result<bool> {
    request_running_app::<bool>(serde_json::json!({
        "request": "debugIngestStop",
        "workspaceId": workspace_id,
    }))
    .map(|value| value.unwrap_or(false))
}

fn request_running_app<T: DeserializeOwned>(payload: Value) -> Result<Option<T>> {
    #[cfg(unix)]
    {
        let socket_path = socket_path()?;
        if !socket_path.exists() {
            return Ok(None);
        }

        let mut stream = match std::os::unix::net::UnixStream::connect(&socket_path) {
            Ok(stream) => stream,
            Err(_) => return Ok(None),
        };

        let payload =
            serde_json::to_string(&payload).context("Failed to serialize UI sync request")?;
        stream
            .write_all(payload.as_bytes())
            .context("Failed to write UI sync request")?;
        stream
            .write_all(b"\n")
            .context("Failed to terminate UI sync request")?;
        stream.flush().context("Failed to flush UI sync request")?;

        let mut reader = BufReader::new(stream);
        let mut response = String::new();
        reader
            .read_line(&mut response)
            .context("Failed to read UI sync response")?;

        let response: Value =
            serde_json::from_str(&response).context("Failed to parse UI sync response")?;
        if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            let Some(data) = response.get("data").filter(|value| !value.is_null()) else {
                return Ok(None);
            };
            Ok(Some(
                serde_json::from_value(data.clone())
                    .context("Failed to parse UI sync response data")?,
            ))
        } else {
            Err(anyhow::anyhow!(
                "{}",
                response
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("UI sync request failed")
            ))
        }
    }

    #[cfg(not(unix))]
    {
        let _ = payload;
        Ok(None)
    }
}

pub fn is_listener_running() -> bool {
    #[cfg(unix)]
    {
        let Ok(socket_path) = socket_path() else {
            return false;
        };
        if !socket_path.exists() {
            return false;
        }

        std::os::unix::net::UnixStream::connect(socket_path).is_ok()
    }

    #[cfg(not(unix))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_dir::TEST_ENV_LOCK;
    use crate::ui_sync::events::UiMutationEvent;

    #[test]
    fn socket_path_uses_run_dir() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("HELMOR_DATA_DIR", dir.path());

        let path = socket_path().unwrap();
        assert!(path.ends_with("run/ui-sync.sock"));
    }

    #[test]
    fn envelope_parser_accepts_current_version() {
        let line = serde_json::to_string(&UiMutationEnvelope::new(
            UiMutationEvent::WorkspaceListChanged,
        ))
        .unwrap();
        let envelope: UiMutationEnvelope = serde_json::from_str(&line).unwrap();
        assert_eq!(envelope.version, UiMutationEnvelope::VERSION);
    }

    #[test]
    fn envelope_parser_rejects_unsupported_version() {
        // A v2 payload should still parse (forward-compat), but the version
        // check at the call site is what gates publishing. Verify both halves.
        let line = r#"{"version":99,"event":{"type":"workspaceListChanged"}}"#;
        let envelope: UiMutationEnvelope = serde_json::from_str(line).unwrap();
        assert_ne!(envelope.version, UiMutationEnvelope::VERSION);
    }

    #[test]
    fn envelope_parser_rejects_garbage_json() {
        let result = serde_json::from_str::<UiMutationEnvelope>("not json");
        assert!(result.is_err());
    }

    #[test]
    fn envelope_parser_rejects_unknown_event_type() {
        let line = r#"{"version":1,"event":{"type":"madeUpEvent"}}"#;
        let result = serde_json::from_str::<UiMutationEnvelope>(line);
        assert!(result.is_err());
    }

    #[test]
    fn is_listener_running_returns_false_without_socket() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("HELMOR_DATA_DIR", dir.path());
        // Socket file has not been created — listener must report false.
        assert!(!is_listener_running());
    }

    #[test]
    fn notify_running_app_returns_false_without_socket() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("HELMOR_DATA_DIR", dir.path());
        let result = notify_running_app(UiMutationEvent::WorkspaceListChanged).unwrap();
        assert!(!result, "with no socket the call must succeed with false");
    }
}
