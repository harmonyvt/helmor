use anyhow::{anyhow, Context};
use tauri::{webview::PageLoadEvent, AppHandle, Manager, Webview, WebviewUrl};
use url::Url;

use crate::browser_profile::BrowserProfileOptions;
use crate::models::browser_tabs::{self, BrowserTabRecord};
use crate::ui_sync::{self, UiMutationEvent};

use super::common::{run_blocking, CmdResult};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

const BROWSER_WEBVIEW_LABEL_PREFIX: &str = "helmor_browser_";

fn browser_webview_label(tab_id: &str) -> String {
    format!("{BROWSER_WEBVIEW_LABEL_PREFIX}{}", tab_id.replace('-', "_"))
}

fn browser_webview(app: &AppHandle, tab_id: &str) -> anyhow::Result<Webview> {
    let label = browser_webview_label(tab_id);
    app.get_webview(&label)
        .with_context(|| format!("Browser webview not found: {label}"))
}

fn maybe_navigate_browser_webview(app: &AppHandle, tab_id: &str, url: &str) -> anyhow::Result<()> {
    let label = browser_webview_label(tab_id);
    let Some(webview) = app.get_webview(&label) else {
        return Ok(());
    };
    let parsed_url = Url::parse(url).with_context(|| format!("Invalid browser URL: {url}"))?;
    webview
        .navigate(parsed_url)
        .context("Failed to navigate browser webview")
}

fn update_browser_tab_title_and_publish(
    app: &AppHandle,
    tab_id: &str,
    title: Option<&str>,
) -> anyhow::Result<Option<BrowserTabRecord>> {
    let tab = browser_tabs::update_browser_tab_title(tab_id, title)?;
    if let Some(tab) = &tab {
        ui_sync::publish(
            app,
            UiMutationEvent::WorkspaceBrowserTabsChanged {
                workspace_id: tab.workspace_id.clone(),
            },
        );
    }
    Ok(tab)
}

pub fn create_browser_tab_and_publish(
    app: &AppHandle,
    workspace_id: &str,
    initial_url: Option<&str>,
) -> anyhow::Result<BrowserTabRecord> {
    let tab = browser_tabs::create_browser_tab(workspace_id, initial_url)?;
    ui_sync::publish(
        app,
        UiMutationEvent::WorkspaceBrowserTabsChanged {
            workspace_id: tab.workspace_id.clone(),
        },
    );
    Ok(tab)
}

pub fn navigate_browser_tab_and_publish(
    app: &AppHandle,
    tab_id: &str,
    url: &str,
) -> anyhow::Result<BrowserTabRecord> {
    let tab = browser_tabs::navigate_browser_tab(tab_id, url)?;
    ui_sync::publish(
        app,
        UiMutationEvent::WorkspaceBrowserTabsChanged {
            workspace_id: tab.workspace_id.clone(),
        },
    );
    Ok(tab)
}

pub fn close_browser_tab_and_publish(
    app: &AppHandle,
    tab_id: &str,
) -> anyhow::Result<Option<BrowserTabRecord>> {
    let result = browser_tabs::close_browser_tab_with_workspace(tab_id)?;
    if let Some(result) = result {
        let workspace_id = result.workspace_id.clone();
        ui_sync::publish(
            app,
            UiMutationEvent::WorkspaceBrowserTabsChanged {
                workspace_id: workspace_id.clone(),
            },
        );
        if let Err(error) =
            crate::browser_profile::remove_browser_tab_profile_files(&workspace_id, tab_id)
        {
            tracing::warn!(workspace_id, tab_id, error = %format!("{error:#}"), "Failed to remove browser tab profile files");
        }
        return Ok(result.fallback);
    }
    Ok(None)
}

#[tauri::command]
pub async fn list_workspace_browser_tabs(workspace_id: String) -> CmdResult<Vec<BrowserTabRecord>> {
    run_blocking(move || browser_tabs::list_workspace_browser_tabs(&workspace_id)).await
}

