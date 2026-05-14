use std::path::{Path, PathBuf};

use super::*;
use crate::goal_orchestrator::workflow::parse_workflow;

#[test]
fn resolves_defaults_from_empty_workflow() {
    let workflow = parse_workflow("Body").unwrap();
    let cfg = RuntimeConfig::from_workflow(Some(&workflow), Path::new("/tmp/goal")).unwrap();

    assert_eq!(cfg.tracker.kind, TrackerKind::Local);
    assert_eq!(cfg.polling.interval_seconds, 60);
    assert_eq!(cfg.scheduler.max_concurrent, 2);
    assert_eq!(cfg.workspace.root, PathBuf::from("/tmp/goal"));
    assert!(cfg.workspace.finalize);
}

#[test]
fn validates_dispatch_critical_fields() {
    let workflow = parse_workflow("---\nscheduler:\n  maxConcurrent: 0\n---\nBody").unwrap();
    let cfg = RuntimeConfig::from_workflow(Some(&workflow), Path::new("/tmp/goal")).unwrap();

    assert!(cfg
        .validate_for_dispatch()
        .unwrap_err()
        .to_string()
        .contains("maxConcurrent"));
}

#[test]
fn resolves_relative_paths_and_environment_placeholders() {
    std::env::set_var("HELMOR_TEST_WORKFLOW_ROOT", "nested-root");
    let workflow =
        parse_workflow("---\nworkspace:\n  root: ${HELMOR_TEST_WORKFLOW_ROOT}\n---\nBody").unwrap();
    let cfg = RuntimeConfig::from_workflow(Some(&workflow), Path::new("/tmp/goal")).unwrap();

    assert_eq!(cfg.workspace.root, PathBuf::from("/tmp/goal/nested-root"));
}
