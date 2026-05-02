use tauri::AppHandle;

use crate::models::browser_tabs::{self, BrowserTabRecord};
use crate::ui_sync::{self, UiMutationEvent};

use super::common::{run_blocking, CmdResult};

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
    let publish_workspace_id = workspace_id.clone();
    let tab = run_blocking(move || {
        browser_tabs::create_browser_tab(&workspace_id, initial_url.as_deref())
    })
    .await?;
    ui_sync::publish(
        &app,
        UiMutationEvent::WorkspaceBrowserTabsChanged {
            workspace_id: publish_workspace_id,
        },
    );
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
    let tab = run_blocking(move || browser_tabs::navigate_browser_tab(&tab_id, &url)).await?;
    ui_sync::publish(
        &app,
        UiMutationEvent::WorkspaceBrowserTabsChanged {
            workspace_id: tab.workspace_id.clone(),
        },
    );
    Ok(tab)
}

#[tauri::command]
pub async fn update_browser_tab_title(
    app: AppHandle,
    tab_id: String,
    title: Option<String>,
) -> CmdResult<Option<BrowserTabRecord>> {
    let tab =
        run_blocking(move || browser_tabs::update_browser_tab_title(&tab_id, title.as_deref()))
            .await?;
    if let Some(tab) = &tab {
        ui_sync::publish(
            &app,
            UiMutationEvent::WorkspaceBrowserTabsChanged {
                workspace_id: tab.workspace_id.clone(),
            },
        );
    }
    Ok(tab)
}

#[tauri::command]
pub async fn close_browser_tab(
    app: AppHandle,
    workspace_id: String,
    tab_id: String,
) -> CmdResult<Option<BrowserTabRecord>> {
    let fallback = run_blocking(move || browser_tabs::close_browser_tab(&tab_id)).await?;
    ui_sync::publish(
        &app,
        UiMutationEvent::WorkspaceBrowserTabsChanged { workspace_id },
    );
    Ok(fallback)
}

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
