//! DB connection management + unified API.
//!
//! libSQL is the canonical local database opener for startup/schema readiness.
//! The rusqlite pools remain as a compatibility layer while call sites migrate
//! from raw synchronous rusqlite handles to the libSQL facade in slices.
//!
//! Two pools match SQLite's concurrency model:
//!   - read pool  (size = 8) — WAL readers run fully concurrently
//!   - write pool (size = 1) — single-writer executor; app-layer queue
//!     eliminates SQLITE_BUSY
//!
//! Initialise once at startup via [`init_pools`]. All DB access goes
//! through [`read_conn`] / [`write_conn`] or the closure helpers
//! [`read`] / [`write_transaction`].
use std::collections::HashMap;
use std::future::Future;
use std::panic::Location;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use chrono::{SecondsFormat, Utc};
use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, OpenFlags, Transaction};
use serde::Serialize;
use tauri::async_runtime::Mutex;

pub type PooledConn = PooledConnection<SqliteConnectionManager>;

/// Serializes FS-mutating operations on a workspace (worktree creation /
/// removal / reset) together with the DB row update, so concurrent commands
/// can't interleave a half-applied filesystem change with a DB update.
pub static WORKSPACE_FS_MUTATION_LOCK: Mutex<()> = Mutex::const_new(());

/// Per-workspace FS-mutation lock map (see [`WORKSPACE_FS_MUTATION_LOCK`]).
fn per_workspace_locks() -> &'static std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static MAP: OnceLock<std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    MAP.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

