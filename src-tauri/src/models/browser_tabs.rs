use anyhow::{bail, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use url::Url;
use uuid::Uuid;

use crate::models::db;

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
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            r#"
        SELECT id, workspace_id, url, title, display_order, active, created_at, updated_at
        FROM workspace_browser_tabs
        WHERE workspace_id = ?1
        ORDER BY display_order ASC, datetime(created_at) ASC, id ASC
        "#,
            [workspace_id.to_string()],
        )
        .await
        .context("Failed to query workspace browser tabs")?;

    let mut tabs = Vec::new();
    while let Some(row) = rows.next().await? {
        tabs.push(record_from_libsql_row(&row)?);
    }
    Ok(tabs)
}

async fn get_browser_tab_async(tab_id: &str) -> Result<Option<BrowserTabRecord>> {
    let connection = db::libsql_conn_async().await?;
    let mut rows = connection
        .query(
            r#"
            SELECT id, workspace_id, url, title, display_order, active, created_at, updated_at
            FROM workspace_browser_tabs
            WHERE id = ?1
            "#,
            [tab_id.to_string()],
        )
        .await
        .context("Failed to query browser tab")?;
    rows.next()
        .await?
        .map(|row| record_from_libsql_row(&row))
        .transpose()
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
    db::write_transaction(|tx| create_browser_tab_on(tx, workspace_id, &url))
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
    db::write_transaction(|tx| select_browser_tab_on(tx, tab_id))
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
    db::write_transaction(|tx| navigate_browser_tab_on(tx, tab_id, &url))
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
    db::write_transaction(|tx| {
        let Some(_) = load_browser_tab_on(tx, tab_id)? else {
            return Ok(None);
        };
        tx.execute(
            "UPDATE workspace_browser_tabs SET title = ?1 WHERE id = ?2",
            params![title, tab_id],
        )?;
        load_browser_tab_on(tx, tab_id)
    })
}

pub fn close_browser_tab(tab_id: &str) -> Result<Option<BrowserTabRecord>> {
    Ok(close_browser_tab_with_workspace(tab_id)?.and_then(|result| result.fallback))
}

pub fn close_browser_tab_with_workspace(tab_id: &str) -> Result<Option<ClosedBrowserTabResult>> {
    db::write_transaction(|tx| close_browser_tab_with_workspace_on(tx, tab_id))
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

fn record_from_libsql_row(row: &libsql::Row) -> Result<BrowserTabRecord> {
    let active: i64 = row
        .get(5)
        .context("Failed to read browser tab active flag")?;
    Ok(BrowserTabRecord {
        id: row.get(0).context("Failed to read browser tab id")?,
        workspace_id: row
            .get(1)
            .context("Failed to read browser tab workspace id")?,
        url: row.get(2).context("Failed to read browser tab url")?,
        title: row.get(3).context("Failed to read browser tab title")?,
        display_order: row
            .get(4)
            .context("Failed to read browser tab display order")?,
        active: active != 0,
        created_at: row
            .get(6)
            .context("Failed to read browser tab created_at")?,
        updated_at: row
            .get(7)
            .context("Failed to read browser tab updated_at")?,
    })
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
