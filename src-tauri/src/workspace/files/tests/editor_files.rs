use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use crate::data_dir::TEST_ENV_LOCK as TEST_LOCK;
use crate::error::{extract_code, ErrorCode};
use crate::git_ops;

use super::{
    canonicalize_missing_path, get_file_unified_diff, list_editor_files, list_workspace_files,
    read_editor_file, stat_editor_file, support::EditorFilesHarness, write_editor_file,
};

#[test]
fn read_editor_file_rejects_paths_outside_workspace_roots() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let harness = EditorFilesHarness::new();
    let outside_file = harness.outside_dir.join("not-allowed.ts");
    fs::write(&outside_file, "console.log('x')\n").unwrap();

    let error = read_editor_file(outside_file.to_str().unwrap()).unwrap_err();

    assert!(
        format!("{error:#}").contains("inside a workspace root"),
        "unexpected error: {error:#}"
    );
}

#[test]
fn write_editor_file_replaces_existing_file_contents() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let harness = EditorFilesHarness::new();
    let allowed_file = harness.workspace_dir.join("src").join("App.tsx");
    fs::create_dir_all(allowed_file.parent().unwrap()).unwrap();
    fs::write(&allowed_file, "const before = true;\n").unwrap();

    let response =
        write_editor_file(allowed_file.to_str().unwrap(), "const after = true;\n").unwrap();

    assert_eq!(
        fs::read_to_string(&allowed_file).unwrap(),
        "const after = true;\n"
    );
    assert!(response.mtime_ms > 0);
}

#[test]
fn stat_editor_file_reports_missing_files_inside_workspace_roots() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let harness = EditorFilesHarness::new();
    let missing_file = harness.workspace_dir.join("src").join("missing.ts");

    let response = stat_editor_file(missing_file.to_str().unwrap()).unwrap();

    assert_eq!(
        PathBuf::from(&response.path),
        canonicalize_missing_path(&missing_file).unwrap()
    );
    assert!(!response.exists);
    assert!(!response.is_file);
    assert_eq!(response.mtime_ms, None);
    assert_eq!(response.size, None);
}

#[test]
fn list_editor_files_returns_existing_workspace_files() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let harness = EditorFilesHarness::new();
    let src_dir = harness.workspace_dir.join("src");
    fs::create_dir_all(&src_dir).unwrap();
    let app_file = src_dir.join("App.tsx");
    fs::write(&app_file, "export const app = true;\n").unwrap();
    fs::write(harness.workspace_dir.join("README.md"), "# Demo\n").unwrap();

    let files = list_editor_files(harness.workspace_dir.to_str().unwrap()).unwrap();

    assert!(!files.is_empty());
    let expected_app_file = app_file.canonicalize().unwrap();
    assert!(files
        .iter()
        .any(|file| Path::new(&file.absolute_path) == expected_app_file.as_path()));
    assert!(files
        .iter()
        .all(|file| Path::new(&file.absolute_path).is_file()));
}

#[test]
fn list_editor_files_returns_empty_when_workspace_root_is_missing() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let harness = EditorFilesHarness::new();
    fs::remove_dir_all(&harness.workspace_dir).unwrap();

    let files = list_editor_files(harness.workspace_dir.to_str().unwrap()).unwrap();

    assert!(files.is_empty());
}

#[test]
fn get_file_unified_diff_synthesizes_untracked_text_file() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let harness = EditorFilesHarness::new();
    init_git_repo(&harness.workspace_dir);
    fs::write(
        harness.workspace_dir.join("new-file.ts"),
        "export const added = true;\nexport const second = true;\n",
    )
    .unwrap();

    let diff = get_file_unified_diff(
        harness.workspace_dir.to_str().unwrap(),
        "new-file.ts",
        None,
        None,
        false,
    )
    .unwrap()
    .expect("untracked file should produce a synthetic diff");

    assert!(diff.contains("new file mode 100644"), "{diff}");
    assert!(diff.contains("--- /dev/null"), "{diff}");
    assert!(diff.contains("+++ b/new-file.ts"), "{diff}");
    assert!(diff.contains("+export const added = true;"), "{diff}");
    assert!(diff.contains("+export const second = true;"), "{diff}");
}

