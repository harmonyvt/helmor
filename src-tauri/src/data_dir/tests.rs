use super::*;

#[test]
fn db_filename_is_helmor_db() {
    assert_eq!(DB_FILENAME, "helmor.db");
}

#[test]
fn is_dev_returns_true_in_debug() {
    assert!(is_dev());
}

#[test]
fn data_mode_label_returns_development_in_debug() {
    assert_eq!(data_mode_label(), "development");
}

#[test]
fn default_data_dir_name_returns_dev_directory_in_debug() {
    assert_eq!(default_data_dir_name(), "helmor-dev");
}

#[test]
fn data_dir_preference_round_trips_outside_data_dir() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let old_home = std::env::var_os("HOME");
    let old_override = std::env::var_os("HELMOR_DATA_DIR");
    std::env::set_var("HOME", temp.path());
    std::env::remove_var("HELMOR_DATA_DIR");

    set_data_dir_preference(DataDirPreference::Development).unwrap();
    assert_eq!(data_dir_preference(), DataDirPreference::Development);

    match old_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    match old_override {
        Some(value) => std::env::set_var("HELMOR_DATA_DIR", value),
        None => std::env::remove_var("HELMOR_DATA_DIR"),
    }
}

#[test]
fn resolve_data_dir_honors_production_preference() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let old_home = std::env::var_os("HOME");
    let old_override = std::env::var_os("HELMOR_DATA_DIR");
    std::env::set_var("HOME", temp.path());
    std::env::remove_var("HELMOR_DATA_DIR");

    set_data_dir_preference(DataDirPreference::Production).unwrap();
    assert_eq!(
        resolve_data_dir_uncached().unwrap(),
        temp.path().join("helmor")
    );
    assert_eq!(data_mode_label(), "production");

    match old_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    match old_override {
        Some(value) => std::env::set_var("HELMOR_DATA_DIR", value),
        None => std::env::remove_var("HELMOR_DATA_DIR"),
    }
}

#[test]
fn conductor_source_db_path_returns_option() {
    let _ = conductor_source_db_path();
}

#[test]
fn dirs_home_returns_some() {
    assert!(dirs_home().is_some());
}
