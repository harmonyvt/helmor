use helmor_lib::schema;
use insta::assert_yaml_snapshot;

fn repos_branch_prefix_columns(connection: &rusqlite::Connection) -> Vec<(String, String)> {
    let mut statement = connection
        .prepare(
            "SELECT name, type FROM pragma_table_info('repos')
             WHERE name LIKE 'branch_prefix%'
             ORDER BY cid",
        )
        .unwrap();
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

#[test]
fn repos_branch_prefix_override_migration_is_idempotent() {
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            r#"
            CREATE TABLE repos (
                id TEXT PRIMARY KEY,
                name TEXT,
                default_branch TEXT,
                root_path TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            "#,
        )
        .unwrap();

    schema::ensure_schema(&connection).unwrap();
    schema::ensure_schema(&connection).unwrap();

    assert_yaml_snapshot!(
        "repos_branch_prefix_override_migration",
        repos_branch_prefix_columns(&connection)
    );
}

fn browser_tab_schema(connection: &rusqlite::Connection) -> serde_json::Value {
    let columns = connection
        .prepare(
            "SELECT name, type, [notnull], dflt_value, pk
             FROM pragma_table_info('workspace_browser_tabs')
             ORDER BY cid",
        )
        .unwrap()
        .query_map([], |row| {
            Ok(serde_json::json!({
                "name": row.get::<_, String>(0)?,
                "type": row.get::<_, String>(1)?,
                "notNull": row.get::<_, i64>(2)? != 0,
                "default": row.get::<_, Option<String>>(3)?,
                "primaryKey": row.get::<_, i64>(4)? != 0,
            }))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    let indexes = connection
        .prepare(
            "SELECT name, sql
             FROM sqlite_master
             WHERE type = 'index' AND tbl_name = 'workspace_browser_tabs'
             ORDER BY name",
        )
        .unwrap()
        .query_map([], |row| {
            Ok(serde_json::json!({
                "name": row.get::<_, String>(0)?,
                "sql": row.get::<_, Option<String>>(1)?,
            }))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    serde_json::json!({ "columns": columns, "indexes": indexes })
}

fn goal_supervisor_notifications_schema(connection: &rusqlite::Connection) -> serde_json::Value {
    let columns = connection
        .prepare(
            "SELECT name, type, [notnull], dflt_value, pk
             FROM pragma_table_info('goal_supervisor_notifications')
             ORDER BY cid",
        )
        .unwrap()
        .query_map([], |row| {
            Ok(serde_json::json!({
                "name": row.get::<_, String>(0)?,
                "type": row.get::<_, String>(1)?,
                "notNull": row.get::<_, i64>(2)? != 0,
                "default": row.get::<_, Option<String>>(3)?,
                "primaryKey": row.get::<_, i64>(4)? != 0,
            }))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    let indexes = connection
        .prepare(
            "SELECT name, sql
             FROM sqlite_master
             WHERE type = 'index' AND tbl_name = 'goal_supervisor_notifications'
             ORDER BY name",
        )
        .unwrap()
        .query_map([], |row| {
            Ok(serde_json::json!({
                "name": row.get::<_, String>(0)?,
                "sql": row.get::<_, Option<String>>(1)?,
            }))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    serde_json::json!({ "columns": columns, "indexes": indexes })
}

fn table_schema(connection: &rusqlite::Connection, table: &str) -> serde_json::Value {
    let columns = connection
        .prepare(
            "SELECT name, type, [notnull], dflt_value, pk
             FROM pragma_table_info(?1)
             ORDER BY cid",
        )
        .unwrap()
        .query_map([table], |row| {
            Ok(serde_json::json!({
                "name": row.get::<_, String>(0)?,
                "type": row.get::<_, String>(1)?,
                "notNull": row.get::<_, i64>(2)? != 0,
                "default": row.get::<_, Option<String>>(3)?,
                "primaryKey": row.get::<_, i64>(4)? != 0,
            }))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    let indexes = connection
        .prepare(
            "SELECT name, sql
             FROM sqlite_master
             WHERE type = 'index' AND tbl_name = ?1
             ORDER BY name",
        )
        .unwrap()
        .query_map([table], |row| {
            Ok(serde_json::json!({
                "name": row.get::<_, String>(0)?,
                "sql": row.get::<_, Option<String>>(1)?,
            }))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    serde_json::json!({ "columns": columns, "indexes": indexes })
}

#[test]
fn workspace_browser_tabs_schema_is_snapshotted() {
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    schema::ensure_schema(&connection).unwrap();

    assert_yaml_snapshot!(
        "workspace_browser_tabs_schema",
        browser_tab_schema(&connection)
    );
}

#[test]
fn goal_supervisor_notifications_schema_is_snapshotted() {
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    schema::ensure_schema(&connection).unwrap();

    assert_yaml_snapshot!(
        "goal_supervisor_notifications_schema",
        goal_supervisor_notifications_schema(&connection)
    );
}

#[test]
fn knowledge_schema_is_snapshotted() {
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    schema::ensure_schema(&connection).unwrap();

    assert_yaml_snapshot!(
        "knowledge_schema",
        serde_json::json!({
            "projects": table_schema(&connection, "knowledge_projects"),
            "goals": table_schema(&connection, "knowledge_goals"),
            "runs": table_schema(&connection, "knowledge_index_runs"),
            "audit": table_schema(&connection, "knowledge_query_audit"),
        })
    );
}
