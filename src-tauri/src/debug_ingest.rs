use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

const MAX_ENTRIES: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugIngestEntry {
    pub id: String,
    pub workspace_id: String,
    pub received_at: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugIngestStatus {
    pub workspace_id: String,
    pub running: bool,
    pub url: Option<String>,
    pub ingest_url: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub entry_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DebugIngestEvent {
    Entry { entry: DebugIngestEntry },
    Cleared,
}

#[derive(Clone)]
struct ServerState {
    workspace_id: String,
    entries: Arc<Mutex<VecDeque<DebugIngestEntry>>>,
    subscribers: Arc<Mutex<Vec<Channel<DebugIngestEvent>>>>,
}

struct ServerHandle {
    addr: SocketAddr,
    entries: Arc<Mutex<VecDeque<DebugIngestEntry>>>,
    subscribers: Arc<Mutex<Vec<Channel<DebugIngestEvent>>>>,
    shutdown: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
pub struct DebugIngestManager {
    servers: Mutex<HashMap<String, ServerHandle>>,
}

impl DebugIngestManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn ensure(&self, workspace_id: &str) -> Result<DebugIngestStatus> {
        if let Some(status) = self.status(workspace_id) {
            return Ok(status);
        }

        let entries = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_ENTRIES)));
        let subscribers = Arc::new(Mutex::new(Vec::new()));
        let state = ServerState {
            workspace_id: workspace_id.to_string(),
            entries: Arc::clone(&entries),
            subscribers: Arc::clone(&subscribers),
        };
        let router = router(state);
        let bind_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0);
        let listener = tokio::net::TcpListener::bind(bind_addr)
            .await
            .context("Failed to bind debug ingest server")?;
        let addr = listener
            .local_addr()
            .context("Failed to read ingest address")?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        let handle = ServerHandle {
            addr,
            entries,
            subscribers,
            shutdown: Some(shutdown_tx),
        };

        let status = {
            let mut servers = self.servers.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(existing) = servers.get(workspace_id) {
                return Ok(status_for(workspace_id, existing));
            }
            servers.insert(workspace_id.to_string(), handle);
            status_for(
                workspace_id,
                servers
                    .get(workspace_id)
                    .expect("debug ingest server was just inserted"),
            )
        };

        tauri::async_runtime::spawn(async move {
            let result = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
            if let Err(error) = result {
                tracing::warn!(%error, "Debug ingest server stopped with error");
            }
        });

        Ok(status)
    }

    pub fn stop(&self, workspace_id: &str) {
        let handle = self
            .servers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(workspace_id);
        if let Some(mut handle) = handle {
            if let Some(shutdown) = handle.shutdown.take() {
                let _ = shutdown.send(());
            }
        }
    }

    pub fn stop_all(&self) {
        let keys: Vec<String> = self
            .servers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .keys()
            .cloned()
            .collect();
        for key in keys {
            self.stop(&key);
        }
    }

    pub fn entries(&self, workspace_id: &str) -> Vec<DebugIngestEntry> {
        self.servers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(workspace_id)
            .and_then(|handle| handle.entries.lock().ok().map(|entries| entries.clone()))
            .map(|entries| entries.into_iter().collect())
            .unwrap_or_default()
    }

    pub fn clear(&self, workspace_id: &str) {
        let subscribers = {
            let servers = self.servers.lock().unwrap_or_else(|e| e.into_inner());
            let Some(handle) = servers.get(workspace_id) else {
                return;
            };
            if let Ok(mut entries) = handle.entries.lock() {
                entries.clear();
            }
            Arc::clone(&handle.subscribers)
        };
        publish(&subscribers, DebugIngestEvent::Cleared);
    }

    pub fn subscribe(
        &self,
        workspace_id: &str,
        channel: Channel<DebugIngestEvent>,
    ) -> Option<DebugIngestStatus> {
        let mut servers = self.servers.lock().unwrap_or_else(|e| e.into_inner());
        let handle = servers.get_mut(workspace_id)?;
        if let Ok(mut subscribers) = handle.subscribers.lock() {
            subscribers.push(channel);
        }
        Some(status_for(workspace_id, handle))
    }

    pub fn status(&self, workspace_id: &str) -> Option<DebugIngestStatus> {
        self.servers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(workspace_id)
            .map(|handle| status_for(workspace_id, handle))
    }
}

fn status_for(workspace_id: &str, handle: &ServerHandle) -> DebugIngestStatus {
    let entry_count = handle
        .entries
        .lock()
        .map(|entries| entries.len())
        .unwrap_or(0);
    let url = format!("http://{}", handle.addr);
    DebugIngestStatus {
        workspace_id: workspace_id.to_string(),
        running: true,
        url: Some(url.clone()),
        ingest_url: Some(format!("{url}/ingest")),
        host: Some(handle.addr.ip().to_string()),
        port: Some(handle.addr.port()),
        entry_count,
    }
}

