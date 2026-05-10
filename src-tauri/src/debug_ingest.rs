use std::collections::{HashMap, VecDeque};
use std::env;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use axum::extract::{Query, State};
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use ngrok::forwarder::Forwarder;
use ngrok::prelude::{EndpointInfo, ForwarderBuilder, TunnelCloser};
use ngrok::tunnel::HttpTunnel;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};
use url::Url;
use uuid::Uuid;

const MAX_ENTRIES: usize = 500;
const DEBUG_TOKEN_HEADER: &str = "x-helmor-debug-token";
const NGROK_DOMAIN_ENV: &str = "HELMOR_DEBUG_INGEST_NGROK_DOMAIN";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugIngestEntry {
    pub id: String,
    pub workspace_id: String,
    pub received_at: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugIngestPublicForwardConfig {
    pub enabled: bool,
    pub ngrok_domain: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugIngestStatus {
    pub workspace_id: String,
    pub running: bool,
    pub url: Option<String>,
    pub ingest_url: Option<String>,
    pub public_url: Option<String>,
    pub public_ingest_url: Option<String>,
    pub tunnel_provider: Option<String>,
    pub tunnel_error: Option<String>,
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
    token: String,
    entries: Arc<Mutex<VecDeque<DebugIngestEntry>>>,
    subscribers: Arc<Mutex<Vec<Channel<DebugIngestEvent>>>>,
}

struct PublicTunnelHandle {
    public_url: String,
    forwarder: Forwarder<HttpTunnel>,
}

struct ServerHandle {
    addr: SocketAddr,
    token: String,
    entries: Arc<Mutex<VecDeque<DebugIngestEntry>>>,
    subscribers: Arc<Mutex<Vec<Channel<DebugIngestEvent>>>>,
    shutdown: Option<oneshot::Sender<()>>,
    public_tunnel: Option<PublicTunnelHandle>,
    public_tunnel_error: Option<String>,
    public_tunnel_config_key: Option<String>,
}

#[derive(Default)]
pub struct DebugIngestManager {
    servers: Mutex<HashMap<String, ServerHandle>>,
}

impl DebugIngestManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn ensure(
        &self,
        workspace_id: &str,
        public_forward: Option<DebugIngestPublicForwardConfig>,
    ) -> Result<DebugIngestStatus> {
        self.ensure_local(workspace_id).await?;

        match public_forward {
            Some(config) if config.enabled => {
                if let Err(error) = self.ensure_public_tunnel(workspace_id, &config).await {
                    let message = format!("{error:#}");
                    tracing::warn!(workspace_id, error = %message, "Failed to start ngrok debug ingest tunnel");
                    self.set_public_tunnel_error(workspace_id, Some(message));
                }
            }
            Some(_) => self.stop_public_tunnel(workspace_id),
            None => {}
        }

        self.status(workspace_id)
            .context("Debug ingest server disappeared after startup")
    }

    async fn ensure_local(&self, workspace_id: &str) -> Result<()> {
        if self.status(workspace_id).is_some() {
            return Ok(());
        }

        let token = Uuid::new_v4().to_string();
        let entries = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_ENTRIES)));
        let subscribers = Arc::new(Mutex::new(Vec::new()));
        let state = ServerState {
            workspace_id: workspace_id.to_string(),
            token: token.clone(),
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
            token,
            entries,
            subscribers,
            shutdown: Some(shutdown_tx),
            public_tunnel: None,
            public_tunnel_error: None,
            public_tunnel_config_key: None,
        };

        {
            let mut servers = self.servers.lock().unwrap_or_else(|e| e.into_inner());
            if servers.contains_key(workspace_id) {
                return Ok(());
            }
            servers.insert(workspace_id.to_string(), handle);
        }

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

        Ok(())
    }

    async fn ensure_public_tunnel(
        &self,
        workspace_id: &str,
        config: &DebugIngestPublicForwardConfig,
    ) -> Result<()> {
        let requested_config_key = public_tunnel_config_key(config);
        let (addr, previous_tunnel) = {
            let mut servers = self.servers.lock().unwrap_or_else(|e| e.into_inner());
            let handle = servers
                .get_mut(workspace_id)
                .context("Debug ingest server is not running")?;
            if handle.public_tunnel.is_some()
                && handle.public_tunnel_config_key.as_deref() == Some(&requested_config_key)
            {
                return Ok(());
            }
            handle.public_tunnel_error = None;
            handle.public_tunnel_config_key = None;
            (handle.addr, handle.public_tunnel.take())
        };

        if let Some(tunnel) = previous_tunnel {
            close_public_tunnel(tunnel);
        }

        let mut tunnel = Some(start_ngrok_tunnel(addr, config).await?);
        {
            let mut servers = self.servers.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(handle) = servers.get_mut(workspace_id) {
                if handle.public_tunnel.is_none() {
                    handle.public_tunnel = tunnel.take();
                    handle.public_tunnel_error = None;
                    handle.public_tunnel_config_key = Some(requested_config_key);
                    return Ok(());
                }
            }
        }

        if let Some(tunnel) = tunnel {
            close_public_tunnel(tunnel);
        }
        Ok(())
    }

    fn set_public_tunnel_error(&self, workspace_id: &str, error: Option<String>) {
        let mut servers = self.servers.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(handle) = servers.get_mut(workspace_id) {
            handle.public_tunnel_error = error;
        }
    }

    fn stop_public_tunnel(&self, workspace_id: &str) {
        let tunnel = {
            let mut servers = self.servers.lock().unwrap_or_else(|e| e.into_inner());
            let Some(handle) = servers.get_mut(workspace_id) else {
                return;
            };
            handle.public_tunnel_error = None;
            handle.public_tunnel_config_key = None;
            handle.public_tunnel.take()
        };
        if let Some(tunnel) = tunnel {
            close_public_tunnel(tunnel);
        }
    }

    pub fn stop(&self, workspace_id: &str) {
        let handle = self
            .servers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(workspace_id);
        if let Some(mut handle) = handle {
            if let Some(tunnel) = handle.public_tunnel.take() {
                close_public_tunnel(tunnel);
            }
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
    let public_url = handle
        .public_tunnel
        .as_ref()
        .map(|tunnel| tunnel.public_url.clone());
    DebugIngestStatus {
        workspace_id: workspace_id.to_string(),
        running: true,
        url: Some(url.clone()),
        ingest_url: Some(ingest_url_for(&url, &handle.token)),
        public_ingest_url: public_url
            .as_ref()
            .map(|url| ingest_url_for(url, &handle.token)),
        public_url,
        tunnel_provider: handle.public_tunnel.as_ref().map(|_| "ngrok".to_string()),
        tunnel_error: handle.public_tunnel_error.clone(),
        host: Some(handle.addr.ip().to_string()),
        port: Some(handle.addr.port()),
        entry_count,
    }
}

fn ingest_url_for(base_url: &str, token: &str) -> String {
    format!("{}/ingest?token={}", base_url.trim_end_matches('/'), token)
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
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(payload): Json<Value>,
) -> Result<Json<DebugIngestEntry>, (StatusCode, Json<Value>)> {
    require_debug_token(&state, &headers, &query)?;

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

async fn get_ingest(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Vec<DebugIngestEntry>>, (StatusCode, Json<Value>)> {
    require_debug_token(&state, &headers, &query)?;

    let entries = state
        .entries
        .lock()
        .map(|entries| entries.iter().cloned().collect())
        .unwrap_or_default();
    Ok(Json(entries))
}

async fn delete_ingest(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_debug_token(&state, &headers, &query)?;

    if let Ok(mut entries) = state.entries.lock() {
        entries.clear();
    }
    publish(&state.subscribers, DebugIngestEvent::Cleared);
    Ok(Json(json!({ "ok": true })))
}

fn require_debug_token(
    state: &ServerState,
    headers: &HeaderMap,
    query: &HashMap<String, String>,
) -> Result<(), (StatusCode, Json<Value>)> {
    let query_token = query.get("token").map(String::as_str);
    let header_token = headers
        .get(DEBUG_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok());
    let bearer_token = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));

    if [query_token, header_token, bearer_token]
        .into_iter()
        .flatten()
        .any(|candidate| candidate == state.token)
    {
        return Ok(());
    }

    Err(json_error(
        StatusCode::UNAUTHORIZED,
        "Missing or invalid debug ingest token",
    ))
}

fn public_tunnel_config_key(config: &DebugIngestPublicForwardConfig) -> String {
    let domain = config
        .ngrok_domain
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("dynamic");
    format!("ngrok:{domain}")
}

async fn start_ngrok_tunnel(
    addr: SocketAddr,
    config: &DebugIngestPublicForwardConfig,
) -> Result<PublicTunnelHandle> {
    let auth_token = env::var("NGROK_AUTHTOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .context("Public debug ingest requires NGROK_AUTHTOKEN in Helmor's environment")?;
    let local_url = Url::parse(&format!("http://{addr}"))
        .context("Failed to build local debug ingest URL for ngrok")?;
    let mut session_builder = ngrok::Session::builder();
    let session = session_builder
        .authtoken(auth_token)
        .connect()
        .await
        .context("Failed to connect ngrok session")?;
    let mut endpoint = session.http_endpoint();
    let configured_domain = config
        .ngrok_domain
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            env::var(NGROK_DOMAIN_ENV)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        });
    if let Some(domain) = configured_domain {
        endpoint.domain(domain);
    }
    let forwarder = endpoint
        .listen_and_forward(local_url)
        .await
        .context("Failed to start ngrok debug ingest tunnel")?;
    let public_url = forwarder.url().trim_end_matches('/').to_string();
    tracing::info!(%public_url, "Started ngrok debug ingest tunnel");
    Ok(PublicTunnelHandle {
        public_url,
        forwarder,
    })
}

