use std::fs;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::workspaces;

const DATA_DIRECTORY_ROOT: &str = "workspace-browser";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileOptions {
    pub workspace_id: String,
    pub data_directory: String,
    pub data_store_identifier: Vec<u8>,
}

pub fn get_workspace_browser_profile(workspace_id: &str) -> Result<BrowserProfileOptions> {
    ensure_workspace_exists(workspace_id)?;
    profile_options_for_workspace_id(workspace_id)
}

pub fn profile_options_for_workspace_id(workspace_id: &str) -> Result<BrowserProfileOptions> {
    let uuid = parse_workspace_uuid(workspace_id)?;
    Ok(BrowserProfileOptions {
        workspace_id: workspace_id.to_string(),
        data_directory: format!("{DATA_DIRECTORY_ROOT}/{workspace_id}"),
        data_store_identifier: uuid.as_bytes().to_vec(),
    })
}

pub fn workspace_browser_profile_dir(workspace_id: &str) -> Result<PathBuf> {
    parse_workspace_uuid(workspace_id)?;
    Ok(crate::data_dir::browser_profiles_dir()?.join(workspace_id))
}

pub fn remove_workspace_browser_profile_files(workspace_id: &str) -> Result<()> {
    let profile_dir = workspace_browser_profile_dir(workspace_id)?;
    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir).with_context(|| {
            format!(
                "Failed to remove browser profile directory {}",
                profile_dir.display()
            )
        })?;
    }
    Ok(())
}

pub fn workspace_data_store_identifier(workspace_id: &str) -> Result<[u8; 16]> {
    Ok(*parse_workspace_uuid(workspace_id)?.as_bytes())
}

fn ensure_workspace_exists(workspace_id: &str) -> Result<()> {
    if workspaces::load_workspace_record_by_id(workspace_id)?.is_none() {
        bail!("Workspace not found: {workspace_id}");
    }
    Ok(())
}

fn parse_workspace_uuid(workspace_id: &str) -> Result<Uuid> {
    Uuid::parse_str(workspace_id)
        .with_context(|| format!("Workspace id is not a UUID: {workspace_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::{insert_repo, insert_workspace, TestEnv, WorkspaceFixture};

    #[test]
    fn profile_options_are_deterministic_per_workspace_uuid() {
        let workspace_id = "11111111-1111-4111-8111-111111111111";
        let first = profile_options_for_workspace_id(workspace_id).unwrap();
        let second = profile_options_for_workspace_id(workspace_id).unwrap();

        assert_eq!(first, second);
        assert_eq!(first.workspace_id, workspace_id);
        assert_eq!(
            first.data_directory,
            format!("workspace-browser/{workspace_id}")
        );
        assert_eq!(first.data_store_identifier.len(), 16);
        assert_eq!(
            first.data_store_identifier,
            Uuid::parse_str(workspace_id).unwrap().as_bytes().to_vec()
        );
    }

    #[test]
    fn profile_options_differ_between_workspaces() {
        let first =
            profile_options_for_workspace_id("11111111-1111-4111-8111-111111111111").unwrap();
        let second =
            profile_options_for_workspace_id("22222222-2222-4222-8222-222222222222").unwrap();

        assert_ne!(first.data_directory, second.data_directory);
        assert_ne!(first.data_store_identifier, second.data_store_identifier);
    }

    #[test]
    fn profile_lookup_rejects_missing_workspace() {
        let _env = TestEnv::new("browser-profile-missing-workspace");
        let error =
            get_workspace_browser_profile("11111111-1111-4111-8111-111111111111").unwrap_err();

        assert!(error.to_string().contains("Workspace not found"));
    }

    #[test]
    fn profile_lookup_requires_uuid_workspace_id() {
        let error = profile_options_for_workspace_id("workspace-1").unwrap_err();

        assert!(error.to_string().contains("Workspace id is not a UUID"));
    }

    #[test]
    fn profile_lookup_returns_existing_workspace_profile() {
        let env = TestEnv::new("browser-profile-existing-workspace");
        let connection = env.db_connection();
        let workspace_id = "11111111-1111-4111-8111-111111111111";
        insert_repo(&connection, "repo-1", "repo", None);
        insert_workspace(
            &connection,
            &WorkspaceFixture {
                id: workspace_id,
                repo_id: "repo-1",
                directory_name: "work",
                state: "ready",
                branch: Some("main"),
                intended_target_branch: None,
            },
        );

        let profile = get_workspace_browser_profile(workspace_id).unwrap();

        assert_eq!(profile.workspace_id, workspace_id);
        assert_eq!(profile.data_store_identifier.len(), 16);
    }
}