#[tauri::command]
pub async fn create_browser_tab(
    app: AppHandle,
    workspace_id: String,
    initial_url: Option<String>,
) -> CmdResult<BrowserTabRecord> {
    let app_for_blocking = app.clone();
    let tab = run_blocking(move || {
        create_browser_tab_and_publish(&app_for_blocking, &workspace_id, initial_url.as_deref())
    })
    .await?;
    Ok(tab)
}

#[tauri::command]
pub async fn select_browser_tab(app: AppHandle, tab_id: String) -> CmdResult<BrowserTabRecord> {
    let tab = run_blocking(move || browser_tabs::select_browser_tab(&tab_id)).await?;
    ui_sync::publish(
        &app,
        UiMutationEvent::WorkspaceBrowserTabsChanged {
            workspace_id: tab.workspace_id.clone(),
        },
    );
    Ok(tab)
}

#[tauri::command]
pub async fn navigate_browser_tab(
    app: AppHandle,
    tab_id: String,
    url: String,
) -> CmdResult<BrowserTabRecord> {
    let app_for_blocking = app.clone();
    let tab_id_for_webview = tab_id.clone();
    let url_for_webview = url.clone();
    let tab =
        run_blocking(move || navigate_browser_tab_and_publish(&app_for_blocking, &tab_id, &url))
            .await?;
    maybe_navigate_browser_webview(&app, &tab_id_for_webview, &url_for_webview)?;
    Ok(tab)
}

#[tauri::command]
pub async fn update_browser_tab_title(
    app: AppHandle,
    tab_id: String,
    title: Option<String>,
) -> CmdResult<Option<BrowserTabRecord>> {
    let tab =
        run_blocking(move || update_browser_tab_title_and_publish(&app, &tab_id, title.as_deref()))
            .await?;
    Ok(tab)
}

#[tauri::command]
pub async fn close_browser_tab(
    app: AppHandle,
    tab_id: String,
) -> CmdResult<Option<BrowserTabRecord>> {
    let app_for_blocking = app.clone();
    let closed_tab_id = tab_id.clone();
    let fallback =
        run_blocking(move || close_browser_tab_and_publish(&app_for_blocking, &tab_id)).await?;
    remove_browser_tab_data_store(&app, &closed_tab_id).await;
    Ok(fallback)
}

#[tauri::command]
pub async fn get_workspace_browser_profile(
    workspace_id: String,
) -> CmdResult<BrowserProfileOptions> {
    run_blocking(move || crate::browser_profile::get_workspace_browser_profile(&workspace_id)).await
}

#[tauri::command]
pub async fn get_browser_tab_profile(tab_id: String) -> CmdResult<BrowserProfileOptions> {
    run_blocking(move || crate::browser_profile::get_browser_tab_profile(&tab_id)).await
}

