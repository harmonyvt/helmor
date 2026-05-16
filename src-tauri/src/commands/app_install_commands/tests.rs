use super::runner::CommandCapture;
use super::*;

#[test]
fn finds_repo_root_from_nested_path() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("repo");
    std::fs::create_dir_all(root.join("src-tauri/target/debug")).unwrap();
    std::fs::write(root.join("package.json"), "{}").unwrap();
    std::fs::write(root.join("src-tauri/tauri.conf.json"), "{}").unwrap();

    let nested = root.join("src-tauri/target/debug");
    assert_eq!(
        find_repo_root_from(&nested).as_deref(),
        Some(root.as_path())
    );
}

#[test]
fn rejects_directory_without_tauri_config() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("package.json"), "{}").unwrap();

    assert!(!is_helmor_repo_root(temp.path()));
}

#[test]
fn accepts_fresh_bundle_after_signing_failure() {
    let temp = tempfile::tempdir().unwrap();
    let app = temp.path().join("Helmor.app");
    let executable = app.join("Contents/MacOS/helmor");
    std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
    std::fs::write(&executable, "").unwrap();

    let capture = CommandCapture {
        success: false,
        status_code: Some(1),
        stderr: "TAURI_SIGNING_PRIVATE_KEY is not set".to_string(),
        ..CommandCapture::default()
    };

    let warning = validate_build_result(&capture, &app, &executable, 0).unwrap();
    assert!(warning.unwrap().contains("updater signing"));
}

#[test]
fn rejects_failed_build_without_bundle() {
    let temp = tempfile::tempdir().unwrap();
    let app = temp.path().join("Helmor.app");
    let executable = app.join("Contents/MacOS/helmor");
    let capture = CommandCapture {
        success: false,
        status_code: Some(1),
        stderr: "build failed".to_string(),
        ..CommandCapture::default()
    };

    assert!(validate_build_result(&capture, &app, &executable, 0).is_err());
}

#[test]
fn manager_rejects_concurrent_runs_and_allows_after_finish() {
    let manager = AppInstallManager::new();
    let state = manager.begin().unwrap();
    assert!(manager.begin().is_err());
    manager.finish(&state);
    assert!(manager.begin().is_ok());
}

#[test]
fn cancel_marks_active_run() {
    let manager = AppInstallManager::new();
    let state = manager.begin().unwrap();
    assert!(manager.cancel());
    assert!(state.check_cancelled().is_err());
}

#[test]
fn parse_git_count_accepts_trimmed_count() {
    assert_eq!(parse_git_count("12\n"), Some(12));
}

#[test]
fn non_empty_trimmed_rejects_blank_output() {
    assert_eq!(non_empty_trimmed(" \n\t".to_string()), None);
    assert_eq!(
        non_empty_trimmed("origin/main\n".to_string()).as_deref(),
        Some("origin/main")
    );
}
