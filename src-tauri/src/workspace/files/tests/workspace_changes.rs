use super::list_workspace_git_panel;
use super::support::GitRepoHarness;

use std::fs;

#[test]
fn classification_unstaged_modification() {
    let repo = GitRepoHarness::new();

    repo.write_file("src/app.ts", "const v1 = true;\n");
    repo.git(&["add", "src/app.ts"]);
    repo.git(&["commit", "-m", "add app"]);
    repo.write_file("src/app.ts", "const v2 = true;\n");

    let item = repo.find("src/app.ts").expect("file should appear");
    assert!(
        item.unstaged_status.is_some(),
        "should have unstaged_status: {item:?}"
    );
    assert_eq!(item.unstaged_status.as_deref(), Some("M"));
    assert!(item.committed_status.is_some());
}

#[test]
fn classification_staged_modification() {
    let repo = GitRepoHarness::new();

    repo.write_file("src/app.ts", "const v1 = true;\n");
    repo.git(&["add", "src/app.ts"]);
    repo.git(&["commit", "-m", "add app"]);
    repo.write_file("src/app.ts", "const v2 = true;\n");
    repo.git(&["add", "src/app.ts"]);

    let item = repo.find("src/app.ts").expect("file should appear");
    assert_eq!(
        item.staged_status.as_deref(),
        Some("M"),
        "should have staged M: {item:?}"
    );
    assert!(
        item.unstaged_status.is_none(),
        "should NOT have unstaged_status: {item:?}"
    );
}

#[test]
fn classification_untracked_file() {
    let repo = GitRepoHarness::new();

    repo.write_file("new-file.txt", "hello\nworld\n");

    let item = repo.find("new-file.txt").expect("file should appear");
    assert_eq!(
        item.unstaged_status.as_deref(),
        Some("A"),
        "untracked file should have unstaged A: {item:?}"
    );
    assert!(
        item.staged_status.is_none(),
        "untracked should NOT have staged_status: {item:?}"
    );
    assert!(
        item.committed_status.is_none(),
        "untracked should NOT have committed_status: {item:?}"
    );
    assert_eq!(item.insertions, 2);
    assert_eq!(item.deletions, 0);
}

#[test]
fn classification_staged_new_file() {
    let repo = GitRepoHarness::new();

    repo.write_file("new-file.txt", "hello\n");
    repo.git(&["add", "new-file.txt"]);

    let item = repo.find("new-file.txt").expect("file should appear");
    assert_eq!(
        item.staged_status.as_deref(),
        Some("A"),
        "staged new file should have staged A: {item:?}"
    );
    assert!(
        item.unstaged_status.is_none(),
        "fully staged should NOT have unstaged_status: {item:?}"
    );
}

#[test]
fn classification_committed_on_branch() {
    let repo = GitRepoHarness::new();

    repo.write_file("feature.ts", "export const feature = true;\n");
    repo.git(&["add", "feature.ts"]);
    repo.git(&["commit", "-m", "add feature"]);

    let item = repo.find("feature.ts").expect("file should appear");
    assert_eq!(
        item.committed_status.as_deref(),
        Some("A"),
        "committed file should have committed A: {item:?}"
    );
    assert!(
        item.staged_status.is_none(),
        "clean committed should NOT have staged_status: {item:?}"
    );
    assert!(
        item.unstaged_status.is_none(),
        "clean committed should NOT have unstaged_status: {item:?}"
    );
}

#[test]
fn classification_both_staged_and_unstaged() {
    let repo = GitRepoHarness::new();

    repo.write_file("mixed.ts", "v1\n");
    repo.git(&["add", "mixed.ts"]);
    repo.git(&["commit", "-m", "add mixed"]);
    repo.write_file("mixed.ts", "v2\n");
    repo.git(&["add", "mixed.ts"]);
    repo.write_file("mixed.ts", "v3\n");

    let item = repo.find("mixed.ts").expect("file should appear");
    assert_eq!(
        item.staged_status.as_deref(),
        Some("M"),
        "should have staged M: {item:?}"
    );
    assert_eq!(
        item.unstaged_status.as_deref(),
        Some("M"),
        "should have unstaged M: {item:?}"
    );
}