#[tauri::command]
pub async fn create_browser_webview(
    host_webview: tauri::Webview,
    label: String,
    url: String,
    bounds: BrowserWebviewBounds,
    profile: BrowserProfileOptions,
    user_agent: String,
) -> CmdResult<()> {
    let parsed_url = Url::parse(&url).with_context(|| format!("Invalid browser URL: {url}"))?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err(anyhow!("Unsupported browser URL scheme: {}", parsed_url.scheme()).into());
    }

    let data_store_identifier: [u8; 16] = profile
        .data_store_identifier
        .as_slice()
        .try_into()
        .context("Browser profile data store identifier must contain 16 bytes")?;

    let tab_id = profile
        .tab_id
        .clone()
        .context("Browser webview profile must include a tab id")?;

    let app_for_load = host_webview.app_handle().clone();
    let tab_id_for_load = tab_id.clone();
    let app_for_title = host_webview.app_handle().clone();
    let tab_id_for_title = tab_id;

    let builder = tauri::webview::WebviewBuilder::new(label, WebviewUrl::External(parsed_url))
        .accept_first_mouse(true)
        .disable_drag_drop_handler()
        .focused(true)
        .user_agent(&user_agent)
        .data_store_identifier(data_store_identifier)
        .on_page_load(move |_webview, payload| {
            if !matches!(payload.event(), PageLoadEvent::Finished) {
                return;
            }
            if !matches!(payload.url().scheme(), "http" | "https") {
                return;
            }

            let app = app_for_load.clone();
            let tab_id = tab_id_for_load.clone();
            let url = payload.url().to_string();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = navigate_browser_tab_and_publish(&app, &tab_id, &url) {
                    tracing::warn!(tab_id, url, error = %format!("{error:#}"), "Failed to sync browser tab URL");
                }
            });
        })
        .on_document_title_changed(move |_webview, title| {
            let app = app_for_title.clone();
            let tab_id = tab_id_for_title.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = update_browser_tab_title_and_publish(&app, &tab_id, Some(&title))
                {
                    tracing::warn!(tab_id, error = %format!("{error:#}"), "Failed to sync browser tab title");
                }
            });
        });

    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let builder = builder
        .data_directory(crate::data_dir::browser_profiles_dir()?.join(profile.data_directory));

    host_webview
        .window()
        .add_child(
            builder,
            tauri::LogicalPosition::new(bounds.x, bounds.y),
            tauri::LogicalSize::new(bounds.width, bounds.height),
        )
        .context("Failed to create browser webview")?;

    Ok(())
}

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, tab_id: String) -> CmdResult<()> {
    browser_webview(&app, &tab_id)?
        .eval("history.back()")
        .context("Failed to navigate browser webview back")?;
    Ok(())
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, tab_id: String) -> CmdResult<()> {
    browser_webview(&app, &tab_id)?
        .eval("history.forward()")
        .context("Failed to navigate browser webview forward")?;
    Ok(())
}

#[tauri::command]
pub async fn open_browser_devtools(app: AppHandle, tab_id: String) -> CmdResult<()> {
    browser_webview(&app, &tab_id)?.open_devtools();
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn remove_browser_tab_data_store(app: &AppHandle, tab_id: &str) {
    let Ok(identifier) = crate::browser_profile::browser_tab_data_store_identifier(tab_id) else {
        return;
    };
    if let Err(error) = app.remove_data_store(identifier).await {
        tracing::warn!(tab_id, error = %format!("{error:#}"), "Failed to remove browser tab data store");
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
async fn remove_browser_tab_data_store(_app: &AppHandle, _tab_id: &str) {}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserRuntimeActionResponse {
    pub tab_id: String,
    pub action: String,
    pub implemented: bool,
    pub message: String,
}

fn pending_runtime_action(tab_id: String, action: &str) -> BrowserRuntimeActionResponse {
    BrowserRuntimeActionResponse {
        tab_id,
        action: action.to_string(),
        implemented: false,
        message: "Browser runtime action is reserved for the macOS native WebView automation follow-up. Durable tabs and navigation are available now.".to_string(),
    }
}

#[tauri::command]
pub async fn browser_snapshot(tab_id: String) -> CmdResult<BrowserRuntimeActionResponse> {
    Ok(pending_runtime_action(tab_id, "snapshot"))
}

#[tauri::command]
pub async fn browser_screenshot(tab_id: String) -> CmdResult<BrowserRuntimeActionResponse> {
    Ok(pending_runtime_action(tab_id, "screenshot"))
}

#[tauri::command]
pub async fn browser_click(
    tab_id: String,
    _x: f64,
    _y: f64,
) -> CmdResult<BrowserRuntimeActionResponse> {
    Ok(pending_runtime_action(tab_id, "click"))
}

#[tauri::command]
pub async fn browser_type(
    tab_id: String,
    _text: String,
) -> CmdResult<BrowserRuntimeActionResponse> {
    Ok(pending_runtime_action(tab_id, "type"))
}

#[tauri::command]
pub async fn browser_key(tab_id: String, _key: String) -> CmdResult<BrowserRuntimeActionResponse> {
    Ok(pending_runtime_action(tab_id, "key"))
}

#[tauri::command]
pub async fn browser_scroll(
    tab_id: String,
    _delta_x: f64,
    _delta_y: f64,
) -> CmdResult<BrowserRuntimeActionResponse> {
    Ok(pending_runtime_action(tab_id, "scroll"))
}
