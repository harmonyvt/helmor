use std::{collections::HashMap, future::Future};

use anyhow::{Context, Result};
use serde::{de::DeserializeOwned, Serialize};

use super::db;

fn block_on_settings_db<T>(future: impl Future<Output = Result<T>>) -> Result<T> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(future)),
        Err(_) => tauri::async_runtime::block_on(future),
    }
}

#[derive(Debug, Clone)]
pub struct BranchPrefixSettings {
    pub branch_prefix_type: Option<String>,
    pub branch_prefix_custom: Option<String>,
}

#[derive(Debug, Clone)]
pub struct EffectiveBranchPrefixSettings {
    pub branch_prefix_type: Option<String>,
    pub branch_prefix_custom: Option<String>,
    pub forge_provider: Option<String>,
    pub remote_url: Option<String>,
}

pub fn load_setting_value(key: &str) -> Result<Option<String>> {
    block_on_settings_db(load_setting_value_async(key))
}

pub async fn load_setting_value_async(key: &str) -> Result<Option<String>> {
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            "SELECT value FROM settings WHERE key = ?1",
            [key.to_string()],
        )
        .await
        .with_context(|| format!("Failed to query settings value for {key}"))?;

    match rows.next().await? {
        Some(row) => row
            .get(0)
            .map(Some)
            .with_context(|| format!("Failed to deserialize settings value for {key}")),
        None => Ok(None),
    }
}

pub fn upsert_setting_value(key: &str, value: &str) -> Result<()> {
    block_on_settings_db(upsert_setting_value_async(key, value))
}

pub async fn upsert_setting_value_async(key: &str, value: &str) -> Result<()> {
    let key = key.to_string();
    let value = value.to_string();
    db::libsql_write_async(|connection| async move {
        connection
            .execute(
                r#"
                INSERT INTO settings (key, value, created_at, updated_at)
                VALUES (?1, ?2, datetime('now'), datetime('now'))
                ON CONFLICT(key) DO UPDATE SET
                  value = excluded.value,
                  updated_at = datetime('now')
                "#,
                (key.clone(), value),
            )
            .await
            .with_context(|| format!("Failed to store setting {key}"))?;
        Ok(())
    })
    .await
}

pub fn delete_setting_value(key: &str) -> Result<()> {
    block_on_settings_db(delete_setting_value_async(key)).map(|_| ())
}

pub async fn delete_setting_value_async(key: &str) -> Result<u64> {
    let key = key.to_string();
    db::libsql_write_async(|connection| async move {
        connection
            .execute("DELETE FROM settings WHERE key = ?1", [key.clone()])
            .await
            .with_context(|| format!("Failed to delete setting {key}"))
    })
    .await
}

pub fn load_setting_json<T: DeserializeOwned>(key: &str) -> Result<Option<T>> {
    let Some(value) = load_setting_value(key)? else {
        return Ok(None);
    };

    let parsed = serde_json::from_str::<T>(&value)
        .with_context(|| format!("Failed to deserialize JSON setting {key}"))?;

    Ok(Some(parsed))
}

pub async fn load_setting_json_async<T: DeserializeOwned>(key: &str) -> Result<Option<T>> {
    let Some(value) = load_setting_value_async(key).await? else {
        return Ok(None);
    };

    let parsed = serde_json::from_str::<T>(&value)
        .with_context(|| format!("Failed to deserialize JSON setting {key}"))?;

    Ok(Some(parsed))
}

pub fn upsert_setting_json<T: Serialize>(key: &str, value: &T) -> Result<()> {
    let serialized = serde_json::to_string(value)
        .with_context(|| format!("Failed to serialize JSON setting {key}"))?;
    upsert_setting_value(key, &serialized)
}

pub async fn upsert_setting_json_async<T: Serialize>(key: &str, value: &T) -> Result<()> {
    let serialized = serde_json::to_string(value)
        .with_context(|| format!("Failed to serialize JSON setting {key}"))?;
    upsert_setting_value_async(key, &serialized).await
}

const AUTO_CLOSE_ACTION_KINDS_KEY: &str = "auto_close_action_kinds";
const AUTO_CLOSE_OPT_IN_ASKED_KEY: &str = "auto_close_opt_in_asked";

