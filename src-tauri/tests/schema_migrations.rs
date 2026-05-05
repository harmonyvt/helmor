use helmor_lib::schema;
use insta::assert_yaml_snapshot;

fn workspace_columns(
    connection: &rusqlite::Connection,
    names: &[&str],
) -> Vec<(String, String, Option<String>)> {
    let placeholders = names.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT name, type, dflt_value FROM pragma_table_info('workspaces') WHERE name IN ({placeholders}) ORDER BY cid"
    );
    let mut statement = connection.prepare(&sql).unwrap();
    let params = rusqlite::params_from_iter(names.iter());
    statement
        .query_map(params, |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

fn remote_workspace_columns(
    connection: &rusqlite::Connection,
) -> Vec<(String, String, Option<String>)> {
    workspace_columns(
        connection,
        &[
            "location_kind",
            "remote_profile_id",
            "remote_backend",
            "remote_root_path",
            "remote_container_name",
            "remote_host",
            "remote_status",
            "remote_error",
        ],
    )
}

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

#[test]
fn fresh_schema_contains_remote_workspace_columns() {
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    schema::ensure_schema(&connection).unwrap();

    assert_yaml_snapshot!(
        "fresh_schema_remote_workspace_columns",
        remote_workspace_columns(&connection)
    );
}

#[test]
fn legacy_schema_migrates_remote_workspace_columns() {
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            r#"
            CREATE TABLE workspaces (
                id TEXT PRIMARY KEY,
                repository_id TEXT,
                directory_name TEXT,
                branch TEXT,
                state TEXT DEFAULT 'ready',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            INSERT INTO workspaces (id, repository_id, directory_name)
            VALUES ('w-legacy', 'r-1', 'legacy');
            "#,
        )
        .unwrap();

    schema::ensure_schema(&connection).unwrap();

    assert_yaml_snapshot!(
        "legacy_schema_remote_workspace_columns",
        remote_workspace_columns(&connection)
    );
    let location_kind: String = connection
        .query_row(
            "SELECT location_kind FROM workspaces WHERE id = 'w-legacy'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(location_kind, "local");
}
