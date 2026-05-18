//! `helmor settings` — read/write entries in the `settings` table.

use std::collections::BTreeMap;

use anyhow::{bail, Result};

use crate::settings as settings_store;
use crate::ui_sync::UiMutationEvent;

use super::args::{Cli, SettingsAction};
use super::{notify_ui_event, output};

pub fn dispatch(action: &SettingsAction, cli: &Cli) -> Result<()> {
    match action {
        SettingsAction::Get { key } => get(key, cli),
        SettingsAction::Set { key, value } => set(key, value, cli),
        SettingsAction::List { all } => list(*all, cli),
        SettingsAction::Delete { key } => delete(key, cli),
    }
}

fn get(key: &str, cli: &Cli) -> Result<()> {
    let value = tauri::async_runtime::block_on(settings_store::load_setting_value_async(key))?;
    output::print(cli, &value, |v| match v {
        Some(s) => s.clone(),
        None => String::new(),
    })
}

fn set(key: &str, value: &str, cli: &Cli) -> Result<()> {
    tauri::async_runtime::block_on(settings_store::upsert_setting_value_async(key, value))?;
    notify_ui_event(UiMutationEvent::SettingsChanged {
        key: Some(key.to_string()),
    });
    output::print_ok(cli, &format!("Set {key}"));
    Ok(())
}

fn list(all: bool, cli: &Cli) -> Result<()> {
    let map: BTreeMap<String, String> =
        tauri::async_runtime::block_on(settings_store::list_settings_map_async(all))?
            .into_iter()
            .collect();

    output::print(cli, &map, |m| {
        m.iter()
            .map(|(k, v)| format!("{k}\t{v}"))
            .collect::<Vec<_>>()
            .join("\n")
    })
}

fn delete(key: &str, cli: &Cli) -> Result<()> {
    let removed = tauri::async_runtime::block_on(settings_store::delete_setting_value_async(key))?;
    if removed == 0 {
        bail!("No setting with key '{key}'");
    }
    notify_ui_event(UiMutationEvent::SettingsChanged {
        key: Some(key.to_string()),
    });
    output::print_ok(cli, &format!("Deleted {key}"));
    Ok(())
}
