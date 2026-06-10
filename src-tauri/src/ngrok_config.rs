//! Shared ngrok Debug ingest configuration used by CLI and MCP tools.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::models::settings as settings_store;
use crate::ui_sync::UiMutationEvent;

pub const PUBLIC_FORWARD_KEY: &str = "app.debug_ingest_public_forward";
pub const NGROK_DOMAIN_KEY: &str = "app.debug_ingest_ngrok_domain";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NgrokConfigStatus {
    pub enabled: bool,
    pub domain: Option<String>,
    pub ngrok_authtoken_present: bool,
    pub running_app_available: bool,
}

#[derive(Debug, Clone, Default)]
pub struct NgrokConfigUpdate {
    pub enabled: Option<bool>,
    pub domain: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NgrokManagementGuide {
    pub process: Vec<String>,
    pub ingest_api: Vec<String>,
    pub stale_recovery: Vec<String>,
    pub commands: Vec<String>,
}

pub fn status() -> Result<NgrokConfigStatus> {
    Ok(NgrokConfigStatus {
        enabled: read_enabled()?,
        domain: read_domain()?,
        ngrok_authtoken_present: std::env::var("NGROK_AUTHTOKEN")
            .ok()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        running_app_available: crate::ui_sync::is_listener_running(),
    })
}

pub fn update(update: NgrokConfigUpdate) -> Result<NgrokConfigStatus> {
    if let Some(enabled) = update.enabled {
        settings_store::upsert_setting_value(PUBLIC_FORWARD_KEY, bool_value(enabled))
            .with_context(|| format!("Failed to update {PUBLIC_FORWARD_KEY}"))?;
    }

    if let Some(domain) = update.domain {
        write_domain(domain.as_deref())?;
    }

    notify_settings_changed();
    status()
}

pub fn reset() -> Result<NgrokConfigStatus> {
    settings_store::upsert_setting_value(PUBLIC_FORWARD_KEY, "false")
        .with_context(|| format!("Failed to update {PUBLIC_FORWARD_KEY}"))?;
    write_domain(None)?;
    notify_settings_changed();
    let _ = crate::ui_sync::notify_running_app(UiMutationEvent::DebugIngestNgrokResetRequested);
    status()
}

pub fn public_forward_config() -> Result<crate::debug_ingest::DebugIngestPublicForwardConfig> {
    Ok(crate::debug_ingest::DebugIngestPublicForwardConfig {
        enabled: read_enabled()?,
        ngrok_domain: read_domain()?,
    })
}

pub fn management_guide() -> NgrokManagementGuide {
    NgrokManagementGuide {
        process: vec![
            "Enable public forwarding with `helmor ngrok enable`; add `--domain <reserved-domain>` when the ngrok account owns a stable domain.".to_string(),
            "Start Debug mode for a workspace, or run `helmor ngrok ensure <workspace>` while the Helmor app is running, so the app can allocate the local ingest server and token.".to_string(),
            "Read live ingest URLs with `helmor ngrok overview`; agents should prefer `publicIngestUrl` for remote previews and `ingestUrl` for local-only producers.".to_string(),
            "Send evidence with POST /ingest?token=... using JSON; read collected evidence with GET; clear it with DELETE.".to_string(),
        ],
        ingest_api: vec![
            "GET /health returns a lightweight liveness payload.".to_string(),
            "GET /ingest?token=... returns the current workspace evidence buffer.".to_string(),
            "POST /ingest?token=... stores a JSON payload such as `{ \"level\": \"info\", \"source\": \"agent\", \"message\": \"captured evidence\" }`.".to_string(),
            "DELETE /ingest?token=... clears the current workspace evidence buffer.".to_string(),
        ],
        stale_recovery: vec![
            "If a public URL is stale, run `helmor ngrok overview` and check `tunnelError`, `publicIngestUrl`, and `ngrokAgent.lastError`.".to_string(),
            "If the running app is unavailable, start Helmor first; ingest servers and tokens are in app memory and cannot be reconstructed from the database.".to_string(),
            "Run `helmor ngrok ensure <workspace>` to re-open the workspace ingest server and recreate its ngrok tunnel with current settings.".to_string(),
            "Run `helmor ngrok reset` when tunnels are wedged; then re-enable or ensure the workspace again.".to_string(),
        ],
        commands: vec![
            "helmor ngrok status".to_string(),
            "helmor ngrok overview".to_string(),
            "helmor ngrok enable --domain <domain>".to_string(),
            "helmor ngrok ensure <workspace>".to_string(),
            "helmor ngrok stop <workspace>".to_string(),
            "helmor ngrok reset".to_string(),
        ],
    }
}

pub fn reset_running_app_tunnels() -> bool {
    crate::ui_sync::notify_running_app(UiMutationEvent::DebugIngestNgrokResetRequested)
        .unwrap_or(false)
}

fn read_enabled() -> Result<bool> {
    Ok(settings_store::load_setting_value(PUBLIC_FORWARD_KEY)?
        .as_deref()
        .map(|value| value == "true")
        .unwrap_or(false))
}

fn read_domain() -> Result<Option<String>> {
    Ok(settings_store::load_setting_value(NGROK_DOMAIN_KEY)?
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty()))
}

fn write_domain(domain: Option<&str>) -> Result<()> {
    let domain = domain.map(str::trim).filter(|value| !value.is_empty());
    match domain {
        Some(domain) => settings_store::upsert_setting_value(NGROK_DOMAIN_KEY, domain)
            .with_context(|| format!("Failed to update {NGROK_DOMAIN_KEY}"))?,
        None => {
            settings_store::delete_setting_value(NGROK_DOMAIN_KEY)
                .with_context(|| format!("Failed to clear {NGROK_DOMAIN_KEY}"))?;
        }
    }
    Ok(())
}

fn notify_settings_changed() {
    let _ = crate::ui_sync::notify_running_app(UiMutationEvent::SettingsChanged { key: None });
}

fn bool_value(value: bool) -> &'static str {
    if value {
        "true"
    } else {
        "false"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bool_value_matches_app_settings_storage() {
        assert_eq!(bool_value(true), "true");
        assert_eq!(bool_value(false), "false");
    }

    #[test]
    fn status_serializes_camel_case() {
        let status = NgrokConfigStatus {
            enabled: true,
            domain: Some("debug.example.ngrok.app".to_string()),
            ngrok_authtoken_present: true,
            running_app_available: false,
        };
        let json = serde_json::to_value(status).unwrap();
        assert_eq!(json["enabled"], true);
        assert_eq!(json["domain"], "debug.example.ngrok.app");
        assert_eq!(json["ngrokAuthtokenPresent"], true);
        assert_eq!(json["runningAppAvailable"], false);
    }

    #[test]
    fn management_guide_names_ingest_urls_and_recovery_commands() {
        let guide = management_guide();
        assert!(guide
            .process
            .iter()
            .any(|step| step.contains("publicIngestUrl")));
        assert!(guide
            .stale_recovery
            .iter()
            .any(|step| step.contains("helmor ngrok reset")));
    }
}
