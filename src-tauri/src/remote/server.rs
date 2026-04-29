use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use anyhow::{anyhow, Context, Result};
use tauri::AppHandle;

use super::{
    config::{config_url, load_config, RemoteAccessConfig},
    http::handle_connection,
};

#[derive(Debug)]
struct RunningServer {
    bind_addr: String,
    port: u16,
    shutdown: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct RemoteServerManager {
    running: Mutex<Option<RunningServer>>,
    agent_subscribers: Mutex<Vec<std::sync::mpsc::Sender<crate::agents::AgentStreamEvent>>>,
}

impl RemoteServerManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start_if_enabled(&self, app: AppHandle) -> Result<()> {
        let config = load_config()?;
        if config.enabled {
            self.start(app, config)?;
        }
        Ok(())
    }

    pub fn start(&self, app: AppHandle, config: RemoteAccessConfig) -> Result<()> {
        if !config.enabled {
            self.stop();
            return Ok(());
        }

        let mut running = self
            .running
            .lock()
            .map_err(|_| anyhow!("remote server lock poisoned"))?;

        if running.as_ref().is_some_and(|server| {
            server.bind_addr == config.bind_addr && server.port == config.port
        }) {
            return Ok(());
        }

        if let Some(server) = running.take() {
            server.shutdown.store(true, Ordering::SeqCst);
        }

        let listener = std::net::TcpListener::bind((config.bind_addr.as_str(), config.port))
            .with_context(|| format!("Failed to bind remote server on {}", config_url(&config)))?;
        listener
            .set_nonblocking(true)
            .context("Failed to configure remote server socket")?;

        let shutdown = Arc::new(AtomicBool::new(false));
        let thread_shutdown = Arc::clone(&shutdown);
        let thread_config = config.clone();
        thread::Builder::new()
            .name("remote-mobile-server".into())
            .spawn(move || {
                tracing::info!(url = %config_url(&thread_config), "Remote mobile server started");
                while !thread_shutdown.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((stream, _addr)) => {
                            let request_app = app.clone();
                            let request_config = thread_config.clone();
                            let _ = thread::Builder::new()
                                .name("remote-mobile-request".into())
                                .spawn(move || {
                                    if let Err(error) =
                                        handle_connection(stream, request_app, request_config)
                                    {
                                        tracing::debug!(error = %format!("{error:#}"), "Remote request failed");
                                    }
                                });
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(50));
                        }
                        Err(error) => {
                            tracing::warn!(error = %error, "Remote server accept failed");
                            thread::sleep(Duration::from_millis(250));
                        }
                    }
                }
                tracing::info!("Remote mobile server stopped");
            })
            .context("Failed to spawn remote server thread")?;

        *running = Some(RunningServer {
            bind_addr: config.bind_addr,
            port: config.port,
            shutdown,
        });
        Ok(())
    }

    pub fn stop(&self) {
        if let Ok(mut running) = self.running.lock() {
            if let Some(server) = running.take() {
                server.shutdown.store(true, Ordering::SeqCst);
            }
        }
    }

    pub fn is_running(&self) -> bool {
        self.running
            .lock()
            .ok()
            .and_then(|running| running.as_ref().map(|_| ()))
            .is_some()
    }

    pub fn subscribe_agent_events(
        &self,
    ) -> std::sync::mpsc::Receiver<crate::agents::AgentStreamEvent> {
        let (sender, receiver) = std::sync::mpsc::channel();
        if let Ok(mut subscribers) = self.agent_subscribers.lock() {
            subscribers.push(sender);
        }
        receiver
    }

    pub fn publish_agent_event(&self, event: crate::agents::AgentStreamEvent) {
        let Ok(mut subscribers) = self.agent_subscribers.lock() else {
            return;
        };
        subscribers.retain(|sender| sender.send(event.clone()).is_ok());
    }
}
