//! `helmor debug` — terminal-first Helmor debugging tools.

use std::io::{self, Write};

use anyhow::{Context, Result};
use serde::Serialize;

use crate::debug_ingest::{DebugIngestManager, DebugIngestPublicForwardConfig, DebugIngestStatus};
use crate::ngrok_config::{self, NgrokConfigStatus};
use crate::service;

use super::args::{Cli, DebugAction, DebugIngestAction, DebugIngestServeArgs};
use super::output;

pub fn dispatch(action: &DebugAction, cli: &Cli) -> Result<()> {
    match action {
        DebugAction::Status => status(cli),
        DebugAction::Ingest { action } => ingest(action, cli),
        DebugAction::Ngrok { action } => super::ngrok::dispatch(action, cli),
    }
}

fn status(cli: &Cli) -> Result<()> {
    let data = service::get_data_info()?;
    let public_forward = ngrok_config::status()?;
    let status = DebugCliStatus {
        app_running: service::is_app_running(),
        data_dir: data.data_dir,
        db_path: data.db_path,
        public_forward,
        standalone_ingest_command: format!(
            "{} debug ingest serve --workspace <workspace-ref>",
            super::installed_cli_name()
        ),
        ngrok_domain_hint:
            "Ask whether to reuse an existing ngrok domain before setting or replacing one."
                .to_string(),
    };
    output::print(cli, &status, human_status)
}

fn ingest(action: &DebugIngestAction, cli: &Cli) -> Result<()> {
    match action {
        DebugIngestAction::Serve(args) => serve_ingest(args, cli),
    }
}

fn serve_ingest(args: &DebugIngestServeArgs, cli: &Cli) -> Result<()> {
    let workspace_id = service::resolve_workspace_ref(&args.workspace)?;
    let public_forward = public_forward_config(args)?;
    let manager = DebugIngestManager::new();
    let status =
        tauri::async_runtime::block_on(manager.ensure(&workspace_id, public_forward.clone()))
            .context("Failed to start standalone Debug ingest receiver")?;
    let started = DebugIngestServeStarted {
        workspace_ref: args.workspace.clone(),
        workspace_id: workspace_id.clone(),
        public_forward_requested: public_forward
            .as_ref()
            .map(|config| config.enabled)
            .unwrap_or(false),
        status,
    };

    output::print(cli, &started, human_serve_started)?;
    io::stdout().flush().ok();

    tauri::async_runtime::block_on(async {
        tokio::signal::ctrl_c()
            .await
            .context("Failed to listen for Ctrl-C")
    })?;

    manager.stop(&workspace_id);
    if !cli.json && !cli.quiet {
        println!("Stopped Debug ingest receiver.");
    }
    Ok(())
}

fn public_forward_config(
    args: &DebugIngestServeArgs,
) -> Result<Option<DebugIngestPublicForwardConfig>> {
    if args.no_public {
        return Ok(Some(DebugIngestPublicForwardConfig {
            enabled: false,
            ngrok_domain: None,
        }));
    }

    let saved = ngrok_config::status()?;
    let enabled = args.public || args.domain.is_some() || saved.enabled;
    if !enabled {
        return Ok(None);
    }

    Ok(Some(DebugIngestPublicForwardConfig {
        enabled: true,
        ngrok_domain: args.domain.clone().or(saved.domain),
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugCliStatus {
    app_running: bool,
    data_dir: String,
    db_path: String,
    public_forward: NgrokConfigStatus,
    standalone_ingest_command: String,
    ngrok_domain_hint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugIngestServeStarted {
    workspace_ref: String,
    workspace_id: String,
    public_forward_requested: bool,
    status: DebugIngestStatus,
}

fn human_status(status: &DebugCliStatus) -> String {
    format!(
        "App running:        {}\nData dir:           {}\nDatabase:           {}\nPublic forwarding:  {}\nNgrok domain:       {}\nDomain hint:        {}\nNGROK_AUTHTOKEN:    {}\nStandalone ingest:  {}",
        yes_no(status.app_running),
        status.data_dir,
        status.db_path,
        yes_no(status.public_forward.enabled),
        status.public_forward.domain.as_deref().unwrap_or("(dynamic)"),
        status.ngrok_domain_hint,
        yes_no(status.public_forward.ngrok_authtoken_present),
        status.standalone_ingest_command,
    )
}

fn human_serve_started(started: &DebugIngestServeStarted) -> String {
    let status = &started.status;
    let primary_url = status
        .public_ingest_url
        .as_ref()
        .or(status.ingest_url.as_ref())
        .map(String::as_str)
        .unwrap_or("(unavailable)");
    let public_url = status
        .public_ingest_url
        .as_deref()
        .unwrap_or("(not active)");
    let tunnel = match status.tunnel_error.as_deref() {
        Some(error) => format!("failed: {error}"),
        None if status.tunnel_provider.is_some() => "active".to_string(),
        None if started.public_forward_requested => "requested".to_string(),
        None => "disabled".to_string(),
    };

    format!(
        "Debug ingest receiver running.\nWorkspace:      {}\nLocal endpoint: {}\nPublic endpoint: {}\nPublic tunnel:  {}\n\nUse:\n  curl -s '{}'\n  curl -s -X DELETE '{}'\n\nPress Ctrl-C to stop.",
        started.workspace_id,
        status.ingest_url.as_deref().unwrap_or("(unavailable)"),
        public_url,
        tunnel,
        primary_url,
        primary_url,
    )
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "yes"
    } else {
        "no"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn human_status_points_agents_to_debug_ingest_serve() {
        let rendered = human_status(&DebugCliStatus {
            app_running: false,
            data_dir: "/tmp/helmor".to_string(),
            db_path: "/tmp/helmor/helmor.sqlite".to_string(),
            public_forward: NgrokConfigStatus {
                enabled: true,
                domain: Some("debug.example.ngrok.app".to_string()),
                ngrok_authtoken_present: false,
                running_app_available: false,
            },
            standalone_ingest_command: "helmor debug ingest serve --workspace <workspace-ref>"
                .to_string(),
            ngrok_domain_hint:
                "Ask whether to reuse an existing ngrok domain before setting or replacing one."
                    .to_string(),
        });

        assert!(rendered.contains("App running:        no"));
        assert!(rendered.contains("Ngrok domain:       debug.example.ngrok.app"));
        assert!(
            rendered.contains("Domain hint:        Ask whether to reuse an existing ngrok domain")
        );
        assert!(rendered.contains("helmor debug ingest serve --workspace <workspace-ref>"));
    }

    #[test]
    fn human_serve_started_prefers_public_endpoint_when_available() {
        let rendered = human_serve_started(&DebugIngestServeStarted {
            workspace_ref: "helmor/main".to_string(),
            workspace_id: "workspace-1".to_string(),
            public_forward_requested: true,
            status: DebugIngestStatus {
                workspace_id: "workspace-1".to_string(),
                running: true,
                url: Some("http://127.0.0.1:4010".to_string()),
                ingest_url: Some("http://127.0.0.1:4010/ingest?token=local".to_string()),
                public_url: Some("https://debug.example.ngrok.app".to_string()),
                public_ingest_url: Some(
                    "https://debug.example.ngrok.app/ingest?token=public".to_string(),
                ),
                tunnel_provider: Some("ngrok".to_string()),
                tunnel_error: None,
                host: Some("127.0.0.1".to_string()),
                port: Some(4010),
                entry_count: 0,
            },
        });

        assert!(rendered.contains("Public tunnel:  active"));
        assert!(rendered.contains("curl -s 'https://debug.example.ngrok.app/ingest?token=public'"));
    }
}