#[test]
fn get_file_unified_diff_returns_git_diff_for_staged_new_file() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let harness = EditorFilesHarness::new();
    init_git_repo(&harness.workspace_dir);
    fs::write(
        harness.workspace_dir.join("staged-file.ts"),
        "export const x = 1;\n",
    )
    .unwrap();
    git_ops::run_git(["add", "staged-file.ts"], Some(&harness.workspace_dir)).unwrap();

    let diff = get_file_unified_diff(
        harness.workspace_dir.to_str().unwrap(),
        "staged-file.ts",
        None,
        None,
        true,
    )
    .unwrap()
    .expect("staged added file should produce a git diff");

    assert!(diff.contains("new file mode"), "{diff}");
    assert!(diff.contains("+export const x = 1;"), "{diff}");
}

#[test]
fn read_editor_file_marks_missing_workspace_as_broken() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let harness = EditorFilesHarness::new();
    let file = harness.workspace_dir.join("src").join("App.tsx");
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, "export const app = true;\n").unwrap();
    fs::remove_dir_all(&harness.workspace_dir).unwrap();

    let error = read_editor_file(file.to_str().unwrap()).unwrap_err();

    assert_eq!(extract_code(&error), ErrorCode::WorkspaceBroken);
}

fn init_git_repo(workspace_dir: &Path) {
    git_ops::run_git(["init", "-b", "main"], Some(workspace_dir)).unwrap();
    git_ops::run_git(
        ["config", "user.email", "test@helmor.test"],
        Some(workspace_dir),
    )
    .unwrap();
    git_ops::run_git(["config", "user.name", "Test"], Some(workspace_dir)).unwrap();
    git_ops::run_git(["config", "commit.gpgsign", "false"], Some(workspace_dir)).unwrap();
    fs::write(workspace_dir.join("README.md"), "# Test\n").unwrap();
    git_ops::run_git(["add", "README.md"], Some(workspace_dir)).unwrap();
    git_ops::run_git(["commit", "-m", "init"], Some(workspace_dir)).unwrap();
}

#[test]
fn list_workspace_files_uses_blacklist_filter_for_mention_picker() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let harness = EditorFilesHarness::new();

    let allowed_extras = [
        "deploy.sh",
        "schema.sql",
        "api.proto",
        "service.graphql",
        "main.cpp",
        "header.h",
        "app.lua",
        "site.scss",
        "Dockerfile",
        "Makefile",
        "LICENSE",
        ".gitignore",
        ".editorconfig",
        "diagram.svg",
        "spec.pdf",
    ];
    for name in allowed_extras {
        fs::write(harness.workspace_dir.join(name), b"contents\n").unwrap();
    }

    let github_workflows = harness.workspace_dir.join(".github").join("workflows");
    fs::create_dir_all(&github_workflows).unwrap();
    fs::write(github_workflows.join("ci.yml"), b"name: ci\n").unwrap();
    let vscode_dir = harness.workspace_dir.join(".vscode");
    fs::create_dir_all(&vscode_dir).unwrap();
    fs::write(vscode_dir.join("settings.json"), b"{}\n").unwrap();

    let blacklisted_binaries = [
        "logo.png",
        "song.mp3",
        "clip.mp4",
        "bundle.zip",
        "tool.exe",
        "lib.so",
        "font.woff2",
        "report.docx",
        "data.sqlite3",
        "image.dmg",
    ];
    for name in blacklisted_binaries {
        fs::write(harness.workspace_dir.join(name), b"\x00\x01\x02").unwrap();
    }

    fs::write(harness.workspace_dir.join(".DS_Store"), b"meta").unwrap();

    let node_modules = harness.workspace_dir.join("node_modules").join("react");
    fs::create_dir_all(&node_modules).unwrap();
    fs::write(node_modules.join("index.js"), b"vendor\n").unwrap();
    let git_dir = harness.workspace_dir.join(".git");
    fs::create_dir_all(&git_dir).unwrap();
    fs::write(git_dir.join("HEAD"), b"ref: refs/heads/main\n").unwrap();

    let files = list_workspace_files(harness.workspace_dir.to_str().unwrap()).unwrap();
    let result_paths: HashSet<String> = files.iter().map(|file| file.path.clone()).collect();

    for name in allowed_extras {
        assert!(
            result_paths.contains(name),
            "expected blacklist-allowed file {name} to appear, got {result_paths:?}",
        );
    }
    assert!(
        result_paths.contains(".github/workflows/ci.yml"),
        "expected .github/workflows/ci.yml in result, got {result_paths:?}",
    );
    assert!(
        result_paths.contains(".vscode/settings.json"),
        "expected .vscode/settings.json in result, got {result_paths:?}",
    );

    for name in blacklisted_binaries {
        assert!(
            !result_paths.contains(name),
            "binary {name} should be excluded by the blacklist",
        );
    }
    assert!(
        !result_paths.contains(".DS_Store"),
        "OS metadata .DS_Store should be excluded",
    );

    for path in &result_paths {
        assert!(
            !path.contains("node_modules"),
            "node_modules leaked: {path}"
        );
        assert!(!path.starts_with(".git/"), "git dir leaked: {path}");
    }
}

