use std::{collections::VecDeque, fs, path::PathBuf, sync::Mutex};

use anyhow::{Context, Result};
use rusqlite::Connection;

use super::*;
use crate::data_dir::TEST_ENV_LOCK;

struct MockOrcaRunner {
    responses: Mutex<VecDeque<OrcaCommandOutput>>,
    calls: Mutex<Vec<Vec<String>>>,
}

impl MockOrcaRunner {
    fn new(responses: Vec<OrcaCommandOutput>) -> Self {
        Self {
            responses: Mutex::new(VecDeque::from(responses)),
            calls: Mutex::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<Vec<String>> {
        self.calls.lock().unwrap().clone()
    }
}

impl OrcaRunner for MockOrcaRunner {
    fn run(&self, args: &[&str]) -> Result<OrcaCommandOutput> {
        self.calls
            .lock()
            .unwrap()
            .push(args.iter().map(|arg| (*arg).to_string()).collect());
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .context("missing mock Orca response")
    }
}

fn ok_json(json: &str) -> OrcaCommandOutput {
    OrcaCommandOutput {
        success: true,
        stdout: json.to_string(),
        stderr: String::new(),
    }
}

fn fail_json(json: &str) -> OrcaCommandOutput {
    OrcaCommandOutput {
        success: false,
        stdout: json.to_string(),
        stderr: String::new(),
    }
}

fn fail_text(stderr: &str) -> OrcaCommandOutput {
    OrcaCommandOutput {
        success: false,
        stdout: String::new(),
        stderr: stderr.to_string(),
    }
}

struct TransferTestHarness {
    root: PathBuf,
    repo_id: String,
    repo_name: String,
}

impl TransferTestHarness {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "helmor-orca-transfer-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::env::set_var("HELMOR_DATA_DIR", root.display().to_string());
        crate::data_dir::ensure_directory_structure().unwrap();
        let schema_conn =
            Connection::open(crate::data_dir::db_path().unwrap()).expect("open schema conn");
        crate::schema::ensure_schema(&schema_conn).expect("ensure schema");
        drop(schema_conn);
        crate::models::db::init_pools().expect("init test DB pools");

        let repo_id = "repo-transfer".to_string();
        let repo_name = "transfer-repo".to_string();
        let repo_root = root.join("source-repo");
        fs::create_dir_all(&repo_root).unwrap();
        let connection = Connection::open(crate::data_dir::db_path().unwrap()).unwrap();
        connection
            .execute(
                r#"
				INSERT INTO repos (
					id,
					name,
					remote_url,
					default_branch,
					root_path,
					display_order,
					hidden
				) VALUES (?1, ?2, NULL, 'main', ?3, 1, 0)
				"#,
                (&repo_id, &repo_name, repo_root.to_string_lossy().as_ref()),
            )
            .unwrap();

        Self {
            root,
            repo_id,
            repo_name,
        }
    }

    fn db_path(&self) -> PathBuf {
        crate::data_dir::db_path().unwrap()
    }

    fn workspace_dir(&self, directory_name: &str) -> PathBuf {
        crate::data_dir::workspace_dir(&self.repo_name, directory_name).unwrap()
    }
}

impl Drop for TransferTestHarness {
    fn drop(&mut self) {
        std::env::remove_var("HELMOR_DATA_DIR");
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn harness_with_workspace() -> (TransferTestHarness, String) {
    let harness = TransferTestHarness::new();
    let workspace_id = "workspace-transfer".to_string();
    let directory_name = "transfer-workspace";
    let workspace_dir = harness.workspace_dir(directory_name);
    fs::create_dir_all(&workspace_dir).unwrap();
    let connection = Connection::open(harness.db_path()).unwrap();
    connection
        .execute(
            r#"
			INSERT INTO workspaces (
				id,
				repository_id,
				directory_name,
				state,
				status,
				branch
			) VALUES (?1, ?2, ?3, 'ready', 'in-progress', 'feature/transfer')
			"#,
            (&workspace_id, &harness.repo_id, directory_name),
        )
        .unwrap();

    (harness, workspace_id)
}

#[test]
fn transfer_returns_already_tracked_when_repo_and_worktree_exist() {
    let _guard = TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (_harness, workspace_id) = harness_with_workspace();
    let runner = MockOrcaRunner::new(vec![
        ok_json(r#"{"ok":true,"result":{"id":"repo-1","path":"/repo"}}"#),
        ok_json(r#"{"ok":true,"result":{"worktree":{"id":"worktree-1","path":"/workspace"}}}"#),
    ]);

    let response = transfer_workspace_to_orca_with_runner(&workspace_id, &runner).unwrap();

    assert_eq!(
        response.status,
        TransferWorkspaceToOrcaStatus::AlreadyTracked
    );
    assert_eq!(response.orca_repo_id.as_deref(), Some("repo-1"));
    assert_eq!(response.orca_worktree_id.as_deref(), Some("worktree-1"));
    assert_eq!(runner.calls().len(), 2);
}

#[test]
fn transfer_adds_repo_then_adopts_worktree_when_repo_is_missing() {
    let _guard = TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (_harness, workspace_id) = harness_with_workspace();
    let runner = MockOrcaRunner::new(vec![
        fail_json(
            r#"{"ok":false,"error":{"code":"selector_not_found","message":"selector_not_found"}}"#,
        ),
        ok_json(r#"{"ok":true,"result":{"id":"repo-2","path":"/repo"}}"#),
        ok_json(r#"{"ok":true,"result":{"worktree":{"id":"worktree-2","path":"/workspace"}}}"#),
    ]);

    let response = transfer_workspace_to_orca_with_runner(&workspace_id, &runner).unwrap();
    let calls = runner.calls();

    assert_eq!(response.status, TransferWorkspaceToOrcaStatus::Adopted);
    assert_eq!(response.orca_repo_id.as_deref(), Some("repo-2"));
    assert_eq!(response.orca_worktree_id.as_deref(), Some("worktree-2"));
    assert_eq!(calls[1][0..3], ["repo", "add", "--path"]);
}

#[test]
fn transfer_reports_missing_orca_cli() {
    let _guard = TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (_harness, workspace_id) = harness_with_workspace();
    let runner = MockOrcaRunner::new(vec![fail_text("orca: command not found")]);

    let error = transfer_workspace_to_orca_with_runner(&workspace_id, &runner).unwrap_err();

    assert!(error.to_string().contains("Orca CLI failed"));
    assert!(error.to_string().contains("orca: command not found"));
}

#[test]
fn transfer_fails_when_worktree_selector_remains_missing() {
    let _guard = TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (_harness, workspace_id) = harness_with_workspace();
    let runner = MockOrcaRunner::new(vec![
        fail_json(
            r#"{"ok":false,"error":{"code":"selector_not_found","message":"selector_not_found"}}"#,
        ),
        ok_json(r#"{"ok":true,"result":{"id":"repo-2","path":"/repo"}}"#),
        fail_json(
            r#"{"ok":false,"error":{"code":"selector_not_found","message":"selector_not_found"}}"#,
        ),
    ]);

    let error = transfer_workspace_to_orca_with_runner(&workspace_id, &runner).unwrap_err();

    assert!(error.to_string().contains("external worktree"));
}

#[test]
fn transfer_rejects_malformed_orca_json() {
    let _guard = TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (_harness, workspace_id) = harness_with_workspace();
    let runner = MockOrcaRunner::new(vec![ok_json("not json")]);

    let error = transfer_workspace_to_orca_with_runner(&workspace_id, &runner).unwrap_err();

    assert!(error.to_string().contains("invalid JSON"));
}