/// Account-global rate-limit snapshots: the raw upstream response body
/// is stored verbatim (no shape mapping) by the corresponding
/// `get_*_rate_limits` Tauri command after a live OAuth fetch, and read
/// back by the same command as the cache-fallback when a fresh fetch
/// fails. The frontend's `parse{Codex,Claude}RateLimits` does the
/// shape work, so a schema change at the provider only needs a parser
/// tweak — not a DB migration.
pub const CODEX_RATE_LIMITS_KEY: &str = "app.codex_rate_limits";
pub const CLAUDE_RATE_LIMITS_KEY: &str = "app.claude_rate_limits";

/// Action kinds the user has opted-in to auto-close. Action sessions whose
/// `action_kind` appears in this list are hidden automatically after their
/// verifier reports `Success`.
pub fn load_auto_close_action_kinds() -> Result<Vec<crate::agents::ActionKind>> {
    load_setting_json::<Vec<crate::agents::ActionKind>>(AUTO_CLOSE_ACTION_KINDS_KEY)
        .map(|opt| opt.unwrap_or_default())
}

pub async fn load_auto_close_action_kinds_async() -> Result<Vec<crate::agents::ActionKind>> {
    load_setting_json_async::<Vec<crate::agents::ActionKind>>(AUTO_CLOSE_ACTION_KINDS_KEY)
        .await
        .map(|opt| opt.unwrap_or_default())
}

pub fn save_auto_close_action_kinds(kinds: &[crate::agents::ActionKind]) -> Result<()> {
    upsert_setting_json(AUTO_CLOSE_ACTION_KINDS_KEY, &kinds)
}

pub async fn save_auto_close_action_kinds_async(kinds: &[crate::agents::ActionKind]) -> Result<()> {
    upsert_setting_json_async(AUTO_CLOSE_ACTION_KINDS_KEY, &kinds).await
}

/// Action kinds for which we've already shown the first-time opt-in prompt.
/// Separate from the opt-in list so "dismissed" and "enabled" are distinct
/// states — a dismissed kind stays in this list so we don't nag.
pub fn load_auto_close_opt_in_asked() -> Result<Vec<crate::agents::ActionKind>> {
    load_setting_json::<Vec<crate::agents::ActionKind>>(AUTO_CLOSE_OPT_IN_ASKED_KEY)
        .map(|opt| opt.unwrap_or_default())
}

pub async fn load_auto_close_opt_in_asked_async() -> Result<Vec<crate::agents::ActionKind>> {
    load_setting_json_async::<Vec<crate::agents::ActionKind>>(AUTO_CLOSE_OPT_IN_ASKED_KEY)
        .await
        .map(|opt| opt.unwrap_or_default())
}

pub fn save_auto_close_opt_in_asked(kinds: &[crate::agents::ActionKind]) -> Result<()> {
    upsert_setting_json(AUTO_CLOSE_OPT_IN_ASKED_KEY, &kinds)
}

pub async fn save_auto_close_opt_in_asked_async(kinds: &[crate::agents::ActionKind]) -> Result<()> {
    upsert_setting_json_async(AUTO_CLOSE_OPT_IN_ASKED_KEY, &kinds).await
}

pub fn load_branch_prefix_settings() -> Result<BranchPrefixSettings> {
    block_on_settings_db(load_branch_prefix_settings_async())
}

pub async fn load_branch_prefix_settings_async() -> Result<BranchPrefixSettings> {
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            "SELECT key, value FROM settings WHERE key IN ('branch_prefix_type', 'branch_prefix_custom')",
            (),
        )
        .await
        .context("Failed to query branch settings")?;

    let mut settings = BranchPrefixSettings {
        branch_prefix_type: None,
        branch_prefix_custom: None,
    };

    while let Some(row) = rows.next().await? {
        let key: String = row.get(0).context("Failed to read branch setting key")?;
        let value: String = row.get(1).context("Failed to read branch setting value")?;
        match key.as_str() {
            "branch_prefix_type" => settings.branch_prefix_type = Some(value),
            "branch_prefix_custom" => settings.branch_prefix_custom = Some(value),
            _ => {}
        }
    }

    Ok(settings)
}

pub async fn load_app_settings_map_async() -> Result<HashMap<String, String>> {
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            "SELECT key, value FROM settings WHERE key LIKE 'app.%' OR key LIKE 'branch_prefix_%'",
            (),
        )
        .await
        .context("Failed to query app settings")?;

    let mut map = HashMap::new();
    while let Some(row) = rows.next().await? {
        let key: String = row.get(0).context("Failed to read app setting key")?;
        let value: String = row.get(1).context("Failed to read app setting value")?;
        map.insert(key, value);
    }

    Ok(map)
}

