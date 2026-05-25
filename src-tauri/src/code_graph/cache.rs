//! SQLite-backed per-file edge cache + in-memory layer for the
//! code-graph builder.
//!
//! Schema lives in `src/schema.rs::SCHEMA_SQL` (table
//! `code_graph_file_edges`). The cache key is `(workspace_id,
//! file_path)`; we re-parse only when `content_hash` differs.

use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock, RwLock},
};

use anyhow::{Context, Result};
use rusqlite::Connection;

use super::types::{CodeGraph, CodeGraphLanguage, UnresolvedEdge};

#[derive(Debug, Clone)]
pub struct CachedFileEdges {
    pub content_hash: String,
    pub language: CodeGraphLanguage,
    pub edges: Vec<UnresolvedEdge>,
}

#[derive(Debug, Clone, Default)]
pub struct WorkspaceEdgeCache {
    /// workspace-relative path → cached edges
    pub entries: HashMap<String, CachedFileEdges>,
}

/// Read-through SQLite cache for one workspace.
pub fn load_workspace_cache(workspace_id: &str) -> Result<WorkspaceEdgeCache> {
    let conn = open_conn()?;
    let mut stmt = conn.prepare(
        "SELECT file_path, content_hash, language, edges_json
         FROM code_graph_file_edges
         WHERE workspace_id = ?1",
    )?;
    let mut rows = stmt.query(rusqlite::params![workspace_id])?;
    let mut entries = HashMap::new();
    while let Some(row) = rows.next()? {
        let file_path: String = row.get(0)?;
        let content_hash: String = row.get(1)?;
        let language_str: String = row.get(2)?;
        let edges_json: String = row.get(3)?;
        let language = match CodeGraphLanguage::from_label(&language_str) {
            Some(l) => l,
            None => continue,
        };
        let edges: Vec<UnresolvedEdge> = serde_json::from_str(&edges_json).unwrap_or_default();
        entries.insert(
            file_path,
            CachedFileEdges {
                content_hash,
                language,
                edges,
            },
        );
    }
    Ok(WorkspaceEdgeCache { entries })
}

/// Writes the given files' edges to the cache, replacing prior rows for
/// the same `(workspace_id, file_path)`.
pub fn persist_file_edges(workspace_id: &str, updates: &[(String, CachedFileEdges)]) -> Result<()> {
    if updates.is_empty() {
        return Ok(());
    }
    let mut conn = open_conn()?;
    let tx = conn.transaction()?;
    let parsed_at_ms = chrono::Utc::now().timestamp_millis();
    {
        let mut stmt = tx.prepare(
            "INSERT INTO code_graph_file_edges
                 (workspace_id, file_path, content_hash, language, parsed_at_ms, edges_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(workspace_id, file_path) DO UPDATE SET
                 content_hash = excluded.content_hash,
                 language     = excluded.language,
                 parsed_at_ms = excluded.parsed_at_ms,
                 edges_json   = excluded.edges_json",
        )?;
        for (path, edges) in updates {
            let edges_json = serde_json::to_string(&edges.edges)
                .with_context(|| format!("Failed to serialise edges for {path}"))?;
            stmt.execute(rusqlite::params![
                workspace_id,
                path,
                edges.content_hash,
                edges.language.as_str(),
                parsed_at_ms,
                edges_json,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Deletes cached edges for files no longer present in the workspace.
pub fn prune_missing_files(workspace_id: &str, present_files: &HashSet<String>) -> Result<()> {
    let mut conn = open_conn()?;
    let tx = conn.transaction()?;
    let to_delete: Vec<String> = {
        let mut stmt =
            tx.prepare("SELECT file_path FROM code_graph_file_edges WHERE workspace_id = ?1")?;
        let mut rows = stmt.query(rusqlite::params![workspace_id])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let path: String = row.get(0)?;
            if !present_files.contains(&path) {
                out.push(path);
            }
        }
        out
    };
    if !to_delete.is_empty() {
        let mut stmt = tx.prepare(
            "DELETE FROM code_graph_file_edges
             WHERE workspace_id = ?1 AND file_path = ?2",
        )?;
        for path in to_delete {
            stmt.execute(rusqlite::params![workspace_id, path])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// In-memory cache of the fully-resolved CodeGraph per workspace_id.
/// Lets a second invocation of `code_graph_get` return instantly without
/// re-walking SQLite.
static GRAPH_MEM_CACHE: OnceLock<RwLock<HashMap<String, CodeGraph>>> = OnceLock::new();

pub fn get_in_memory(workspace_id: &str) -> Option<CodeGraph> {
    let lock = GRAPH_MEM_CACHE.get()?;
    let guard = lock.read().ok()?;
    guard.get(workspace_id).cloned()
}

pub fn put_in_memory(workspace_id: &str, graph: CodeGraph) {
    let lock = GRAPH_MEM_CACHE.get_or_init(|| RwLock::new(HashMap::new()));
    if let Ok(mut guard) = lock.write() {
        guard.insert(workspace_id.to_string(), graph);
    }
}

pub fn drop_in_memory(workspace_id: &str) {
    if let Some(lock) = GRAPH_MEM_CACHE.get() {
        if let Ok(mut guard) = lock.write() {
            guard.remove(workspace_id);
        }
    }
}

/// Wraps rusqlite::Connection creation so all call sites share one error
/// path. Uses the same DB path as the rest of the app.
fn open_conn() -> Result<Connection> {
    use crate::data_dir;
    static CONN_GUARD: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = CONN_GUARD
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|e| anyhow::anyhow!("DB mutex poisoned: {e}"))?;
    let path = data_dir::db_path()?;
    Connection::open(&path)
        .with_context(|| format!("Failed to open code-graph cache DB at {}", path.display()))
}