fn close_public_tunnel(tunnel: PublicTunnelHandle) {
    tauri::async_runtime::spawn(async move {
        let mut forwarder = tunnel.forwarder;
        if let Err(error) = forwarder.close().await {
            tracing::warn!(%error, "Failed to close ngrok debug ingest tunnel");
        }
        forwarder.join().abort();
    });
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
        let first = manager.ensure("workspace-1", None).await.unwrap();
        let second = manager.ensure("workspace-1", None).await.unwrap();
        assert_eq!(first.ingest_url, second.ingest_url);
        manager.stop("workspace-1");
    }

    #[tokio::test]
    async fn post_get_and_delete_manage_buffer() {
        let manager = DebugIngestManager::new();
        let status = manager.ensure("workspace-1", None).await.unwrap();
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
        let status = manager.ensure("workspace-1", None).await.unwrap();
        let url = status.ingest_url.unwrap();

        let response = json_request(reqwest::Method::POST, &url, Some(json!(["nope"]))).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(manager.entries("workspace-1").is_empty());
        manager.stop("workspace-1");
    }

    #[tokio::test]
    async fn post_rejects_invalid_json() {
        let manager = DebugIngestManager::new();
        let status = manager.ensure("workspace-1", None).await.unwrap();
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
    async fn ingest_requires_workspace_token() {
        let manager = DebugIngestManager::new();
        let status = manager.ensure("workspace-1", None).await.unwrap();
        let base_url = status.url.unwrap();

        let response = json_request(
            reqwest::Method::POST,
            &format!("{base_url}/ingest"),
            Some(json!({ "message": "no token" })),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(manager.entries("workspace-1").is_empty());
        manager.stop("workspace-1");
    }

    #[tokio::test]
    async fn public_forward_disabled_by_default() {
        let manager = DebugIngestManager::new();
        let status = manager.ensure("workspace-1", None).await.unwrap();
        assert_eq!(status.tunnel_provider, None);
        assert_eq!(status.public_url, None);
        assert_eq!(status.public_ingest_url, None);
        assert_eq!(status.tunnel_error, None);
        manager.stop("workspace-1");
    }

    #[tokio::test]
    async fn stop_removes_workspace_state() {
        let manager = DebugIngestManager::new();
        manager.ensure("workspace-1", None).await.unwrap();
        manager.stop("workspace-1");
        assert!(manager.status("workspace-1").is_none());
    }
}