#[test]
fn classification_after_commit_changes_clear() {
    let repo = GitRepoHarness::new();

    repo.write_file("done.ts", "done\n");
    repo.git(&["add", "done.ts"]);
    repo.git(&["commit", "-m", "add done"]);

    let item = repo.find("done.ts").expect("file should appear");
    assert!(
        item.committed_status.is_some(),
        "should have committed_status: {item:?}"
    );
    assert!(
        item.staged_status.is_none(),
        "committed file should NOT have staged: {item:?}"
    );
    assert!(
        item.unstaged_status.is_none(),
        "committed file should NOT have unstaged: {item:?}"
    );
}

#[test]
fn classification_no_changes_empty_result() {
    let repo = GitRepoHarness::new();

    let items = repo.changes();
    assert!(
        items.is_empty(),
        "clean branch should have no changes: {items:?}"
    );
}

#[test]
fn classification_discard_removes_from_changes() {
    let repo = GitRepoHarness::new();

    repo.write_file("README.md", "modified\n");
    assert!(
        repo.find("README.md").is_some(),
        "modified file should show"
    );

    repo.git(&["checkout", "--", "README.md"]);
    assert!(
        repo.find("README.md").is_none(),
        "discarded file should NOT show"
    );
}

#[test]
fn git_panel_discovers_submodule_branch_and_inner_changes() {
    let repo = GitRepoHarness::new();
    let submodule_source = tempfile::tempdir().unwrap();

    crate::git_ops::run_git(["init", "-b", "main"], Some(submodule_source.path())).unwrap();
    crate::git_ops::run_git(
        ["config", "user.email", "test@helmor.test"],
        Some(submodule_source.path()),
    )
    .unwrap();
    crate::git_ops::run_git(
        ["config", "user.name", "Test"],
        Some(submodule_source.path()),
    )
    .unwrap();
    fs::create_dir_all(submodule_source.path().join("src")).unwrap();
    fs::write(
        submodule_source.path().join("src/lib.rs"),
        "pub fn v1() {}\n",
    )
    .unwrap();
    crate::git_ops::run_git(["add", "."], Some(submodule_source.path())).unwrap();
    crate::git_ops::run_git(
        ["commit", "-m", "init submodule"],
        Some(submodule_source.path()),
    )
    .unwrap();

    repo.git(&[
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        submodule_source.path().to_str().unwrap(),
        "vendor/lib",
    ]);
    repo.git(&["commit", "-am", "add submodule"]);

    fs::write(
        std::path::Path::new(repo.path_str()).join("vendor/lib/src/lib.rs"),
        "pub fn v2() {}\n",
    )
    .unwrap();

    let panel = list_workspace_git_panel(repo.path_str()).unwrap();
    let submodule = panel
        .contexts
        .iter()
        .find(|context| context.parent_relative_path.as_deref() == Some("vendor/lib"))
        .expect("submodule context should be discovered");

    assert_eq!(submodule.kind, "submodule");
    assert_eq!(submodule.branch.as_deref(), Some("main"));
    // The submodule's remote is a local file:// URL — `parse_github_remote`
    // rejects it, so the change_request lookup must short-circuit to None
    // instead of being conjured from a stale cache entry or a stranger's
    // PR with the same head branch.
    assert!(
        submodule.change_request.is_none(),
        "submodule context should not surface a change_request for a non-github remote: {:?}",
        submodule.change_request
    );
    assert!(
        panel
            .items
            .iter()
            .any(|item| item.path == "vendor/lib/src/lib.rs"
                && item.unstaged_status.as_deref() == Some("M")),
        "inner submodule file change should be represented with parent-relative path: {:?}",
        panel.items
    );
}
