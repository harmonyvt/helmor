use std::{fs, path::PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const BOOTSTRAP_SETTINGS_FILENAME: &str = "bootstrap-settings.json";

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DataDirPreference {
    #[default]
    Automatic,
    Production,
    Development,
}

impl std::fmt::Display for DataDirPreference {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::Automatic => "automatic",
            Self::Production => "production",
            Self::Development => "development",
        };
        f.write_str(value)
    }
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapSettings {
    data_dir_preference: DataDirPreference,
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn bootstrap_settings_dir() -> Result<PathBuf> {
    let home = dirs_home().context("Could not determine home directory")?;
    #[cfg(target_os = "macos")]
    {
        Ok(home
            .join("Library")
            .join("Application Support")
            .join("Helmor"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(home.join(".config").join("helmor"))
    }
}

pub fn bootstrap_settings_path() -> Result<PathBuf> {
    Ok(bootstrap_settings_dir()?.join(BOOTSTRAP_SETTINGS_FILENAME))
}

pub fn data_dir_preference() -> DataDirPreference {
    let Ok(path) = bootstrap_settings_path() else {
        return DataDirPreference::Automatic;
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return DataDirPreference::Automatic;
    };
    serde_json::from_str::<BootstrapSettings>(&raw)
        .map(|settings| settings.data_dir_preference)
        .unwrap_or_default()
}

pub fn set_data_dir_preference(preference: DataDirPreference) -> Result<()> {
    let dir = bootstrap_settings_dir()?;
    fs::create_dir_all(&dir).with_context(|| {
        format!(
            "Failed to create Helmor bootstrap settings directory {}",
            dir.display()
        )
    })?;
    let path = dir.join(BOOTSTRAP_SETTINGS_FILENAME);
    let settings = BootstrapSettings {
        data_dir_preference: preference,
    };
    let raw = serde_json::to_string_pretty(&settings)
        .context("Failed to serialize Helmor bootstrap settings")?;
    fs::write(&path, format!("{raw}\n")).with_context(|| {
        format!(
            "Failed to write Helmor bootstrap settings {}",
            path.display()
        )
    })
}

pub fn data_dir_locked_by_env() -> bool {
    std::env::var_os("HELMOR_DATA_DIR").is_some()
}