#[test]
fn list_workspace_files_returns_all_files_without_24_cap_and_skips_excluded_dirs() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let harness = EditorFilesHarness::new();

    let src_dir = harness.workspace_dir.join("src");
    fs::create_dir_all(&src_dir).unwrap();
    for index in 0..15 {
        fs::write(
            src_dir.join(format!("file_{index:02}.ts")),
            "export const x = true;\n",
        )
        .unwrap();
    }
    let nested_dir = src_dir.join("components").join("widgets");
    fs::create_dir_all(&nested_dir).unwrap();
    for index in 0..15 {
        fs::write(
            nested_dir.join(format!("widget_{index:02}.tsx")),
            "export const w = true;\n",
        )
        .unwrap();
    }

    let node_modules = harness.workspace_dir.join("node_modules").join("react");
    fs::create_dir_all(&node_modules).unwrap();
    fs::write(node_modules.join("index.js"), "/* vendor */\n").unwrap();
    let git_dir = harness.workspace_dir.join(".git");
    fs::create_dir_all(&git_dir).unwrap();
    fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    let dist_dir = harness.workspace_dir.join("dist");
    fs::create_dir_all(&dist_dir).unwrap();
    fs::write(dist_dir.join("bundle.js"), "/* built */\n").unwrap();

    fs::write(harness.workspace_dir.join("logo.png"), b"\x89PNG").unwrap();

    let files = list_workspace_files(harness.workspace_dir.to_str().unwrap()).unwrap();

    assert_eq!(
        files.len(),
        30,
        "expected all 30 source files, got {} (paths: {:?})",
        files.len(),
        files.iter().map(|file| &file.path).collect::<Vec<_>>()
    );

    for file in &files {
        assert!(
            !file.path.contains("node_modules"),
            "node_modules leaked: {}",
            file.path
        );
        assert!(
            !file.path.starts_with(".git"),
            "git dir leaked: {}",
            file.path
        );
        assert!(
            !file.path.starts_with("dist/"),
            "dist leaked: {}",
            file.path
        );
        assert!(!file.path.ends_with(".png"), "binary leaked: {}", file.path);
    }

    let nested_match = files
        .iter()
        .find(|file| file.path == "src/components/widgets/widget_00.tsx")
        .expect("expected nested widget in result");
    assert!(Path::new(&nested_match.absolute_path).is_file());
    assert_eq!(nested_match.name, "widget_00.tsx");
}