pub fn workspace_fs_mutation_lock(workspace_id: &str) -> Arc<Mutex<()>> {
    let mut map = per_workspace_locks()
        .lock()
        .expect("per-workspace lock map poisoned");
    map.entry(workspace_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

pub fn remove_workspace_lock(workspace_id: &str) {
    if let Ok(mut map) = per_workspace_locks().lock() {
        map.remove(workspace_id);
    }
}

// ── Pools ────────────────────────────────────────────────────────────────

struct PoolBundle {
    path: PathBuf,
    read: Pool<SqliteConnectionManager>,
    write: Pool<SqliteConnectionManager>,
}

struct LibsqlBundle {
    path: PathBuf,
    database: Arc<libsql::Database>,
    write_lock: Arc<Mutex<()>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolStateSnapshot {
    pub connections: u32,
    pub idle_connections: u32,
}

impl From<r2d2::State> for PoolStateSnapshot {
    fn from(value: r2d2::State) -> Self {
        Self {
            connections: value.connections,
            idle_connections: value.idle_connections,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbLockSnapshot {
    pub global_workspace_fs_mutation_locked: bool,
    pub tracked_workspace_lock_count: usize,
    pub libsql_write_locked: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbFileSnapshot {
    pub path: String,
    pub exists: bool,
    pub bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbRuntimeDiagnostics {
    pub db_path: String,
    pub read_pool: Option<PoolStateSnapshot>,
    pub write_pool: Option<PoolStateSnapshot>,
    pub locks: DbLockSnapshot,
    pub files: Vec<DbFileSnapshot>,
    pub wal_checkpoint: Option<WalCheckpointStats>,
    pub pragmas: serde_json::Value,
    pub errors: Vec<String>,
}

/// RwLock-wrapped so tests can transparently rebuild the pools when they
/// swap `HELMOR_DATA_DIR`. In production [`init_pools`] runs once and the
/// lock sees a single writer forever.
fn pool_slot() -> &'static RwLock<Option<PoolBundle>> {
    static P: OnceLock<RwLock<Option<PoolBundle>>> = OnceLock::new();
    P.get_or_init(|| RwLock::new(None))
}

fn libsql_slot() -> &'static RwLock<Option<LibsqlBundle>> {
    static P: OnceLock<RwLock<Option<LibsqlBundle>>> = OnceLock::new();
    P.get_or_init(|| RwLock::new(None))
}

const READ_POOL_SIZE: u32 = 8;
const WRITE_POOL_SIZE: u32 = 1;
const POOL_GET_TIMEOUT: Duration = Duration::from_secs(30);
const LIBSQL_BUSY_TIMEOUT: Duration = Duration::from_secs(30);
const SLOW_LIBSQL_WRITE_WARN_MS: u128 = 100;

type BoxedDbFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

#[derive(Debug, Clone, Copy)]
pub enum WalCheckpointMode {
    Passive,
    Truncate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalCheckpointStats {
    pub busy: i64,
    pub log_frames: i64,
    pub checkpointed_frames: i64,
}

/// Unified per-connection initialization. Applied by both pools and by any
/// ad-hoc `Connection::open` sites (schema init, tests, import).
///
/// Writable-only PRAGMAs (journal_mode, synchronous, busy_timeout) are
/// skipped on read-only connections: SQLite can't rewrite the journal
/// header from a read-only handle, and busy_timeout is moot for readers
/// in WAL mode (readers never block). `journal_mode=WAL` only needs to be
/// set ONCE per DB file (it persists), done on the first writable open.
pub fn init_connection(conn: &Connection, writable: bool) -> rusqlite::Result<()> {
    // Read-compatible PRAGMAs — safe and useful on either handle type.
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.pragma_update(None, "cache_size", -20_000)?; // 20 MiB
    conn.pragma_update(None, "mmap_size", 268_435_456i64)?; // 256 MiB

    if writable {
        // journal_mode is persisted to the DB file on first set; idempotent here.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(Duration::from_secs(3))?;
        // TODO(tech-debt): enable foreign_keys=ON once an orphan-cleanup migration lands.
    }

    conn.set_prepared_statement_cache_capacity(256);
    Ok(())
}

fn build_bundle(path: std::path::PathBuf) -> Result<PoolBundle> {
    let write_mgr = SqliteConnectionManager::file(&path)
        .with_flags(
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .with_init(|c| init_connection(c, true));
    let write = Pool::builder()
        .max_size(WRITE_POOL_SIZE)
        .connection_timeout(POOL_GET_TIMEOUT)
        .build(write_mgr)
        .map_err(|e| anyhow!("Failed to build write pool: {e}"))?;

    let read_mgr = SqliteConnectionManager::file(&path)
        .with_flags(OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .with_init(|c| init_connection(c, false));
    let read = Pool::builder()
        .max_size(READ_POOL_SIZE)
        .connection_timeout(POOL_GET_TIMEOUT)
        .build(read_mgr)
        .map_err(|e| anyhow!("Failed to build read pool: {e}"))?;

    Ok(PoolBundle { path, read, write })
}

fn build_libsql_bundle(path: PathBuf) -> Result<LibsqlBundle> {
    // During the compatibility phase Helmor loads both rusqlite and libSQL in
    // one process. rusqlite may initialize SQLite first, which makes libSQL's
    // global threading-mode assertion panic even though our app-level read/write
    // discipline is still explicit. Remove this once rusqlite is gone.
    let database = tauri::async_runtime::block_on(unsafe {
        libsql::Builder::new_local(&path)
            .skip_safety_assert(true)
            .build()
    })
    .with_context(|| format!("Failed to build libSQL database at {}", path.display()))?;
    Ok(LibsqlBundle {
        path,
        database: Arc::new(database),
        write_lock: Arc::new(Mutex::const_new(())),
    })
}

async fn build_libsql_bundle_async(path: PathBuf) -> Result<LibsqlBundle> {
    // During the compatibility phase Helmor loads both rusqlite and libSQL in
    // one process. rusqlite may initialize SQLite first, which makes libSQL's
    // global threading-mode assertion panic even though our app-level read/write
    // discipline is still explicit. Remove this once rusqlite is gone.
    let database = unsafe {
        libsql::Builder::new_local(&path)
            .skip_safety_assert(true)
            .build()
            .await
    }
    .with_context(|| format!("Failed to build libSQL database at {}", path.display()))?;
    Ok(LibsqlBundle {
        path,
        database: Arc::new(database),
        write_lock: Arc::new(Mutex::const_new(())),
    })
}

/// Unified per-libSQL-connection initialization. This mirrors
/// [`init_connection`] for the new local DB facade.
async fn init_libsql_connection_async(conn: &libsql::Connection, writable: bool) -> Result<()> {
    if writable {
        conn.busy_timeout(LIBSQL_BUSY_TIMEOUT)
            .context("Failed to set libSQL busy timeout")?;
    }

    let mut sql = String::from(
        r#"
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -20000;
        PRAGMA mmap_size = 268435456;
        "#,
    );
    if writable {
        sql.push_str(
            r#"
            PRAGMA query_only = OFF;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            "#,
        );
    } else {
        sql.push_str(
            r#"
            PRAGMA query_only = ON;
            "#,
        );
    }
    conn.execute_batch(&sql)
        .await
        .map(|_| ())
        .context("Failed to apply libSQL connection PRAGMAs")
}

pub fn init_libsql_connection(conn: &libsql::Connection, writable: bool) -> Result<()> {
    tauri::async_runtime::block_on(init_libsql_connection_async(conn, writable))
}

fn with_libsql_bundle<T>(f: impl FnOnce(&LibsqlBundle) -> Result<T>) -> Result<T> {
    #[cfg(not(test))]
    {
        let guard = libsql_slot()
            .read()
            .map_err(|_| anyhow!("libSQL bundle lock poisoned"))?;
        if let Some(bundle) = guard.as_ref() {
            return f(bundle);
        }
    }

    let current_path = crate::data_dir::db_path()?;

    {
        let guard = libsql_slot()
            .read()
            .map_err(|_| anyhow!("libSQL bundle lock poisoned"))?;
        if let Some(bundle) = guard.as_ref() {
            if bundle.path == current_path {
                return f(bundle);
            }
        }
    }

    let mut guard = libsql_slot()
        .write()
        .map_err(|_| anyhow!("libSQL bundle lock poisoned"))?;
    if guard
        .as_ref()
        .map(|b| b.path != current_path)
        .unwrap_or(true)
    {
        tracing::debug!(
            path = %current_path.display(),
            "db: rebuilding libSQL bundle (first access or HELMOR_DATA_DIR changed)"
        );
        *guard = Some(build_libsql_bundle(current_path)?);
    }
    f(guard.as_ref().expect("libSQL bundle just initialised"))
}

/// Initialise the local libSQL database handle against the current
/// `HELMOR_DATA_DIR`.
pub fn init_libsql() -> Result<()> {
    let path = crate::data_dir::db_path()?;
    {
        let guard = libsql_slot()
            .read()
            .map_err(|_| anyhow!("libSQL bundle lock poisoned"))?;
        if guard.as_ref().is_some_and(|bundle| bundle.path == path) {
            tracing::debug!(path = %path.display(), "db: libSQL local database already initialised");
            return Ok(());
        }
    }

    let mut guard = libsql_slot()
        .write()
        .map_err(|_| anyhow!("libSQL bundle lock poisoned"))?;
    if guard.as_ref().is_some_and(|bundle| bundle.path == path) {
        tracing::debug!(path = %path.display(), "db: libSQL local database already initialised");
        return Ok(());
    }

    tracing::info!(path = %path.display(), "db: initialising libSQL local database");
    let bundle = build_libsql_bundle(path)?;
    *guard = Some(bundle);
    Ok(())
}

/// Async variant of [`init_libsql`] for code already running on Tokio.
pub async fn init_libsql_async() -> Result<()> {
    let path = crate::data_dir::db_path()?;
    {
        let guard = libsql_slot()
            .read()
            .map_err(|_| anyhow!("libSQL bundle lock poisoned"))?;
        if guard.as_ref().is_some_and(|bundle| bundle.path == path) {
            tracing::debug!(path = %path.display(), "db: libSQL local database already initialised");
            return Ok(());
        }
    }

    tracing::info!(path = %path.display(), "db: initialising libSQL local database");
    let bundle = build_libsql_bundle_async(path.clone()).await?;
    let mut guard = libsql_slot()
        .write()
        .map_err(|_| anyhow!("libSQL bundle lock poisoned"))?;
    if guard.as_ref().is_some_and(|current| current.path == path) {
        tracing::debug!(path = %path.display(), "db: libSQL local database already initialised");
        return Ok(());
    }
    *guard = Some(bundle);
    Ok(())
}

async fn ensure_libsql_bundle_async() -> Result<()> {
    let current_path = crate::data_dir::db_path()?;

    {
        let guard = libsql_slot()
            .read()
            .map_err(|_| anyhow!("libSQL bundle lock poisoned"))?;
        if let Some(bundle) = guard.as_ref() {
            if bundle.path == current_path {
                return Ok(());
            }
        }
    }

    tracing::debug!(
        path = %current_path.display(),
        "db: rebuilding libSQL bundle asynchronously (first access or HELMOR_DATA_DIR changed)"
    );
    let bundle = build_libsql_bundle_async(current_path.clone()).await?;
    let mut guard = libsql_slot()
        .write()
        .map_err(|_| anyhow!("libSQL bundle lock poisoned"))?;
    if guard
        .as_ref()
        .map(|b| b.path != current_path)
        .unwrap_or(true)
    {
        *guard = Some(bundle);
    }
    Ok(())
}

async fn libsql_async_parts() -> Result<(Arc<libsql::Database>, Arc<Mutex<()>>)> {
    ensure_libsql_bundle_async().await?;
    with_libsql_bundle(|bundle| Ok((Arc::clone(&bundle.database), Arc::clone(&bundle.write_lock))))
}

/// Open a libSQL connection against the current local database.
pub fn libsql_conn() -> Result<libsql::Connection> {
    with_libsql_bundle(|bundle| {
        let conn = bundle
            .database
            .connect()
            .context("Failed to connect to local libSQL database")?;
        init_libsql_connection(&conn, true)?;
        Ok(conn)
    })
}

/// Open a libSQL connection from async code without nesting a Tokio runtime.
pub async fn libsql_conn_async() -> Result<libsql::Connection> {
    let (database, _) = libsql_async_parts().await?;
    let conn = database
        .connect()
        .context("Failed to connect to local libSQL database")?;
    init_libsql_connection_async(&conn, true).await?;
    Ok(conn)
}

/// Open a libSQL connection intended for read-only work.
///
/// Local libSQL connections do not have an OS-level read-only open flag, so
/// callers that need enforcement should use [`libsql_read_transaction_async`].
pub async fn libsql_read_conn_async() -> Result<libsql::Connection> {
    let (database, _) = libsql_async_parts().await?;
    let conn = database
        .connect()
        .context("Failed to connect to local libSQL database")?;
    init_libsql_connection_async(&conn, false).await?;
    Ok(conn)
}

/// Run a read closure inside a libSQL `READONLY` transaction.
pub async fn libsql_read_transaction_async<F, T>(f: F) -> Result<T>
where
    F: for<'tx> FnOnce(&'tx libsql::Transaction) -> BoxedDbFuture<'tx, T>,
{
    let conn = libsql_read_conn_async().await?;
    let tx = conn
        .transaction_with_behavior(libsql::TransactionBehavior::ReadOnly)
        .await
        .context("Failed to start libSQL read-only transaction")?;
    let result = f(&tx).await;
    match result {
        Ok(value) => {
            tx.commit()
                .await
                .context("Failed to commit libSQL read-only transaction")?;
            Ok(value)
        }
        Err(error) => {
            let _ = tx.rollback().await;
            Err(error)
        }
    }
}

/// Run a closure with a libSQL connection under the single-writer lock.
///
/// This is the target write path for migrated call sites. The legacy
/// `write_conn` compatibility API below keeps using the rusqlite pool until
/// its callers are converted.
#[allow(dead_code)]
pub async fn libsql_write<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&libsql::Connection) -> Result<T>,
{
    let caller = Location::caller();
    let (database, write_lock) = with_libsql_bundle(|bundle| {
        Ok((Arc::clone(&bundle.database), Arc::clone(&bundle.write_lock)))
    })?;
    let wait_start = std::time::Instant::now();
    let _guard = write_lock.lock().await;
    let wait_ms = wait_start.elapsed().as_millis();
    if wait_ms >= SLOW_LIBSQL_WRITE_WARN_MS {
        tracing::warn!(
            elapsed_ms = wait_ms,
            caller_file = caller.file(),
            caller_line = caller.line(),
            "db: slow libSQL write lock wait"
        );
    }
    let held_start = std::time::Instant::now();
    let conn = database
        .connect()
        .context("Failed to connect to local libSQL database")?;
    init_libsql_connection_async(&conn, true).await?;
    let result = f(&conn);
    let held_ms = held_start.elapsed().as_millis();
    if held_ms >= SLOW_LIBSQL_WRITE_WARN_MS {
        tracing::warn!(
            elapsed_ms = held_ms,
            caller_file = caller.file(),
            caller_line = caller.line(),
            "db: slow libSQL write lock hold"
        );
    }
    result
}

/// Run an async closure with a libSQL connection under the single-writer lock.
#[allow(dead_code)]
pub async fn libsql_write_async<F, Fut, T>(f: F) -> Result<T>
where
    F: FnOnce(libsql::Connection) -> Fut,
    Fut: Future<Output = Result<T>>,
{
    let caller = Location::caller();
    let (database, write_lock) = libsql_async_parts().await?;
    let wait_start = std::time::Instant::now();
    let _guard = write_lock.lock().await;
    let wait_ms = wait_start.elapsed().as_millis();
    if wait_ms >= SLOW_LIBSQL_WRITE_WARN_MS {
        tracing::warn!(
            elapsed_ms = wait_ms,
            caller_file = caller.file(),
            caller_line = caller.line(),
            "db: slow libSQL write lock wait"
        );
    }
    let held_start = std::time::Instant::now();
    let conn = database
        .connect()
        .context("Failed to connect to local libSQL database")?;
    init_libsql_connection_async(&conn, true).await?;
    let result = f(conn).await;
    let held_ms = held_start.elapsed().as_millis();
    if held_ms >= SLOW_LIBSQL_WRITE_WARN_MS {
        tracing::warn!(
            elapsed_ms = held_ms,
            caller_file = caller.file(),
            caller_line = caller.line(),
            "db: slow libSQL write lock hold"
        );
    }
    result
}

/// Run a write closure inside a libSQL `IMMEDIATE` transaction.
///
/// This claims the single writer up front, avoiding deferred transaction
/// upgrade surprises while still preserving Helmor's app-level writer queue.
#[allow(dead_code)]
pub async fn libsql_write_transaction_async<F, T>(f: F) -> Result<T>
where
    F: for<'tx> FnOnce(&'tx libsql::Transaction) -> BoxedDbFuture<'tx, T>,
{
    let caller = Location::caller();
    libsql_write_async(|conn| async move {
        let tx = conn
            .transaction_with_behavior(libsql::TransactionBehavior::Immediate)
            .await
            .context("Failed to start libSQL immediate write transaction")?;
        let result = f(&tx).await;
        match result {
            Ok(value) => {
                tx.commit()
                    .await
                    .context("Failed to commit libSQL write transaction")?;
                Ok(value)
            }
            Err(error) => {
                let _ = tx.rollback().await;
                Err(error)
            }
        }
    })
    .await
    .with_context(|| {
        format!(
            "libSQL write transaction failed at {}:{}",
            caller.file(),
            caller.line()
        )
    })
}

#[allow(dead_code)]
pub async fn checkpoint_wal_async(mode: WalCheckpointMode) -> Result<WalCheckpointStats> {
    let sql = match mode {
        WalCheckpointMode::Passive => "PRAGMA wal_checkpoint(PASSIVE)",
        WalCheckpointMode::Truncate => "PRAGMA wal_checkpoint(TRUNCATE)",
    };
    libsql_write_async(|conn| async move {
        let mut rows = conn
            .query(sql, ())
            .await
            .context("Failed to run WAL checkpoint")?;
        let Some(row) = rows.next().await? else {
            return Err(anyhow!("WAL checkpoint returned no rows"));
        };
        Ok(WalCheckpointStats {
            busy: row.get(0).context("Failed to read checkpoint busy flag")?,
            log_frames: row.get(1).context("Failed to read checkpoint log frames")?,
            checkpointed_frames: row
                .get(2)
                .context("Failed to read checkpointed WAL frames")?,
        })
    })
    .await
}

/// Ensure the local database file, libSQL handle, schema, and compatibility
/// rusqlite pools are ready.
pub fn ensure_ready() -> Result<()> {
    crate::data_dir::ensure_directory_structure()?;
    init_libsql()?;
    let conn = libsql_conn()?;
    crate::schema::ensure_schema_libsql(&conn)?;
    init_pools()?;
    Ok(())
}

/// Initialise both pools against the current `HELMOR_DATA_DIR`. Called once
/// during app startup. In tests, [`read_conn`] / [`write_conn`] auto-rebuild
/// the pools whenever the data dir changes, so individual test helpers
/// don't need to remember to call this.
pub fn init_pools() -> Result<()> {
    let path = crate::data_dir::db_path()?;
    tracing::info!(
        path = %path.display(),
        read_pool_size = READ_POOL_SIZE,
        write_pool_size = WRITE_POOL_SIZE,
        "db: initialising pools"
    );
    let bundle = build_bundle(path)?;
    *pool_slot()
        .write()
        .map_err(|_| anyhow!("pool lock poisoned"))? = Some(bundle);
    Ok(())
}

/// Ensure pools exist and point at the current `HELMOR_DATA_DIR`. Rebuilds
/// transparently if the data dir has changed (tests) or if pools were
/// never built (first call).
///
/// Prod fast path skips `db_path()` resolution: pools are built once at
/// startup and never swapped. Tests still resolve every call so they can
/// hot-swap `HELMOR_DATA_DIR`.
fn with_bundle<T>(f: impl FnOnce(&PoolBundle) -> Result<T>) -> Result<T> {
    #[cfg(not(test))]
    {
        let guard = pool_slot()
            .read()
            .map_err(|_| anyhow!("pool lock poisoned"))?;
        if let Some(bundle) = guard.as_ref() {
            return f(bundle);
        }
    }

    let current_path = crate::data_dir::db_path()?;

    {
        let guard = pool_slot()
            .read()
            .map_err(|_| anyhow!("pool lock poisoned"))?;
        if let Some(bundle) = guard.as_ref() {
            if bundle.path == current_path {
                return f(bundle);
            }
        }
    }

    // Slow path: need to (re)build. Double-check under the write lock.
    let mut guard = pool_slot()
        .write()
        .map_err(|_| anyhow!("pool lock poisoned"))?;
    if guard
        .as_ref()
        .map(|b| b.path != current_path)
        .unwrap_or(true)
    {
        tracing::debug!(
            path = %current_path.display(),
            "db: rebuilding pool bundle (first access or HELMOR_DATA_DIR changed)"
        );
        *guard = Some(build_bundle(current_path)?);
    }
    f(guard.as_ref().expect("pool bundle just initialised"))
}

/// Log any pool borrow that takes longer than this. Below the threshold we
/// stay silent to avoid flooding the hot streaming path; above it, the
/// delay is a signal that another caller is holding the writer too long.
const SLOW_BORROW_WARN_MS: u128 = 100;

/// Borrow a read connection from the read pool. WAL lets multiple readers
/// proceed concurrently and never block the writer.
#[track_caller]
pub fn read_conn() -> Result<PooledConn> {
    // Capture caller OUTSIDE the closure: `#[track_caller]` only propagates
    // across the direct call boundary, so calling `Location::caller()`
    // inside `with_bundle`'s closure would resolve to db.rs itself.
    let caller = Location::caller();
    with_bundle(|bundle| {
        let start = std::time::Instant::now();
        let conn = bundle
            .read
            .get()
            .map_err(|e| anyhow!("Failed to borrow read connection: {e}"))?;
        let elapsed_ms = start.elapsed().as_millis();
        if elapsed_ms >= SLOW_BORROW_WARN_MS {
            tracing::warn!(
                elapsed_ms,
                pool_state = ?bundle.read.state(),
                caller_file = caller.file(),
                caller_line = caller.line(),
                "db: slow read_conn borrow"
            );
        }
        Ok(conn)
    })
}

/// Borrow the writer connection. Pool `max_size = 1`, so callers serialize
/// at the pool layer — no SQLITE_BUSY from intra-process contention.
/// Hold for as short as possible; long-held writes starve all other writers.
#[track_caller]
pub fn write_conn() -> Result<PooledConn> {
    let caller = Location::caller();
    with_bundle(|bundle| {
        let start = std::time::Instant::now();
        let conn = bundle.write.get().map_err(|e| {
            tracing::error!(
                elapsed_ms = start.elapsed().as_millis(),
                pool_state = ?bundle.write.state(),
                caller_file = caller.file(),
                caller_line = caller.line(),
                "db: write_conn borrow failed (pool timeout? holder stuck?): {e}"
            );
            anyhow!("Failed to borrow write connection: {e}")
        })?;
        let elapsed_ms = start.elapsed().as_millis();
        if elapsed_ms >= SLOW_BORROW_WARN_MS {
            tracing::warn!(
                elapsed_ms,
                pool_state = ?bundle.write.state(),
                caller_file = caller.file(),
                caller_line = caller.line(),
                "db: slow write_conn borrow — another writer held the pool"
            );
        }
        Ok(conn)
    })
}

/// Run a read-only closure with a pool-borrowed connection.
#[allow(dead_code)]
pub fn read<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T>,
{
    let conn = read_conn()?;
    f(&conn)
}

/// Run a write closure inside a transaction. Commits on Ok, rolls back on Err.
#[allow(dead_code)]
pub fn write_transaction<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&Transaction) -> Result<T>,
{
    let mut conn = write_conn()?;
    let tx = conn.transaction()?;
    let result = f(&tx)?;
    tx.commit()?;
    Ok(result)
}

// ── Utilities ────────────────────────────────────────────────────────────

pub fn runtime_diagnostics() -> DbRuntimeDiagnostics {
    let mut errors = Vec::new();
    let db_path = match crate::data_dir::db_path() {
        Ok(path) => path,
        Err(error) => {
            return DbRuntimeDiagnostics {
                db_path: String::new(),
                read_pool: None,
                write_pool: None,
                locks: DbLockSnapshot {
                    global_workspace_fs_mutation_locked: WORKSPACE_FS_MUTATION_LOCK
                        .try_lock()
                        .is_err(),
                    tracked_workspace_lock_count: per_workspace_locks()
                        .lock()
                        .map(|locks| locks.len())
                        .unwrap_or_default(),
                    libsql_write_locked: None,
                },
                files: Vec::new(),
                wal_checkpoint: None,
                pragmas: serde_json::json!({}),
                errors: vec![format!("failed to resolve db path: {error:#}")],
            };
        }
    };

    let (read_pool, write_pool) = match pool_slot().read() {
        Ok(guard) => guard
            .as_ref()
            .filter(|bundle| bundle.path == db_path)
            .map(|bundle| {
                (
                    Some(PoolStateSnapshot::from(bundle.read.state())),
                    Some(PoolStateSnapshot::from(bundle.write.state())),
                )
            })
            .unwrap_or((None, None)),
        Err(_) => {
            errors.push("pool slot lock poisoned".to_string());
            (None, None)
        }
    };

    let libsql_write_locked = match libsql_slot().read() {
        Ok(guard) => guard
            .as_ref()
            .filter(|bundle| bundle.path == db_path)
            .map(|bundle| bundle.write_lock.try_lock().is_err()),
        Err(_) => {
            errors.push("libSQL bundle lock poisoned".to_string());
            None
        }
    };

    let global_workspace_fs_mutation_locked = WORKSPACE_FS_MUTATION_LOCK.try_lock().is_err();
    let tracked_workspace_lock_count = per_workspace_locks()
        .lock()
        .map(|locks| locks.len())
        .unwrap_or_else(|_| {
            errors.push("per-workspace lock map poisoned".to_string());
            0
        });

    let files = db_related_file_snapshots(&db_path);
    let mut pragmas = serde_json::json!({});
    let mut wal_checkpoint = None;
    match read_conn() {
        Ok(conn) => {
            pragmas = serde_json::json!({
                "journalMode": query_pragma_string(&conn, "journal_mode").ok(),
                "synchronous": query_pragma_i64(&conn, "synchronous").ok(),
                "busyTimeoutMs": query_pragma_i64(&conn, "busy_timeout").ok(),
                "walAutocheckpoint": query_pragma_i64(&conn, "wal_autocheckpoint").ok(),
                "cacheSize": query_pragma_i64(&conn, "cache_size").ok(),
                "mmapSize": query_pragma_i64(&conn, "mmap_size").ok(),
                "lockingMode": query_pragma_string(&conn, "locking_mode").ok(),
                "databaseList": database_list(&conn).unwrap_or_else(|error| {
                    errors.push(format!("failed to read PRAGMA database_list: {error:#}"));
                    Vec::new()
                }),
            });
            match wal_checkpoint_passive(&conn) {
                Ok(stats) => wal_checkpoint = Some(stats),
                Err(error) => {
                    errors.push(format!("failed to run passive WAL checkpoint: {error:#}"))
                }
            }
        }
        Err(error) => errors.push(format!(
            "failed to borrow read connection for diagnostics: {error:#}"
        )),
    }

    DbRuntimeDiagnostics {
        db_path: db_path.display().to_string(),
        read_pool,
        write_pool,
        locks: DbLockSnapshot {
            global_workspace_fs_mutation_locked,
            tracked_workspace_lock_count,
            libsql_write_locked,
        },
        files,
        wal_checkpoint,
        pragmas,
        errors,
    }
}

fn db_related_file_snapshots(db_path: &std::path::Path) -> Vec<DbFileSnapshot> {
    [
        db_path.to_path_buf(),
        sqlite_sidecar_path(db_path, "wal"),
        sqlite_sidecar_path(db_path, "shm"),
    ]
    .into_iter()
    .map(|path| {
        let metadata = std::fs::metadata(&path).ok();
        DbFileSnapshot {
            path: path.display().to_string(),
            exists: metadata.is_some(),
            bytes: metadata.map(|meta| meta.len()),
        }
    })
    .collect()
}

fn sqlite_sidecar_path(db_path: &std::path::Path, suffix: &str) -> PathBuf {
    let mut os = db_path.as_os_str().to_os_string();
    os.push(format!("-{suffix}"));
    PathBuf::from(os)
}

fn query_pragma_string(conn: &Connection, name: &str) -> rusqlite::Result<String> {
    conn.query_row(&format!("PRAGMA {name}"), [], |row| row.get(0))
}

fn query_pragma_i64(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    conn.query_row(&format!("PRAGMA {name}"), [], |row| row.get(0))
}

fn wal_checkpoint_passive(conn: &Connection) -> rusqlite::Result<WalCheckpointStats> {
    conn.query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |row| {
        Ok(WalCheckpointStats {
            busy: row.get(0)?,
            log_frames: row.get(1)?,
            checkpointed_frames: row.get(2)?,
        })
    })
}

fn database_list(conn: &Connection) -> rusqlite::Result<Vec<serde_json::Value>> {
    let mut stmt = conn.prepare("PRAGMA database_list")?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "seq": row.get::<_, i64>(0)?,
            "name": row.get::<_, String>(1)?,
            "file": row.get::<_, String>(2)?,
        }))
    })?;
    rows.collect()
}