pub async fn list_settings_map_async(all: bool) -> Result<HashMap<String, String>> {
    let connection = db::libsql_conn_async().await?;
    let sql = if all {
        "SELECT key, value FROM settings ORDER BY key ASC"
    } else {
        "SELECT key, value FROM settings \
         WHERE key LIKE 'app.%' OR key LIKE 'branch_prefix_%' \
         ORDER BY key ASC"
    };
    let mut rows = connection
        .query(sql, ())
        .await
        .context("Failed to query settings list")?;

    let mut map = HashMap::new();
    while let Some(row) = rows.next().await? {
        let key: String = row.get(0).context("Failed to read setting key")?;
        let value: String = row.get(1).context("Failed to read setting value")?;
        map.insert(key, value);
    }

    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    use rusqlite::Connection;

    fn test_db() -> (Connection, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();
        crate::schema::ensure_schema(&conn).unwrap();
        (conn, dir)
    }

    #[test]
    fn settings_crud() {
        let (conn, _dir) = test_db();

        // Missing key returns no rows
        let mut stmt = conn
            .prepare("SELECT value FROM settings WHERE key = ?1")
            .unwrap();
        let result: Option<String> = stmt
            .query_map(["nonexistent"], |row| row.get(0))
            .unwrap()
            .filter_map(Result::ok)
            .next();
        assert!(result.is_none());

        // Insert
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('test_key', 'test_value')",
            [],
        )
        .unwrap();
        let value: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'test_key'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(value, "test_value");
    }

    #[test]
    fn settings_upsert_overwrites() {
        let (conn, _dir) = test_db();
        conn.execute("INSERT INTO settings (key, value) VALUES ('k', 'v1')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('k', 'v2') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [],
        ).unwrap();
        let value: String = conn
            .query_row("SELECT value FROM settings WHERE key = 'k'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(value, "v2");
    }

    #[test]
    fn branch_prefix_settings_query() {
        let (conn, _dir) = test_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('branch_prefix_type', 'custom')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('branch_prefix_custom', 'feat/')",
            [],
        )
        .unwrap();

        let mut stmt = conn.prepare(
            "SELECT key, value FROM settings WHERE key IN ('branch_prefix_type', 'branch_prefix_custom')"
        ).unwrap();
        let rows: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(Result::ok)
            .collect();

        assert_eq!(rows.len(), 2);
        assert!(rows
            .iter()
            .any(|(k, v)| k == "branch_prefix_type" && v == "custom"));
        assert!(rows
            .iter()
            .any(|(k, v)| k == "branch_prefix_custom" && v == "feat/"));
    }

    #[test]
    fn app_settings_roundtrip() {
        let (conn, _dir) = test_db();

        // Insert app settings
        conn.execute(
            "INSERT INTO settings (key, value, created_at, updated_at) VALUES ('app.font_size', '16', datetime('now'), datetime('now'))",
            [],
        ).unwrap();

        // Read back
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings WHERE key LIKE 'app.%'")
            .unwrap();
        let rows: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(Result::ok)
            .collect();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "app.font_size");
        assert_eq!(rows[0].1, "16");
    }

    #[test]
    fn app_settings_upsert() {
        let (conn, _dir) = test_db();

        // Insert then update
        conn.execute(
            "INSERT INTO settings (key, value, created_at, updated_at) VALUES ('app.font_size', '14', datetime('now'), datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO settings (key, value, created_at, updated_at) VALUES ('app.font_size', '18', datetime('now'), datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [],
        ).unwrap();

        let value: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'app.font_size'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(value, "18");
    }

    #[test]
    fn async_settings_helpers_roundtrip_through_libsql() {
        let _env = crate::testkit::TestEnv::new("settings-libsql");

        tauri::async_runtime::block_on(async {
            upsert_setting_value_async("app.test_libsql", "one")
                .await
                .unwrap();
            assert_eq!(
                load_setting_value_async("app.test_libsql").await.unwrap(),
                Some("one".to_string())
            );

            upsert_setting_value_async("app.test_libsql", "two")
                .await
                .unwrap();
            let map = load_app_settings_map_async().await.unwrap();
            assert_eq!(map.get("app.test_libsql"), Some(&"two".to_string()));

            let removed = delete_setting_value_async("app.test_libsql").await.unwrap();
            assert_eq!(removed, 1);
            assert_eq!(
                load_setting_value_async("app.test_libsql").await.unwrap(),
                None
            );
        });
    }
}
