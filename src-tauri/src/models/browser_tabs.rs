use anyhow::{bail, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use url::Url;
use uuid::Uuid;

use crate::models::db;

mod libsql;

pub const DEFAULT_BROWSER_URL: &str = "https://www.google.com";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabRecord {
    pub id: String,
    pub workspace_id: String,
    pub url: String,
    pub title: Option<String>,
    pub display_order: i64,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedBrowserTabResult {
    pub workspace_id: String,
    pub fallback: Option<BrowserTabRecord>,
}

fn record_from_row(row: &Row<'_>) -> rusqlite::Result<BrowserTabRecord> {
    Ok(BrowserTabRecord {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        url: row.get("url")?,
        title: row.get("title")?,
        display_order: row.get("display_order")?,
        active: row.get::<_, i64>("active")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn normalize_browser_url(raw: Option<&str>) -> Result<String> {
    let trimmed = raw.unwrap_or(DEFAULT_BROWSER_URL).trim();
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else if trimmed.is_empty() {
        DEFAULT_BROWSER_URL.to_string()
    } else {
        format!("https://{trimmed}")
    };

    let parsed =
        Url::parse(&with_scheme).with_context(|| format!("Invalid browser URL: {with_scheme}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => bail!("Unsupported browser URL scheme: {scheme}"),
    }
    if parsed.host_str().is_none() {
        bail!("Browser URL must include a host");
    }
    Ok(parsed.to_string())
}

pub fn list_workspace_browser_tabs(workspace_id: &str) -> Result<Vec<BrowserTabRecord>> {
    tauri::async_runtime::block_on(list_workspace_browser_tabs_async(workspace_id))
}

pub fn get_browser_tab(tab_id: &str) -> Result<Option<BrowserTabRecord>> {
    tauri::async_runtime::block_on(get_browser_tab_async(tab_id))
}

async fn list_workspace_browser_tabs_async(workspace_id: &str) -> Result<Vec<BrowserTabRecord>> {
    let workspace_id = workspace_id.to_string();
    db::libsql_read_transaction_async(|connection| {
        Box::pin(async move {
            let mut rows = connection
                .query(
                    r#"
                    SELECT id, workspace_id, url, title, display_order, active, created_at, updated_at
                    FROM workspace_browser_tabs
                    WHERE workspace_id = ?1
                    ORDER BY display_order ASC, datetime(created_at) ASC, id ASC
                    "#,
                    [workspace_id],
                )
                .await
                .context("Failed to query workspace browser tabs")?;

            let mut tabs = Vec::new();
            while let Some(row) = rows.next().await? {
                tabs.push(libsql::record_from_row(&row)?);
            }
            Ok(tabs)
        })
    })
    .await
}

async fn get_browser_tab_async(tab_id: &str) -> Result<Option<BrowserTabRecord>> {
    let tab_id = tab_id.to_string();
    db::libsql_read_transaction_async(|connection| {
        Box::pin(async move {
            libsql::load_browser_tab(connection, &tab_id)
                .await
                .context("Failed to query browser tab")
        })
    })
    .await
}

pub fn list_workspace_browser_tabs_on(
    connection: &Connection,
    workspace_id: &str,
) -> Result<Vec<BrowserTabRecord>> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, workspace_id, url, title, display_order, active, created_at, updated_at
        FROM workspace_browser_tabs
        WHERE workspace_id = ?1
        ORDER BY display_order ASC, datetime(created_at) ASC, id ASC
        "#,
    )?;
    let rows = statement.query_map([workspace_id], record_from_row)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn create_browser_tab(
    workspace_id: &str,
    initial_url: Option<&str>,
) -> Result<BrowserTabRecord> {
    let url = normalize_browser_url(initial_url)?;
    let workspace_id = workspace_id.to_string();
    tauri::async_runtime::block_on(db::libsql_write_transaction_async(|tx| {
        Box::pin(async move { libsql::create_browser_tab_on(tx, &workspace_id, &url).await })
    }))
}

pub fn create_browser_tab_on(
    tx: &Transaction<'_>,
    workspace_id: &str,
    url: &str,
) -> Result<BrowserTabRecord> {
    ensure_workspace_exists(tx, workspace_id)?;
    let id = Uuid::new_v4().to_string();
    let display_order: i64 = tx.query_row(
        "SELECT COALESCE(MAX(display_order), -1) + 1 FROM workspace_browser_tabs WHERE workspace_id = ?1",
        [workspace_id],
        |row| row.get(0),
    )?;
    clear_active_browser_tab_on(tx, workspace_id)?;
    tx.execute(
        r#"
        INSERT INTO workspace_browser_tabs (id, workspace_id, url, title, display_order, active)
        VALUES (?1, ?2, ?3, NULL, ?4, 1)
        "#,
        params![id, workspace_id, url, display_order],
    )?;
    load_browser_tab_on(tx, &id)?.context("inserted browser tab missing")
}

pub fn select_browser_tab(tab_id: &str) -> Result<BrowserTabRecord> {
    let tab_id = tab_id.to_string();
    tauri::async_runtime::block_on(db::libsql_write_transaction_async(|tx| {
        Box::pin(async move { libsql::select_browser_tab_on(tx, &tab_id).await })
    }))
}

pub fn select_browser_tab_on(tx: &Transaction<'_>, tab_id: &str) -> Result<BrowserTabRecord> {
    let tab = load_browser_tab_on(tx, tab_id)?
        .with_context(|| format!("Browser tab not found: {tab_id}"))?;
    clear_active_browser_tab_on(tx, &tab.workspace_id)?;
    tx.execute(
        "UPDATE workspace_browser_tabs SET active = 1 WHERE id = ?1",
        [tab_id],
    )?;
    load_browser_tab_on(tx, tab_id)?.context("selected browser tab missing")
}

pub fn navigate_browser_tab(tab_id: &str, url: &str) -> Result<BrowserTabRecord> {
    let url = normalize_browser_url(Some(url))?;
    let tab_id = tab_id.to_string();
    tauri::async_runtime::block_on(db::libsql_write_transaction_async(|tx| {
        Box::pin(async move { libsql::navigate_browser_tab_on(tx, &tab_id, &url).await })
    }))
}

pub fn navigate_browser_tab_on(
    tx: &Transaction<'_>,
    tab_id: &str,
    url: &str,
) -> Result<BrowserTabRecord> {
    let tab = load_browser_tab_on(tx, tab_id)?
        .with_context(|| format!("Browser tab not found: {tab_id}"))?;
    clear_active_browser_tab_on(tx, &tab.workspace_id)?;
    tx.execute(
        "UPDATE workspace_browser_tabs SET url = ?1, title = NULL, active = 1 WHERE id = ?2",
        params![url, tab_id],
    )?;
    load_browser_tab_on(tx, tab_id)?.context("navigated browser tab missing")
}

pub fn update_browser_tab_title(
    tab_id: &str,
    title: Option<&str>,
) -> Result<Option<BrowserTabRecord>> {
    let tab_id = tab_id.to_string();
    let title = title.map(str::to_string);
    tauri::async_runtime::block_on(db::libsql_write_transaction_async(|tx| {
        Box::pin(async move {
            let Some(_) = libsql::load_browser_tab(tx, &tab_id).await? else {
                return Ok(None);
            };
            tx.execute(
                "UPDATE workspace_browser_tabs SET title = ?1 WHERE id = ?2",
                ::libsql::params![title, tab_id.clone()],
            )
            .await?;
            libsql::load_browser_tab(tx, &tab_id).await
        })
    }))
}

pub fn close_browser_tab(tab_id: &str) -> Result<Option<BrowserTabRecord>> {
    Ok(close_browser_tab_with_workspace(tab_id)?.and_then(|result| result.fallback))
}

pub fn close_browser_tab_with_workspace(tab_id: &str) -> Result<Option<ClosedBrowserTabResult>> {
    let tab_id = tab_id.to_string();
    tauri::async_runtime::block_on(db::libsql_write_transaction_async(|tx| {
        Box::pin(async move { libsql::close_browser_tab_with_workspace_on(tx, &tab_id).await })
    }))
}

pub fn close_browser_tab_with_workspace_on(
    tx: &Transaction<'_>,
    tab_id: &str,
) -> Result<Option<ClosedBrowserTabResult>> {
    close_browser_tab_with_workspace_inner(tx, tab_id)
}

pub fn close_browser_tab_on(
    tx: &Transaction<'_>,
    tab_id: &str,
) -> Result<Option<BrowserTabRecord>> {
    Ok(close_browser_tab_with_workspace_on(tx, tab_id)?.and_then(|result| result.fallback))
}

fn close_browser_tab_with_workspace_inner(
    tx: &Transaction<'_>,
    tab_id: &str,
) -> Result<Option<ClosedBrowserTabResult>> {
    let Some(tab) = load_browser_tab_on(tx, tab_id)? else {
        return Ok(None);
    };
    tx.execute("DELETE FROM workspace_browser_tabs WHERE id = ?1", [tab_id])?;
    if !tab.active {
        return Ok(Some(ClosedBrowserTabResult {
            workspace_id: tab.workspace_id,
            fallback: None,
        }));
    }
    let fallback_id: Option<String> = tx
        .query_row(
            r#"
            SELECT id
            FROM workspace_browser_tabs
            WHERE workspace_id = ?1
            ORDER BY
              CASE WHEN display_order > ?2 THEN 0 ELSE 1 END,
              ABS(display_order - ?2),
              display_order ASC,
              id ASC
            LIMIT 1
            "#,
            params![tab.workspace_id, tab.display_order],
            |row| row.get(0),
        )
        .optional()?;
    let fallback = match fallback_id {
        Some(fallback_id) => Some(select_browser_tab_on(tx, &fallback_id)?),
        None => None,
    };
    Ok(Some(ClosedBrowserTabResult {
        workspace_id: tab.workspace_id,
        fallback,
    }))
}

fn clear_active_browser_tab_on(tx: &Transaction<'_>, workspace_id: &str) -> Result<()> {
    tx.execute(
        "UPDATE workspace_browser_tabs SET active = 0 WHERE workspace_id = ?1 AND active = 1",
        [workspace_id],
    )?;
    Ok(())
}

fn ensure_workspace_exists(connection: &Connection, workspace_id: &str) -> Result<()> {
    let exists = connection
        .prepare("SELECT 1 FROM workspaces WHERE id = ?1")?
        .exists([workspace_id])?;
    if !exists {
        bail!("Workspace not found: {workspace_id}");
    }
    Ok(())
}

fn load_browser_tab_on(connection: &Connection, tab_id: &str) -> Result<Option<BrowserTabRecord>> {
    connection
        .query_row(
            r#"
            SELECT id, workspace_id, url, title, display_order, active, created_at, updated_at
            FROM workspace_browser_tabs
            WHERE id = ?1
            "#,
            [tab_id],
            record_from_row,
        )
        .optional()
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (Connection, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let connection = Connection::open(dir.path().join("test.db")).unwrap();
        crate::schema::ensure_schema(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO repos (id, name, root_path) VALUES ('repo-1', 'repo', '/tmp/repo')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO workspaces (id, repository_id, directory_name) VALUES ('ws-1', 'repo-1', 'work')",
                [],
            )
            .unwrap();
        (connection, dir)
    }

    fn active_count(connection: &Connection, workspace_id: &str) -> i64 {
        connection
            .query_row(
                "SELECT COUNT(*) FROM workspace_browser_tabs WHERE workspace_id = ?1 AND active = 1",
                [workspace_id],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn setup_libsql_env() -> crate::testkit::TestEnv {
        let env = crate::testkit::TestEnv::new("browser-tabs-libsql");
        let connection = env.db_connection();
        connection
            .execute(
                "INSERT INTO repos (id, name, root_path) VALUES ('repo-1', 'repo', '/tmp/repo')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO workspaces (id, repository_id, directory_name) VALUES ('ws-1', 'repo-1', 'work')",
                [],
            )
            .unwrap();
        env
    }

    #[test]
    fn normalize_adds_https_and_rejects_non_web_schemes() {
        assert_eq!(
            normalize_browser_url(Some("example.com")).unwrap(),
            "https://example.com/"
        );
        assert!(normalize_browser_url(Some("file:///etc/passwd")).is_err());
        assert!(normalize_browser_url(Some("https://")).is_err());
    }

    #[test]
    fn create_select_navigate_and_close_tabs() {
        let (mut connection, _dir) = setup();
        let tx = connection.transaction().unwrap();
        let first = create_browser_tab_on(&tx, "ws-1", "https://example.com/").unwrap();
        let second = create_browser_tab_on(&tx, "ws-1", "https://example.org/").unwrap();
        assert_eq!(active_count(&tx, "ws-1"), 1);
        assert!(!load_browser_tab_on(&tx, &first.id).unwrap().unwrap().active);
        assert!(second.active);

        let first = select_browser_tab_on(&tx, &first.id).unwrap();
        assert_eq!(active_count(&tx, "ws-1"), 1);
        assert!(first.active);
        let first = navigate_browser_tab_on(&tx, &first.id, "https://example.net/").unwrap();
        assert_eq!(active_count(&tx, "ws-1"), 1);
        assert_eq!(first.url, "https://example.net/");

        let fallback = close_browser_tab_on(&tx, &first.id).unwrap().unwrap();
        assert_eq!(fallback.id, second.id);
        assert!(fallback.active);
        assert_eq!(active_count(&tx, "ws-1"), 1);
        tx.commit().unwrap();
    }

    #[test]
    fn top_level_browser_tab_api_uses_libsql_path() {
        let _env = setup_libsql_env();

        let first = create_browser_tab("ws-1", Some("example.com")).unwrap();
        let second = create_browser_tab("ws-1", Some("example.org")).unwrap();
        assert_eq!(list_workspace_browser_tabs("ws-1").unwrap().len(), 2);
        assert!(!get_browser_tab(&first.id).unwrap().unwrap().active);
        assert!(second.active);

        let first = select_browser_tab(&first.id).unwrap();
        assert!(first.active);
        let first = navigate_browser_tab(&first.id, "example.net").unwrap();
        assert_eq!(first.url, "https://example.net/");
        let titled = update_browser_tab_title(&first.id, Some("Example"))
            .unwrap()
            .unwrap();
        assert_eq!(titled.title.as_deref(), Some("Example"));

        let fallback = close_browser_tab(&first.id).unwrap().unwrap();
        assert_eq!(fallback.id, second.id);
        assert!(fallback.active);
    }

    #[test]
    fn partial_unique_index_rejects_two_active_tabs_per_workspace() {
        let (connection, _dir) = setup();
        connection
            .execute(
                r#"
                INSERT INTO workspace_browser_tabs (id, workspace_id, url, active)
                VALUES ('tab-1', 'ws-1', 'https://example.com/', 1)
                "#,
                [],
            )
            .unwrap();
        let result = connection.execute(
            r#"
            INSERT INTO workspace_browser_tabs (id, workspace_id, url, active)
            VALUES ('tab-2', 'ws-1', 'https://example.org/', 1)
            "#,
            [],
        );
        assert!(result.is_err());
    }

    #[test]
    fn closing_inactive_tab_reports_workspace_without_fallback() {
        let (mut connection, _dir) = setup();
        let tx = connection.transaction().unwrap();
        let first = create_browser_tab_on(&tx, "ws-1", "https://example.com/").unwrap();
        let second = create_browser_tab_on(&tx, "ws-1", "https://example.org/").unwrap();
        assert!(second.active);

        let result = close_browser_tab_with_workspace_on(&tx, &first.id)
            .unwrap()
            .unwrap();
        assert_eq!(result.workspace_id, "ws-1");
        assert!(result.fallback.is_none());
        assert_eq!(active_count(&tx, "ws-1"), 1);
    }
}
