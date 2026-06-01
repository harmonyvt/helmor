//! Tests for `sync_git_context_with_target_branch`.
//!
//! Focuses on the new outcomes added alongside submodule support —
//! `NoTargetBranch` and the explicit refusal to default to "main".
//! The happy paths (`Updated`, `AlreadyUpToDate`, `Conflict`,
//! `DirtyWorktree`) are covered by the workspace-level sync tests in
//! `commands/tests/branch_switch.rs`.

use std::fs;

use rusqlite::Connection;

use crate::data_dir::TEST_ENV_LOCK;
use crate::editor_files;
use crate::git_ops;
use crate::workspaces::SyncWorkspaceTargetOutcome;

use super::support::TestDataDir;

/// Initialize a temp data dir, register one allowed workspace root,
/// and return the absolute path to that workspace dir. The returned
/// `TestDataDir` MUST be kept alive for the duration of the test so
/// the env var stays set and the temp directory survives.
fn init_workspace_root() -> (TestDataDir, std::path::PathBuf) {
    let test_dir = TestDataDir::new("git-context-sync");
    let connection = Connection::open(crate::data_dir::db_path().unwrap()).unwrap();
    connection
        .execute(
            "INSERT INTO repos (id, name, root_path) VALUES ('repo-x', 'helmor', '/unused')",
            [],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO workspaces (id, repository_id, directory_name, state, status) \
             VALUES ('ws-x', 'repo-x', 'ctx-sync', 'ready', 'in-progress')",
            [],
        )
        .unwrap();
    let workspace_dir = crate::data_dir::workspace_dir("helmor", "ctx-sync").unwrap();
    fs::create_dir_all(&workspace_dir).unwrap();
    (test_dir, workspace_dir)
}

fn init_git_repo(root: &std::path::Path) {
    git_ops::run_git(["init", "-b", "main"], Some(root)).unwrap();
    git_ops::run_git(["config", "user.email", "test@helmor.test"], Some(root)).unwrap();
    git_ops::run_git(["config", "user.name", "Test"], Some(root)).unwrap();
    git_ops::run_git(["config", "commit.gpgsign", "false"], Some(root)).unwrap();
    fs::write(root.join("README.md"), "# Test\n").unwrap();
    git_ops::run_git(["add", "."], Some(root)).unwrap();
    git_ops::run_git(["commit", "-m", "init"], Some(root)).unwrap();
}

#[test]
fn sync_reports_no_target_branch_when_unresolvable() {
    // Serialize with other env-var-mutating tests (data_dir::tests,
    // image_store, ui_sync::socket) — they all share the global
    // `HELMOR_DATA_DIR` so concurrent execution corrupts each other's
    // test directories.
    let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let (_test_dir, workspace_dir) = init_workspace_root();
    init_git_repo(&workspace_dir);

    // Detach the branch from any remote so the local resolver cannot
    // pick a default:
    //   - no upstream config
    //   - no `refs/remotes/<remote>/HEAD`
    //   - no remote `main` / `master`
    // The previous behavior silently fell back to "main"; we now
    // return a typed outcome the UI can surface.
    let result = editor_files::sync_git_context_with_target_branch(
        workspace_dir.to_str().unwrap(),
        None,
        None,
    )
    .expect("sync helper should not error when target branch is unresolvable");
    assert_eq!(
        result.outcome,
        SyncWorkspaceTargetOutcome::NoTargetBranch,
        "expected NoTargetBranch outcome, got {result:?}"
    );
    assert!(
        result.target_branch.is_empty(),
        "NoTargetBranch outcome should leave target_branch empty, got {:?}",
        result.target_branch
    );
}

#[test]
fn sync_uses_caller_provided_target_branch() {
    let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let (_test_dir, workspace_dir) = init_workspace_root();
    init_git_repo(&workspace_dir);

    // No remote configured → fetch will fail. We expect the typed
    // `FetchFailed` outcome rather than a bubbled error.
    let result = editor_files::sync_git_context_with_target_branch(
        workspace_dir.to_str().unwrap(),
        Some("origin"),
        Some("main"),
    )
    .expect("sync helper should classify fetch failure rather than bubbling");
    assert_eq!(
        result.outcome,
        SyncWorkspaceTargetOutcome::FetchFailed,
        "expected FetchFailed outcome when fetch errors, got {result:?}"
    );
    assert_eq!(result.target_branch, "main");
}