/// Current UTC timestamp in RFC 3339 / millisecond precision.
pub fn current_timestamp() -> Result<String> {
    Ok(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn test_env() -> crate::testkit::TestEnv {
        crate::testkit::TestEnv::new("pool")
    }

    #[test]
    fn write_pool_serializes_concurrent_writers_without_sqlite_busy() {
        // Regression for the locked-DB storm: with max_size=1, concurrent
        // writers must queue at the pool layer and never surface SQLITE_BUSY.
        let _env = test_env();
        write_conn()
            .unwrap()
            .execute_batch("CREATE TABLE counters (id INTEGER PRIMARY KEY, v INTEGER)")
            .unwrap();
        write_conn()
            .unwrap()
            .execute("INSERT INTO counters (id, v) VALUES (1, 0)", [])
            .unwrap();

        let handles: Vec<_> = (0..16)
            .map(|_| {
                thread::spawn(|| {
                    for _ in 0..25 {
                        let conn = write_conn().expect("pool borrow");
                        conn.execute("UPDATE counters SET v = v + 1 WHERE id = 1", [])
                            .expect("no SQLITE_BUSY");
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        let final_v: i64 = read_conn()
            .unwrap()
            .query_row("SELECT v FROM counters WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(final_v, 16 * 25);
    }

    #[test]
    fn streaming_short_borrow_leaves_writer_available() {
        // Regression for the reviewer's Finding 1: as long as streaming
        // short-borrows the writer, unrelated writes must still acquire the
        // single writer without hitting the 30s connection_timeout.
        let _env = test_env();
        write_conn()
            .unwrap()
            .execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            .unwrap();

        // Simulate a long-running stream that *briefly* borrows the writer
        // per-event, without ever holding it across iterations.
        let streaming = thread::spawn(|| {
            for i in 0..50 {
                let conn = write_conn().expect("streaming per-event borrow");
                conn.execute("INSERT INTO t (id) VALUES (?1)", [i]).unwrap();
                drop(conn);
                thread::sleep(std::time::Duration::from_millis(2));
            }
        });

        // Concurrently, an unrelated write (e.g. mark_session_read) must
        // succeed without waiting anywhere near the pool timeout.
        let start = std::time::Instant::now();
        for i in 100..110 {
            write_conn()
                .expect("unrelated write should not starve")
                .execute("INSERT INTO t (id) VALUES (?1)", [i])
                .unwrap();
        }
        let elapsed = start.elapsed();
        streaming.join().unwrap();

        assert!(
            elapsed < std::time::Duration::from_secs(5),
            "unrelated writes starved by streaming: {:?}",
            elapsed,
        );
    }

    #[test]
    fn read_pool_connection_is_read_only() {
        // Regression for the reviewer's Finding 4: the read-pool handle
        // must actually reject writes, so callers can't accidentally route
        // writes through the read pool.
        let _env = test_env();
        write_conn()
            .unwrap()
            .execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            .unwrap();

        let conn = read_conn().unwrap();
        let err = conn
            .execute("INSERT INTO t (id) VALUES (1)", [])
            .unwrap_err();
        let msg = err.to_string().to_lowercase();
        assert!(
            msg.contains("read-only") || msg.contains("readonly"),
            "expected read-only rejection, got: {msg}",
        );
    }

    #[test]
    fn libsql_read_transaction_rejects_writes() {
        let _env = test_env();
        ensure_ready().unwrap();
        tauri::async_runtime::block_on(libsql_write_async(|conn| async move {
            conn.execute("CREATE TABLE readonly_probe (id INTEGER PRIMARY KEY)", ())
                .await?;
            Ok(())
        }))
        .unwrap();

        let err = tauri::async_runtime::block_on(libsql_read_transaction_async(|tx| {
            Box::pin(async move {
                tx.execute("INSERT INTO readonly_probe (id) VALUES (1)", ())
                    .await?;
                Ok(())
            })
        }))
        .unwrap_err();
        let msg = err.to_string().to_lowercase();
        assert!(
            msg.contains("readonly") || msg.contains("read-only") || msg.contains("write"),
            "expected read-only rejection, got: {msg}",
        );
    }

    #[test]
    fn libsql_immediate_write_transaction_commits() {
        let _env = test_env();
        ensure_ready().unwrap();
        tauri::async_runtime::block_on(libsql_write_async(|conn| async move {
            conn.execute(
                "CREATE TABLE write_tx_probe (id INTEGER PRIMARY KEY, v TEXT)",
                (),
            )
            .await?;
            Ok(())
        }))
        .unwrap();

        tauri::async_runtime::block_on(libsql_write_transaction_async(|tx| {
            Box::pin(async move {
                tx.execute(
                    "INSERT INTO write_tx_probe (id, v) VALUES (1, 'committed')",
                    (),
                )
                .await?;
                Ok(())
            })
        }))
        .unwrap();

        let value: String = tauri::async_runtime::block_on(libsql_read_transaction_async(|tx| {
            Box::pin(async move {
                let mut rows = tx
                    .query("SELECT v FROM write_tx_probe WHERE id = 1", ())
                    .await?;
                let row = rows.next().await?.expect("inserted row");
                row.get(0).map_err(Into::into)
            })
        }))
        .unwrap();
        assert_eq!(value, "committed");
    }

    #[test]
    fn libsql_wal_checkpoint_reports_stats() {
        let _env = test_env();
        ensure_ready().unwrap();
        tauri::async_runtime::block_on(libsql_write_async(|conn| async move {
            conn.execute("CREATE TABLE checkpoint_probe (id INTEGER PRIMARY KEY)", ())
                .await?;
            conn.execute("INSERT INTO checkpoint_probe (id) VALUES (1)", ())
                .await?;
            Ok(())
        }))
        .unwrap();

        let stats =
            tauri::async_runtime::block_on(checkpoint_wal_async(WalCheckpointMode::Passive))
                .unwrap();
        assert!(stats.busy >= 0);
        assert!(stats.log_frames >= 0);
        assert!(stats.checkpointed_frames >= 0);
    }

    #[test]
    fn libsql_readiness_creates_schema_for_compatibility_pool() {
        let _env = test_env();
        ensure_ready().unwrap();

        let conn = libsql_conn().unwrap();
        let has_sessions: i64 = tauri::async_runtime::block_on(async {
            let mut rows = conn
                .query(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
                    (),
                )
                .await
                .unwrap();
            let row = rows.next().await.unwrap().unwrap();
            row.get(0).unwrap()
        });
        assert_eq!(has_sessions, 1);

        let compat_count: i64 = read_conn()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(compat_count, 1);
    }
}
