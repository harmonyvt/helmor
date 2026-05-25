use std::env;
use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::{Context, Result};
use ngrok::forwarder::Forwarder;
use ngrok::prelude::{EndpointInfo, ForwarderBuilder, TunnelCloser};
use ngrok::tunnel::HttpTunnel;
use ngrok::Session;
use url::Url;

use super::{DebugIngestPublicForwardConfig, NgrokAgentStatus};

const NGROK_DOMAIN_ENV: &str = "HELMOR_DEBUG_INGEST_NGROK_DOMAIN";

pub(super) struct PublicTunnelHandle {
    pub(super) public_url: String,
    forwarder: Forwarder<HttpTunnel>,
}

#[derive(Default)]
struct NgrokAgentState {
    session: Option<Session>,
    auth_token: Option<String>,
    last_error: Option<String>,
}

#[derive(Clone, Default)]
pub(super) struct NgrokTunnelManager {
    agent: Arc<tokio::sync::Mutex<NgrokAgentState>>,
}

impl NgrokTunnelManager {
    pub(super) async fn start(
        &self,
        addr: SocketAddr,
        config: &DebugIngestPublicForwardConfig,
    ) -> Result<PublicTunnelHandle> {
        let session = self.shared_session().await?;
        let local_url = Url::parse(&format!("http://{addr}"))
            .context("Failed to build local debug ingest URL for ngrok")?;
        let mut endpoint = session.http_endpoint();
        if let Some(domain) = configured_domain(config) {
            endpoint.domain(domain);
        }
        let forwarder = endpoint
            .listen_and_forward(local_url)
            .await
            .context("Failed to start ngrok debug ingest tunnel")?;
        let public_url = forwarder.url().trim_end_matches('/').to_string();
        tracing::info!(%public_url, session_id = %session.id(), "Started ngrok debug ingest tunnel");
        Ok(PublicTunnelHandle {
            public_url,
            forwarder,
        })
    }

    pub(super) async fn status(&self, active_tunnel_count: usize) -> NgrokAgentStatus {
        let agent = self.agent.lock().await;
        NgrokAgentStatus {
            connected: agent.session.is_some(),
            session_id: agent.session.as_ref().map(Session::id),
            active_tunnel_count,
            last_error: agent.last_error.clone(),
        }
    }

    pub(super) fn close_agent_if_idle(&self) {
        let agent = Arc::clone(&self.agent);
        tauri::async_runtime::spawn(async move {
            let mut agent = agent.lock().await;
            let Some(mut session) = agent.session.take() else {
                return;
            };
            agent.auth_token = None;
            if let Err(error) = session.close().await {
                tracing::warn!(%error, "Failed to close shared ngrok debug ingest agent session");
            } else {
                tracing::info!("Closed shared ngrok debug ingest agent session");
            }
        });
    }

    async fn shared_session(&self) -> Result<Session> {
        let auth_token = auth_token_from_env()?;

        let mut agent = self.agent.lock().await;
        if agent.auth_token.as_deref() == Some(auth_token.as_str()) {
            if let Some(session) = &agent.session {
                return Ok(session.clone());
            }
        }

        let mut session_builder = Session::builder();
        match session_builder.authtoken_from_env().connect().await {
            Ok(session) => {
                agent.auth_token = Some(auth_token);
                agent.last_error = None;
                agent.session = Some(session.clone());
                tracing::info!(session_id = %session.id(), "Connected shared ngrok debug ingest agent session");
                Ok(session)
            }
            Err(error) => {
                let message = format!("Failed to connect ngrok session: {error:#}");
                agent.last_error = Some(message.clone());
                Err(anyhow::anyhow!(message))
            }
        }
    }
}

pub(super) fn config_key(config: &DebugIngestPublicForwardConfig) -> String {
    let domain = configured_domain(config).unwrap_or_else(|| "dynamic".to_string());
    format!("ngrok:{domain}")
}

pub(super) fn close_public_tunnel(tunnel: PublicTunnelHandle) {
    tauri::async_runtime::spawn(async move {
        let mut forwarder = tunnel.forwarder;
        if let Err(error) = forwarder.close().await {
            tracing::warn!(%error, "Failed to close ngrok debug ingest tunnel");
        }
        forwarder.join().abort();
    });
}

fn auth_token_from_env() -> Result<String> {
    env::var("NGROK_AUTHTOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .context("Public debug ingest requires NGROK_AUTHTOKEN in Helmor's environment")
}

fn configured_domain(config: &DebugIngestPublicForwardConfig) -> Option<String> {
    config
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
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_key_prefers_explicit_domain() {
        let key = config_key(&DebugIngestPublicForwardConfig {
            enabled: true,
            ngrok_domain: Some("example.ngrok.app".to_string()),
        });

        assert_eq!(key, "ngrok:example.ngrok.app");
    }
}
