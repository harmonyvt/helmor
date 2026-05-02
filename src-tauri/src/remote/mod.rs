mod api;
mod config;
mod events;
mod http;
mod server;
mod static_files;

pub use config::{load_config, RemoteAccessConfig, RemoteAccessStatus};
pub use server::RemoteServerManager;

type CmdResult<T> = std::result::Result<T, crate::error::CommandError>;

#[tauri::command]
pub async fn get_remote_access_config(
    manager: tauri::State<'_, RemoteServerManager>,
) -> CmdResult<RemoteAccessStatus> {
    let config = config::load_config()?;
    Ok(config::status_from_config(config, manager.is_running()))
}

#[tauri::command]
pub async fn update_remote_access_config(
    app: tauri::AppHandle,
    manager: tauri::State<'_, RemoteServerManager>,
    enabled: bool,
    bind_addr: String,
    port: u16,
) -> CmdResult<RemoteAccessStatus> {
    let config = RemoteAccessConfig {
        enabled,
        bind_addr: config::normalize_bind_addr(&bind_addr),
        port: config::normalize_port(port),
        token: config::ensure_token()?,
    };

    config::save_config(&config)?;
    manager.start(app.clone(), config.clone())?;
    crate::ui_sync::publish(
        &app,
        crate::ui_sync::UiMutationEvent::SettingsChanged {
            key: Some(config::ENABLED_KEY.to_string()),
        },
    );
    Ok(config::status_from_config(config, manager.is_running()))
}

#[tauri::command]
pub async fn rotate_remote_access_token(
    app: tauri::AppHandle,
    manager: tauri::State<'_, RemoteServerManager>,
) -> CmdResult<RemoteAccessStatus> {
    let mut config = config::load_config()?;
    config.token = config::new_token();
    config::save_config(&config)?;
    manager.start(app.clone(), config.clone())?;
    crate::ui_sync::publish(
        &app,
        crate::ui_sync::UiMutationEvent::SettingsChanged {
            key: Some(config::TOKEN_KEY.to_string()),
        },
    );
    Ok(config::status_from_config(config, manager.is_running()))
}
