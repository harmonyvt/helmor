use anyhow::Result;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub(crate) const ENABLED_KEY: &str = "app.remote_enabled";
const BIND_ADDR_KEY: &str = "app.remote_bind_addr";
const PORT_KEY: &str = "app.remote_port";
pub(crate) const TOKEN_KEY: &str = "app.remote_pairing_token";
const DEFAULT_BIND_ADDR: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 4317;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessConfig {
    pub enabled: bool,
    pub bind_addr: String,
    pub port: u16,
    pub token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessStatus {
    pub enabled: bool,
    pub bind_addr: String,
    pub port: u16,
    pub token: String,
    pub url: String,
    pub running: bool,
}

pub fn load_config() -> Result<RemoteAccessConfig> {
    let enabled = crate::settings::load_setting_value(ENABLED_KEY)?
        .map(|value| value == "true")
        .unwrap_or(false);
    let bind_addr = crate::settings::load_setting_value(BIND_ADDR_KEY)?
        .map(|value| normalize_bind_addr(&value))
        .unwrap_or_else(|| DEFAULT_BIND_ADDR.to_string());
    let port = crate::settings::load_setting_value(PORT_KEY)?
        .and_then(|value| value.parse::<u16>().ok())
        .map(normalize_port)
        .unwrap_or(DEFAULT_PORT);
    let token = ensure_token()?;

    Ok(RemoteAccessConfig {
        enabled,
        bind_addr,
        port,
        token,
    })
}

pub(crate) fn save_config(config: &RemoteAccessConfig) -> Result<()> {
    crate::settings::upsert_setting_value(ENABLED_KEY, &config.enabled.to_string())?;
    crate::settings::upsert_setting_value(BIND_ADDR_KEY, &config.bind_addr)?;
    crate::settings::upsert_setting_value(PORT_KEY, &config.port.to_string())?;
    crate::settings::upsert_setting_value(TOKEN_KEY, &config.token)?;
    Ok(())
}

pub(crate) fn ensure_token() -> Result<String> {
    if let Some(token) = crate::settings::load_setting_value(TOKEN_KEY)?
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
    {
        return Ok(token);
    }
    let token = new_token();
    crate::settings::upsert_setting_value(TOKEN_KEY, &token)?;
    Ok(token)
}

pub(crate) fn new_token() -> String {
    Uuid::new_v4().simple().to_string()
}

pub(crate) fn normalize_bind_addr(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        DEFAULT_BIND_ADDR.to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn normalize_port(port: u16) -> u16 {
    if port == 0 {
        DEFAULT_PORT
    } else {
        port
    }
}

pub(crate) fn status_from_config(config: RemoteAccessConfig, running: bool) -> RemoteAccessStatus {
    RemoteAccessStatus {
        url: config_url(&config),
        enabled: config.enabled,
        bind_addr: config.bind_addr,
        port: config.port,
        token: config.token,
        running,
    }
}

pub(crate) fn config_url(config: &RemoteAccessConfig) -> String {
    format!("http://{}:{}", config.bind_addr, config.port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_port_uses_default() {
        assert_eq!(normalize_port(0), DEFAULT_PORT);
        assert_eq!(normalize_port(8080), 8080);
    }
}
