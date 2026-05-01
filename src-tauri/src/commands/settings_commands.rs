use anyhow::Context;

use crate::{
    agents::ActionKind, db, models::repos, rate_limits::throttle::Throttle, settings, ui_sync,
};

// ---------------------------------------------------------------------------
// Capy project types (shared with the list_capy_projects command)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapyProjectRepo {
    pub repo_full_name: String,
    pub branch: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapyProject {
    pub id: String,
    pub name: String,
    pub repos: Vec<CapyProjectRepo>,
}

use super::common::{run_blocking, CmdResult};

/// 30 s belt-and-suspenders gate for rate-limit fetchers. Independent
/// of the frontend's 2 min `refetchInterval` and hover-triggered
/// refetches: even if the UI somehow hammers the command (event-loop
/// bug, runaway hover handler), the upstream HTTP call still fires at
/// most once per provider per 30 s. Within the cooldown window the
/// caller gets the cached body verbatim.
const RATE_LIMITS_THROTTLE_SECONDS: i64 = 30;
static CLAUDE_RATE_LIMITS_THROTTLE: Throttle = Throttle::new(RATE_LIMITS_THROTTLE_SECONDS);
static CODEX_RATE_LIMITS_THROTTLE: Throttle = Throttle::new(RATE_LIMITS_THROTTLE_SECONDS);

#[tauri::command]
pub async fn get_app_settings() -> CmdResult<std::collections::HashMap<String, String>> {
    run_blocking(|| {
        let conn = db::read_conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT key, value FROM settings WHERE key LIKE 'app.%' OR key LIKE 'branch_prefix_%'",
            )
            .context("Failed to query app settings")?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .context("Failed to iterate app settings")?;

        let mut map = std::collections::HashMap::new();
        for row in rows.flatten() {
            map.insert(row.0, row.1);
        }
        Ok(map)
    })
    .await
}

#[tauri::command]
pub async fn update_app_settings(
    settings_map: std::collections::HashMap<String, String>,
) -> CmdResult<()> {
    run_blocking(move || {
        for (key, value) in &settings_map {
            if !key.starts_with("app.") && !key.starts_with("branch_prefix_") {
                continue;
            }
            settings::upsert_setting_value(key, value)?;
        }
        Ok(())
    })
    .await
}

/// Read the account-global Codex rate-limit snapshot. Each call attempts
/// a live `wham/usage` fetch via the Codex OAuth token in
/// `~/.codex/auth.json` and falls back to the cached body on failure.
/// `app.codex_rate_limits` stores the raw response — no shape mapping —
/// so downstream parsing lives entirely in the frontend, mirroring the
/// Claude pipeline.
///
/// Frontend `useQuery` already caches the returned body and gates
/// repeat calls via `staleTime` / `refetchInterval`. We deliberately do
/// NOT publish a `*RateLimitsChanged` UI-sync event from this command
/// — that would invalidate the same query key the frontend just
/// resolved and trigger an immediate refetch, looping into HTTP 429.
#[tauri::command]
pub async fn get_codex_rate_limits() -> CmdResult<Option<String>> {
    run_blocking(|| {
        let cached = settings::load_setting_value(settings::CODEX_RATE_LIMITS_KEY)?;
        if !CODEX_RATE_LIMITS_THROTTLE.should_fetch() {
            return Ok(cached);
        }
        // Record before the HTTP roundtrip so a 429 or network error
        // also serves the throttle cooldown — we never want a failure
        // to invite an immediate retry.
        CODEX_RATE_LIMITS_THROTTLE.record_attempt();
        match crate::rate_limits::codex::fetch_codex_rate_limits() {
            Ok(body) => {
                settings::upsert_setting_value(settings::CODEX_RATE_LIMITS_KEY, &body)?;
                Ok(Some(body))
            }
            Err(error) => {
                tracing::warn!("Failed to refresh Codex rate limits: {error}");
                Ok(cached)
            }
        }
    })
    .await
}

