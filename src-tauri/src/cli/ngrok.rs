//! `helmor ngrok` — manage Debug ingest public forwarding.

use anyhow::Result;
use serde::Serialize;

use crate::debug_ingest::{DebugIngestOverview, DebugIngestStatus};
use crate::ngrok_config::{self, NgrokConfigStatus, NgrokConfigUpdate};

use super::args::{Cli, NgrokAction, NgrokDomainAction};
use super::output;

pub fn dispatch(action: &NgrokAction, cli: &Cli) -> Result<()> {
    match action {
        NgrokAction::Status => print_status(cli),
        NgrokAction::Overview => print_overview(cli),
        NgrokAction::Ensure { workspace_ref } => ensure_workspace(workspace_ref, cli),
        NgrokAction::Stop { workspace_ref } => stop_workspace(workspace_ref, cli),
        NgrokAction::Enable { domain } => update(
            NgrokConfigUpdate {
                enabled: Some(true),
                domain: domain.as_ref().map(|value| Some(value.clone())),
            },
            cli,
            "Enabled Debug ingest ngrok forwarding.",
        ),
        NgrokAction::Disable => {
            let status = ngrok_config::update(NgrokConfigUpdate {
                enabled: Some(false),
                domain: None,
            })?;
            let reset_sent = ngrok_config::reset_running_app_tunnels();
            print_updated(
                cli,
                &status,
                &format!(
                    "Disabled Debug ingest ngrok forwarding. Active tunnel reset sent: {}",
                    yes_no(reset_sent)
                ),
            )
        }
        NgrokAction::Domain { action } => match action {
            NgrokDomainAction::Set { domain } => update(
                NgrokConfigUpdate {
                    enabled: None,
                    domain: Some(Some(domain.clone())),
                },
                cli,
                "Updated Debug ingest ngrok domain.",
            ),
            NgrokDomainAction::Clear => update(
                NgrokConfigUpdate {
                    enabled: None,
                    domain: Some(None),
                },
                cli,
                "Cleared Debug ingest ngrok domain.",
            ),
        },
        NgrokAction::Reset => {
            let status = ngrok_config::reset()?;
            print_updated(cli, &status, "Reset Debug ingest ngrok forwarding.")
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NgrokOverviewReport {
    settings: NgrokConfigStatus,
    live_overview_available: bool,
    app_request_error: Option<String>,
    overview: Option<DebugIngestOverview>,
    ingest_urls: Vec<IngestEndpoint>,
    guide: ngrok_config::NgrokManagementGuide,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IngestEndpoint {
    workspace_id: String,
    local_ingest_url: Option<String>,
    public_ingest_url: Option<String>,
    tunnel_error: Option<String>,
    entry_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NgrokEnsureReport {
    settings: NgrokConfigStatus,
    status: DebugIngestStatus,
    guide: ngrok_config::NgrokManagementGuide,
}

fn print_status(cli: &Cli) -> Result<()> {
    let status = ngrok_config::status()?;
    output::print(cli, &status, human_status)
}

fn print_overview(cli: &Cli) -> Result<()> {
    let report = overview_report()?;
    output::print(cli, &report, human_overview)
}

fn ensure_workspace(workspace_ref: &str, cli: &Cli) -> Result<()> {
    let workspace_id = crate::service::resolve_workspace_ref(workspace_ref)?;
    let public_forward = ngrok_config::public_forward_config()?;
    let Some(status) =
        crate::ui_sync::ensure_running_app_debug_ingest(&workspace_id, Some(public_forward))?
    else {
        anyhow::bail!("Helmor app is not running; start the app before ensuring Debug ingest URLs");
    };
    let report = NgrokEnsureReport {
        settings: ngrok_config::status()?,
        status,
        guide: ngrok_config::management_guide(),
    };
    output::print(cli, &report, human_ensure)
}

fn stop_workspace(workspace_ref: &str, cli: &Cli) -> Result<()> {
    let workspace_id = crate::service::resolve_workspace_ref(workspace_ref)?;
    let stopped = crate::ui_sync::stop_running_app_debug_ingest(&workspace_id)?;
    if stopped {
        output::print_ok(cli, "Stopped Debug ingest for workspace.");
        Ok(())
    } else {
        anyhow::bail!("Helmor app is not running; no Debug ingest server was stopped")
    }
}

fn update(update: NgrokConfigUpdate, cli: &Cli, message: &str) -> Result<()> {
    let status = ngrok_config::update(update)?;
    print_updated(cli, &status, message)
}

fn print_updated(cli: &Cli, status: &NgrokConfigStatus, message: &str) -> Result<()> {
    output::print(cli, status, |status| {
        format!("{message}\n\n{}", human_status(status))
    })
}

fn human_status(status: &NgrokConfigStatus) -> String {
    format!(
        "Enabled:           {}\nDomain:            {}\nNGROK_AUTHTOKEN:   {}\nRunning app:       {}\n\nUse `helmor ngrok overview` to list live ingest URLs and recovery steps.",
        yes_no(status.enabled),
        status.domain.as_deref().unwrap_or("(dynamic)"),
        yes_no(status.ngrok_authtoken_present),
        yes_no(status.running_app_available),
    )
}

fn overview_report() -> Result<NgrokOverviewReport> {
    let settings = ngrok_config::status()?;
    let (overview, app_request_error) = match crate::ui_sync::request_debug_ingest_overview() {
        Ok(overview) => (overview, None),
        Err(error) => (None, Some(format!("{error:#}"))),
    };
    let ingest_urls = overview
        .as_ref()
        .map(|overview| {
            overview
                .instances
                .iter()
                .map(|instance| IngestEndpoint {
                    workspace_id: instance.workspace_id.clone(),
                    local_ingest_url: instance.ingest_url.clone(),
                    public_ingest_url: instance.public_ingest_url.clone(),
                    tunnel_error: instance.tunnel_error.clone(),
                    entry_count: instance.entry_count,
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(NgrokOverviewReport {
        live_overview_available: overview.is_some(),
        app_request_error,
        settings,
        overview,
        ingest_urls,
        guide: ngrok_config::management_guide(),
    })
}

fn human_overview(report: &NgrokOverviewReport) -> String {
    let mut lines = vec![
        human_status(&report.settings),
        String::new(),
        "Ingest URLs:".to_string(),
    ];

    if !report.live_overview_available {
        lines.push(if report.app_request_error.is_some() {
            "  Running Helmor app could not provide live ingest URLs and tokens.".to_string()
        } else {
            "  Helmor app is not running; live ingest URLs and tokens are unavailable.".to_string()
        });
        if let Some(error) = &report.app_request_error {
            lines.push(format!("  App request error: {error}"));
        }
    } else if report.ingest_urls.is_empty() {
        lines.push(
            "  No Debug ingest servers are running. Use `helmor ngrok ensure <workspace>` or enable Debug mode in a workspace.".to_string(),
        );
    } else {
        for endpoint in &report.ingest_urls {
            lines.push(format!("  Workspace: {}", endpoint.workspace_id));
            lines.push(format!(
                "    Local:  {}",
                endpoint.local_ingest_url.as_deref().unwrap_or("(none)")
            ));
            lines.push(format!(
                "    Public: {}",
                endpoint
                    .public_ingest_url
                    .as_deref()
                    .unwrap_or("(not exposed)")
            ));
            lines.push(format!("    Entries: {}", endpoint.entry_count));
            if let Some(error) = &endpoint.tunnel_error {
                lines.push(format!("    Tunnel error: {error}"));
            }
        }
    }

    if let Some(overview) = &report.overview {
        lines.push(String::new());
        lines.push(format!(
            "ngrok agent: {}{}",
            if overview.ngrok_agent.connected {
                "connected"
            } else {
                "idle"
            },
            overview
                .ngrok_agent
                .session_id
                .as_ref()
                .map(|id| format!(" ({id})"))
                .unwrap_or_default()
        ));
        if let Some(error) = &overview.ngrok_agent.last_error {
            lines.push(format!("last error: {error}"));
        }
    }

    lines.push(String::new());
    lines.push("Process:".to_string());
    lines.extend(
        report
            .guide
            .process
            .iter()
            .map(|step| format!("  - {step}")),
    );
    lines.push(String::new());
    lines.push("Stale recovery:".to_string());
    lines.extend(
        report
            .guide
            .stale_recovery
            .iter()
            .map(|step| format!("  - {step}")),
    );

    lines.join("\n")
}

fn human_ensure(report: &NgrokEnsureReport) -> String {
    let mut lines = vec![
        "Ensured Debug ingest for workspace.".to_string(),
        format!("Workspace: {}", report.status.workspace_id),
        format!(
            "Local ingest:  {}",
            report.status.ingest_url.as_deref().unwrap_or("(none)")
        ),
        format!(
            "Public ingest: {}",
            report
                .status
                .public_ingest_url
                .as_deref()
                .unwrap_or("(not exposed)")
        ),
    ];
    if let Some(error) = &report.status.tunnel_error {
        lines.push(format!("Tunnel error: {error}"));
    }
    lines.push(String::new());
    lines.push(format!(
        "Forwarding: {} ({})",
        yes_no(report.settings.enabled),
        report
            .settings
            .domain
            .as_deref()
            .unwrap_or("dynamic domain")
    ));
    lines.join("\n")
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
    fn human_status_uses_dynamic_domain_when_unset() {
        let status = NgrokConfigStatus {
            enabled: true,
            domain: None,
            ngrok_authtoken_present: false,
            running_app_available: true,
        };

        let rendered = human_status(&status);
        assert!(rendered.contains("Enabled:           yes"));
        assert!(rendered.contains("Domain:            (dynamic)"));
        assert!(rendered.contains("NGROK_AUTHTOKEN:   no"));
        assert!(rendered.contains("Running app:       yes"));
    }

    #[test]
    fn human_overview_lists_public_ingest_urls_and_recovery() {
        let report = NgrokOverviewReport {
            settings: NgrokConfigStatus {
                enabled: true,
                domain: None,
                ngrok_authtoken_present: true,
                running_app_available: true,
            },
            live_overview_available: true,
            app_request_error: None,
            overview: None,
            ingest_urls: vec![IngestEndpoint {
                workspace_id: "workspace-1".to_string(),
                local_ingest_url: Some("http://127.0.0.1:1/ingest?token=local".to_string()),
                public_ingest_url: Some("https://debug.ngrok.app/ingest?token=public".to_string()),
                tunnel_error: None,
                entry_count: 2,
            }],
            guide: ngrok_config::management_guide(),
        };

        let rendered = human_overview(&report);
        assert!(rendered.contains("https://debug.ngrok.app/ingest?token=public"));
        assert!(rendered.contains("Stale recovery:"));
        assert!(rendered.contains("helmor ngrok reset"));
    }
}
