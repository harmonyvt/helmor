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
}
