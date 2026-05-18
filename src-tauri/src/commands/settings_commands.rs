use std::time::Instant;

use anyhow::Context;
use serde::Serialize;

use crate::{
    agents::ActionKind, data_dir::DataDirPreference, db, rate_limits::throttle::Throttle, settings,
};

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibsqlExperimentResult {
    pub ok: bool,
    pub db_path: String,
    pub journal_mode: String,
    pub table_count: i64,
    pub settings_count: i64,
    pub elapsed_ms: u128,
}

#[tauri::command]
pub async fn get_app_settings() -> CmdResult<std::collections::HashMap<String, String>> {
    Ok(settings::load_app_settings_map_async().await?)
}

#[tauri::command]
pub async fn update_app_settings(
    settings_map: std::collections::HashMap<String, String>,
) -> CmdResult<()> {
    for (key, value) in &settings_map {
        if !key.starts_with("app.") && !key.starts_with("branch_prefix_") {
            continue;
        }
        settings::upsert_setting_value_async(key, value).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn run_libsql_experiment() -> CmdResult<LibsqlExperimentResult> {
    let started = Instant::now();
    let conn = db::libsql_conn_async().await?;

    let journal_mode = query_single_string(&conn, "PRAGMA journal_mode").await?;
    let db_path = query_database_path(&conn).await?;
    let table_count = query_single_i64(
        &conn,
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
    )
    .await?;
    let settings_count = query_single_i64(&conn, "SELECT COUNT(*) FROM settings").await?;

    let result = LibsqlExperimentResult {
        ok: true,
        db_path,
        journal_mode,
        table_count,
        settings_count,
        elapsed_ms: started.elapsed().as_millis(),
    };
    Ok(result)
}

async fn query_single_i64(conn: &libsql::Connection, sql: &str) -> anyhow::Result<i64> {
    let mut rows = conn
        .query(sql, ())
        .await
        .with_context(|| format!("Failed to run libSQL query: {sql}"))?;
    let row = rows
        .next()
        .await?
        .with_context(|| format!("libSQL query returned no rows: {sql}"))?;
    row.get(0)
        .with_context(|| format!("Failed to read integer result for: {sql}"))
}

async fn query_single_string(conn: &libsql::Connection, sql: &str) -> anyhow::Result<String> {
    let mut rows = conn
        .query(sql, ())
        .await
        .with_context(|| format!("Failed to run libSQL query: {sql}"))?;
    let row = rows
        .next()
        .await?
        .with_context(|| format!("libSQL query returned no rows: {sql}"))?;
    row.get(0)
        .with_context(|| format!("Failed to read string result for: {sql}"))
}

async fn query_database_path(conn: &libsql::Connection) -> anyhow::Result<String> {
    let mut rows = conn.query("PRAGMA database_list", ()).await?;
    while let Some(row) = rows.next().await? {
        let name: String = row.get(1)?;
        if name == "main" {
            return row.get(2).context("Failed to read main database path");
        }
    }
    anyhow::bail!("PRAGMA database_list did not include main database")
}

#[tauri::command]
pub async fn set_data_dir_preference(preference: DataDirPreference) -> CmdResult<()> {
    run_blocking(move || crate::data_dir::set_data_dir_preference(preference)).await
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
    get_cached_rate_limits(
        settings::CODEX_RATE_LIMITS_KEY,
        &CODEX_RATE_LIMITS_THROTTLE,
        "Codex",
        crate::rate_limits::codex::fetch_codex_rate_limits,
    )
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
    get_cached_rate_limits(
        settings::CLAUDE_RATE_LIMITS_KEY,
        &CLAUDE_RATE_LIMITS_THROTTLE,
        "Claude",
        crate::rate_limits::claude::fetch_claude_rate_limits,
    )
    .await
}

async fn get_cached_rate_limits(
    key: &'static str,
    throttle: &'static Throttle,
    provider: &'static str,
    fetch: fn() -> anyhow::Result<String>,
) -> CmdResult<Option<String>> {
    let cached = settings::load_setting_value_async(key).await?;
    if !throttle.should_fetch() {
        return Ok(cached);
    }
    // Record before the HTTP roundtrip so a 429 or network error also serves
    // the throttle cooldown; failures should not invite immediate retries.
    throttle.record_attempt();

    match run_blocking(fetch).await {
        Ok(body) => {
            settings::upsert_setting_value_async(key, &body).await?;
            Ok(Some(body))
        }
        Err(error) => {
            tracing::warn!(provider, error = ?error, "Failed to refresh rate limits");
            Ok(cached)
        }
    }
}

#[tauri::command]
pub async fn load_auto_close_action_kinds() -> CmdResult<Vec<ActionKind>> {
    Ok(settings::load_auto_close_action_kinds_async().await?)
}

#[tauri::command]
pub async fn save_auto_close_action_kinds(kinds: Vec<ActionKind>) -> CmdResult<()> {
    Ok(settings::save_auto_close_action_kinds_async(&kinds).await?)
}

#[tauri::command]
pub async fn load_auto_close_opt_in_asked() -> CmdResult<Vec<ActionKind>> {
    Ok(settings::load_auto_close_opt_in_asked_async().await?)
}

#[tauri::command]
pub async fn save_auto_close_opt_in_asked(kinds: Vec<ActionKind>) -> CmdResult<()> {
    Ok(settings::save_auto_close_opt_in_asked_async(&kinds).await?)
}