/// Read the account-global Claude rate-limit snapshot. Each call
/// attempts a live fetch and falls back to the cached body on failure.
/// `app.claude_rate_limits` stores the raw Anthropic response — no
/// shape mapping — so downstream parsing lives entirely in the frontend.
///
/// See `get_codex_rate_limits` for why this command does not publish a
/// `*RateLimitsChanged` UI-sync event.
#[tauri::command]
pub async fn get_claude_rate_limits() -> CmdResult<Option<String>> {
    run_blocking(|| {
        let cached = settings::load_setting_value(settings::CLAUDE_RATE_LIMITS_KEY)?;
        if !CLAUDE_RATE_LIMITS_THROTTLE.should_fetch() {
            return Ok(cached);
        }
        CLAUDE_RATE_LIMITS_THROTTLE.record_attempt();
        match crate::rate_limits::claude::fetch_claude_rate_limits() {
            Ok(body) => {
                settings::upsert_setting_value(settings::CLAUDE_RATE_LIMITS_KEY, &body)?;
                Ok(Some(body))
            }
            Err(error) => {
                tracing::warn!("Failed to refresh Claude rate limits: {error}");
                Ok(cached)
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn load_auto_close_action_kinds() -> CmdResult<Vec<ActionKind>> {
    run_blocking(settings::load_auto_close_action_kinds).await
}

#[tauri::command]
pub async fn save_auto_close_action_kinds(kinds: Vec<ActionKind>) -> CmdResult<()> {
    run_blocking(move || settings::save_auto_close_action_kinds(&kinds)).await
}

#[tauri::command]
pub async fn load_auto_close_opt_in_asked() -> CmdResult<Vec<ActionKind>> {
    run_blocking(settings::load_auto_close_opt_in_asked).await
}

#[tauri::command]
pub async fn save_auto_close_opt_in_asked(kinds: Vec<ActionKind>) -> CmdResult<()> {
    run_blocking(move || settings::save_auto_close_opt_in_asked(&kinds)).await
}

// ---------------------------------------------------------------------------
// Capy AI integration settings
// ---------------------------------------------------------------------------

/// Read the global Capy API key. Returns None when not configured.
#[tauri::command]
pub async fn get_capy_api_key() -> CmdResult<Option<String>> {
    run_blocking(|| settings::load_setting_value("capy.api_key")).await
}

/// Persist or clear the global Capy API key.
#[tauri::command]
pub async fn set_capy_api_key(app: tauri::AppHandle, key: Option<String>) -> CmdResult<()> {
    run_blocking(move || {
        match key.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(k) => settings::upsert_setting_value("capy.api_key", k)?,
            None => settings::delete_setting_value("capy.api_key")?,
        }
        ui_sync::publish(
            &app,
            ui_sync::UiMutationEvent::SettingsChanged {
                key: Some("capy.api_key".to_string()),
            },
        );
        Ok(())
    })
    .await
}

/// Read the Capy project ID for a specific repo.
#[tauri::command]
pub async fn get_repo_capy_project_id(repo_id: String) -> CmdResult<Option<String>> {
    run_blocking(move || repos::load_repo_capy_project_id(&repo_id)).await
}

/// Set or clear the Capy project ID for a specific repo.
#[tauri::command]
pub async fn set_repo_capy_project_id(
    app: tauri::AppHandle,
    repo_id: String,
    project_id: Option<String>,
) -> CmdResult<()> {
    run_blocking(move || {
        repos::update_repo_capy_project_id(&repo_id, project_id.as_deref())?;
        ui_sync::publish(&app, ui_sync::UiMutationEvent::RepositoryListChanged);
        Ok(())
    })
    .await
}

/// Fetch all Capy projects accessible to the saved API key.
///
/// Returns up to 100 projects (Capy's maximum page size). The API key is
/// read from settings — if none is configured an error is returned so the
/// frontend can show a "configure your API key first" message.
#[tauri::command]
pub async fn list_capy_projects() -> CmdResult<Vec<CapyProject>> {
    run_blocking(|| {
        let api_key = settings::load_setting_value("capy.api_key")?
            .filter(|k| !k.trim().is_empty())
            .ok_or_else(|| anyhow::anyhow!("No Capy API key configured"))?;

        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .context("Failed to build HTTP client")?;

        let response = client
            .get("https://capy.ai/api/v1/projects?limit=100")
            .bearer_auth(&api_key)
            .send()
            .context("Failed to fetch Capy projects")?;

        anyhow::ensure!(
            response.status().is_success(),
            "Capy API returned {}",
            response.status()
        );

        let body: serde_json::Value = response
            .json()
            .context("Failed to parse Capy projects response")?;

        let projects = body["items"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|item| {
                let id = item["id"].as_str()?.to_string();
                let name = item["name"].as_str()?.to_string();
                let repos = item["repos"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|r| {
                                Some(CapyProjectRepo {
                                    repo_full_name: r["repoFullName"].as_str()?.to_string(),
                                    branch: r["branch"].as_str()?.to_string(),
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Some(CapyProject { id, name, repos })
            })
            .collect();

        Ok(projects)
    })
    .await
}