fn router(state: ServerState) -> Router {
    Router::new()
        .route(
            "/ingest",
            post(post_ingest).get(get_ingest).delete(delete_ingest),
        )
        .route("/health", get(health))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state)
}

async fn health(State(state): State<ServerState>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "workspaceId": state.workspace_id,
    }))
}

async fn post_ingest(
    State(state): State<ServerState>,
    Json(payload): Json<Value>,
) -> Result<Json<DebugIngestEntry>, (StatusCode, Json<Value>)> {
    if !payload.is_object() {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "Debug ingest payload must be a JSON object",
        ));
    }

    let entry = DebugIngestEntry {
        id: Uuid::new_v4().to_string(),
        workspace_id: state.workspace_id.clone(),
        received_at: Utc::now().to_rfc3339(),
        payload,
    };

    {
        let mut entries = state.entries.lock().map_err(|_| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Debug ingest buffer failed",
            )
        })?;
        if entries.len() >= MAX_ENTRIES {
            entries.pop_front();
        }
        entries.push_back(entry.clone());
    }

    publish(
        &state.subscribers,
        DebugIngestEvent::Entry {
            entry: entry.clone(),
        },
    );
    Ok(Json(entry))
}

async fn get_ingest(State(state): State<ServerState>) -> Json<Vec<DebugIngestEntry>> {
    let entries = state
        .entries
        .lock()
        .map(|entries| entries.iter().cloned().collect())
        .unwrap_or_default();
    Json(entries)
}

async fn delete_ingest(State(state): State<ServerState>) -> Json<Value> {
    if let Ok(mut entries) = state.entries.lock() {
        entries.clear();
    }
    publish(&state.subscribers, DebugIngestEvent::Cleared);
    Json(json!({ "ok": true }))
}

fn publish(subscribers: &Arc<Mutex<Vec<Channel<DebugIngestEvent>>>>, event: DebugIngestEvent) {
    let Ok(mut subscribers) = subscribers.lock() else {
        return;
    };
    subscribers.retain(|channel| channel.send(event.clone()).is_ok());
}

fn json_error(status: StatusCode, message: &str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": message })))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn json_request(
        method: reqwest::Method,
        url: &str,
        body: Option<Value>,
    ) -> reqwest::Response {
        let client = reqwest::Client::new();
        let request = client.request(method, url);
        let request = if let Some(body) = body {
            request.json(&body)
        } else {
            request
        };
        request.send().await.unwrap()
    }

    #[tokio::test]
    async fn ensure_is_idempotent_per_workspace() {
        let manager = DebugIngestManager::new();
        let first = manager.ensure("workspace-1").await.unwrap();
        let second = manager.ensure("workspace-1").await.unwrap();
        assert_eq!(first.ingest_url, second.ingest_url);
        manager.stop("workspace-1");
    }

    #[tokio::test]
    async fn post_get_and_delete_manage_buffer() {
        let manager = DebugIngestManager::new();
        let status = manager.ensure("workspace-1").await.unwrap();
        let url = status.ingest_url.unwrap();

        let posted = json_request(
            reqwest::Method::POST,
            &url,
            Some(json!({ "level": "info", "message": "hello" })),
        )
        .await;
        assert_eq!(posted.status(), StatusCode::OK);

        let entries: Vec<DebugIngestEntry> = json_request(reqwest::Method::GET, &url, None)
            .await
            .json()
            .await
            .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].payload["message"], "hello");

        let deleted = json_request(reqwest::Method::DELETE, &url, None).await;
        assert_eq!(deleted.status(), StatusCode::OK);
        let entries: Vec<DebugIngestEntry> = json_request(reqwest::Method::GET, &url, None)
            .await
            .json()
            .await
            .unwrap();
        assert!(entries.is_empty());
        assert!(manager.status("workspace-1").unwrap().running);
        manager.stop("workspace-1");
    }

    #[tokio::test]
    async fn post_rejects_non_object_json() {
        let manager = DebugIngestManager::new();
        let status = manager.ensure("workspace-1").await.unwrap();
        let url = status.ingest_url.unwrap();

        let response = json_request(reqwest::Method::POST, &url, Some(json!(["nope"]))).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(manager.entries("workspace-1").is_empty());
        manager.stop("workspace-1");
    }

    #[tokio::test]
    async fn post_rejects_invalid_json() {
        let manager = DebugIngestManager::new();
        let status = manager.ensure("workspace-1").await.unwrap();
        let url = status.ingest_url.unwrap();

        let response = reqwest::Client::new()
            .post(&url)
            .header("content-type", "application/json")
            .body("not-json")
            .send()
            .await
            .unwrap();
        assert!(response.status().is_client_error());
        assert!(manager.entries("workspace-1").is_empty());
        manager.stop("workspace-1");
    }

    #[tokio::test]
    async fn stop_removes_workspace_state() {
        let manager = DebugIngestManager::new();
        manager.ensure("workspace-1").await.unwrap();
        manager.stop("workspace-1");
        assert!(manager.status("workspace-1").is_none());
    }
}
