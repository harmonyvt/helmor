use anyhow::{bail, Context, Result};
use uuid::Uuid;

use super::{BrowserTabRecord, ClosedBrowserTabResult};

pub(super) async fn create_browser_tab_on(
    tx: &libsql::Transaction,
    workspace_id: &str,
    url: &str,
) -> Result<BrowserTabRecord> {
    ensure_workspace_exists(tx, workspace_id).await?;
    let id = Uuid::new_v4().to_string();
    let display_order = next_browser_tab_display_order(tx, workspace_id).await?;
    clear_active_browser_tab_on(tx, workspace_id).await?;
    tx.execute(
        r#"
        INSERT INTO workspace_browser_tabs (id, workspace_id, url, title, display_order, active)
        VALUES (?1, ?2, ?3, NULL, ?4, 1)
        "#,
        libsql::params![id.clone(), workspace_id, url, display_order],
    )
    .await?;
    load_browser_tab(tx, &id)
        .await?
        .context("inserted browser tab missing")
}

pub(super) async fn select_browser_tab_on(
    tx: &libsql::Transaction,
    tab_id: &str,
) -> Result<BrowserTabRecord> {
    let tab = load_browser_tab(tx, tab_id)
        .await?
        .with_context(|| format!("Browser tab not found: {tab_id}"))?;
    clear_active_browser_tab_on(tx, &tab.workspace_id).await?;
    tx.execute(
        "UPDATE workspace_browser_tabs SET active = 1 WHERE id = ?1",
        [tab_id],
    )
    .await?;
    load_browser_tab(tx, tab_id)
        .await?
        .context("selected browser tab missing")
}

pub(super) async fn navigate_browser_tab_on(
    tx: &libsql::Transaction,
    tab_id: &str,
    url: &str,
) -> Result<BrowserTabRecord> {
    let tab = load_browser_tab(tx, tab_id)
        .await?
        .with_context(|| format!("Browser tab not found: {tab_id}"))?;
    clear_active_browser_tab_on(tx, &tab.workspace_id).await?;
    tx.execute(
        "UPDATE workspace_browser_tabs SET url = ?1, title = NULL, active = 1 WHERE id = ?2",
        libsql::params![url, tab_id],
    )
    .await?;
    load_browser_tab(tx, tab_id)
        .await?
        .context("navigated browser tab missing")
}

pub(super) async fn close_browser_tab_with_workspace_on(
    tx: &libsql::Transaction,
    tab_id: &str,
) -> Result<Option<ClosedBrowserTabResult>> {
    let Some(tab) = load_browser_tab(tx, tab_id).await? else {
        return Ok(None);
    };
    tx.execute("DELETE FROM workspace_browser_tabs WHERE id = ?1", [tab_id])
        .await?;
    if !tab.active {
        return Ok(Some(ClosedBrowserTabResult {
            workspace_id: tab.workspace_id,
            fallback: None,
        }));
    }
    let mut rows = tx
        .query(
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
            libsql::params![tab.workspace_id.clone(), tab.display_order],
        )
        .await?;
    let fallback_id = rows
        .next()
        .await?
        .map(|row| row.get::<String>(0))
        .transpose()
        .context("Failed to read fallback browser tab id")?;
    let fallback = match fallback_id {
        Some(fallback_id) => Some(select_browser_tab_on(tx, &fallback_id).await?),
        None => None,
    };
    Ok(Some(ClosedBrowserTabResult {
        workspace_id: tab.workspace_id,
        fallback,
    }))
}

pub(super) async fn load_browser_tab(
    connection: &libsql::Connection,
    tab_id: &str,
) -> Result<Option<BrowserTabRecord>> {
    let mut rows = connection
        .query(
            r#"
            SELECT id, workspace_id, url, title, display_order, active, created_at, updated_at
            FROM workspace_browser_tabs
            WHERE id = ?1
            "#,
            [tab_id],
        )
        .await?;
    rows.next()
        .await?
        .map(|row| record_from_row(&row))
        .transpose()
}

async fn clear_active_browser_tab_on(tx: &libsql::Transaction, workspace_id: &str) -> Result<()> {
    tx.execute(
        "UPDATE workspace_browser_tabs SET active = 0 WHERE workspace_id = ?1 AND active = 1",
        [workspace_id],
    )
    .await?;
    Ok(())
}

async fn ensure_workspace_exists(
    connection: &libsql::Connection,
    workspace_id: &str,
) -> Result<()> {
    let mut rows = connection
        .query("SELECT 1 FROM workspaces WHERE id = ?1", [workspace_id])
        .await?;
    if rows.next().await?.is_none() {
        bail!("Workspace not found: {workspace_id}");
    }
    Ok(())
}

async fn next_browser_tab_display_order(
    connection: &libsql::Connection,
    workspace_id: &str,
) -> Result<i64> {
    let mut rows = connection
        .query(
            "SELECT COALESCE(MAX(display_order), -1) + 1 FROM workspace_browser_tabs WHERE workspace_id = ?1",
            [workspace_id],
        )
        .await?;
    let row = rows
        .next()
        .await?
        .context("display order query returned no row")?;
    row.get(0)
        .context("Failed to read next browser tab display order")
}

pub(super) fn record_from_row(row: &libsql::Row) -> Result<BrowserTabRecord> {
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
