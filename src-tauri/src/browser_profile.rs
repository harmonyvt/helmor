use std::fs;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::browser_tabs;
use crate::models::workspaces;

const DATA_DIRECTORY_ROOT: &str = "workspace-browser";
const PROJECT_DIRECTORY_ROOT: &str = "projects";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileOptions {
    pub workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
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
        tab_id: None,
        data_directory: format!("{DATA_DIRECTORY_ROOT}/{workspace_id}"),
        data_store_identifier: uuid.as_bytes().to_vec(),
    })
}

pub fn get_browser_tab_profile(tab_id: &str) -> Result<BrowserProfileOptions> {
    let tab = browser_tabs::get_browser_tab(tab_id)?
        .with_context(|| format!("Browser tab not found: {tab_id}"))?;
    let workspace = workspaces::load_workspace_record_by_id(&tab.workspace_id)?
        .with_context(|| format!("Workspace not found: {}", tab.workspace_id))?;
    profile_options_for_tab_id(&tab.workspace_id, &workspace.repo_id, &tab.id)
}

pub fn profile_options_for_tab_id(
    workspace_id: &str,
    repository_id: &str,
    tab_id: &str,
) -> Result<BrowserProfileOptions> {
    parse_workspace_uuid(workspace_id)?;
    parse_tab_uuid(tab_id)?;
    Ok(BrowserProfileOptions {
        workspace_id: workspace_id.to_string(),
        tab_id: Some(tab_id.to_string()),
        data_directory: project_browser_data_directory(repository_id),
        data_store_identifier: project_data_store_identifier(repository_id).to_vec(),
    })
}

pub fn workspace_browser_profile_dir(workspace_id: &str) -> Result<PathBuf> {
    parse_workspace_uuid(workspace_id)?;
    Ok(crate::data_dir::browser_profiles_dir()?
        .join(DATA_DIRECTORY_ROOT)
        .join(workspace_id))
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

pub fn remove_browser_tab_profile_files(workspace_id: &str, tab_id: &str) -> Result<()> {
    let profile_dir = browser_tab_profile_dir(workspace_id, tab_id)?;
    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir).with_context(|| {
            format!(
                "Failed to remove browser tab profile directory {}",
                profile_dir.display()
            )
        })?;
    }
    Ok(())
}

pub fn workspace_data_store_identifier(workspace_id: &str) -> Result<[u8; 16]> {
    Ok(*parse_workspace_uuid(workspace_id)?.as_bytes())
}

pub fn browser_tab_data_store_identifier(tab_id: &str) -> Result<[u8; 16]> {
    Ok(*parse_tab_uuid(tab_id)?.as_bytes())
}

pub fn project_data_store_identifier(repository_id: &str) -> [u8; 16] {
    Uuid::parse_str(repository_id)
        .map(|uuid| *uuid.as_bytes())
        .unwrap_or_else(|_| stable_identifier_bytes("repository", repository_id))
}

pub fn project_browser_profile_dir(repository_id: &str) -> Result<PathBuf> {
    Ok(crate::data_dir::browser_profiles_dir()?
        .join(DATA_DIRECTORY_ROOT)
        .join(PROJECT_DIRECTORY_ROOT)
        .join(repository_id))
}

pub fn remove_project_browser_profile_files(repository_id: &str) -> Result<()> {
    let profile_dir = project_browser_profile_dir(repository_id)?;
    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir).with_context(|| {
            format!(
                "Failed to remove project browser profile directory {}",
                profile_dir.display()
            )
        })?;
    }
    Ok(())
}

fn project_browser_data_directory(repository_id: &str) -> String {
    format!("{DATA_DIRECTORY_ROOT}/{PROJECT_DIRECTORY_ROOT}/{repository_id}")
}

fn stable_identifier_bytes(namespace: &str, value: &str) -> [u8; 16] {
    let first = fnv1a64(namespace.as_bytes(), value.as_bytes(), 0xcbf29ce484222325);
    let second = fnv1a64(namespace.as_bytes(), value.as_bytes(), 0x84222325cbf29ce4);
    let mut bytes = [0u8; 16];
    bytes[..8].copy_from_slice(&first.to_be_bytes());
    bytes[8..].copy_from_slice(&second.to_be_bytes());
    bytes
}

fn fnv1a64(namespace: &[u8], value: &[u8], seed: u64) -> u64 {
    const FNV_PRIME: u64 = 0x00000100000001b3;
    let mut hash = seed;
    for byte in namespace.iter().chain([0].iter()).chain(value.iter()) {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

fn browser_tab_profile_dir(workspace_id: &str, tab_id: &str) -> Result<PathBuf> {
    parse_workspace_uuid(workspace_id)?;
    parse_tab_uuid(tab_id)?;
    Ok(crate::data_dir::browser_profiles_dir()?
        .join(DATA_DIRECTORY_ROOT)
        .join(workspace_id)
        .join(tab_id))
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

fn parse_tab_uuid(tab_id: &str) -> Result<Uuid> {
    Uuid::parse_str(tab_id).with_context(|| format!("Browser tab id is not a UUID: {tab_id}"))
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
        assert_eq!(first.tab_id, None);
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
    fn tab_profile_options_share_project_login_state() {
        let workspace_id = "11111111-1111-4111-8111-111111111111";
        let repository_id = "44444444-4444-4444-8444-444444444444";
        let first_tab_id = "22222222-2222-4222-8222-222222222222";
        let second_tab_id = "33333333-3333-4333-8333-333333333333";

        let first = profile_options_for_tab_id(workspace_id, repository_id, first_tab_id).unwrap();
        let second =
            profile_options_for_tab_id(workspace_id, repository_id, second_tab_id).unwrap();

        assert_eq!(first.workspace_id, workspace_id);
        assert_eq!(first.tab_id.as_deref(), Some(first_tab_id));
        assert_eq!(
            first.data_directory,
            format!("workspace-browser/projects/{repository_id}")
        );
        assert_eq!(first.data_directory, second.data_directory);
        assert_eq!(first.data_store_identifier, second.data_store_identifier);
        assert_eq!(
            first.data_store_identifier,
            Uuid::parse_str(repository_id).unwrap().as_bytes().to_vec()
        );
    }

    #[test]
    fn project_identifiers_are_stable_for_non_uuid_repository_ids() {
        let first = project_data_store_identifier("repo-1");
        let second = project_data_store_identifier("repo-1");
        let other = project_data_store_identifier("repo-2");

        assert_eq!(first, second);
        assert_ne!(first, other);
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
        assert_eq!(profile.tab_id, None);
        assert_eq!(profile.data_store_identifier.len(), 16);
    }

    #[test]
    fn tab_profile_lookup_returns_existing_tab_profile() {
        let env = TestEnv::new("browser-profile-existing-tab");
        let connection = env.db_connection();
        let workspace_id = "11111111-1111-4111-8111-111111111111";
        let tab_id = "22222222-2222-4222-8222-222222222222";
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
        connection
            .execute(
                "INSERT INTO workspace_browser_tabs (id, workspace_id, url, active) VALUES (?1, ?2, 'https://example.com/', 1)",
                [tab_id, workspace_id],
            )
            .unwrap();

        let profile = get_browser_tab_profile(tab_id).unwrap();

        assert_eq!(profile.workspace_id, workspace_id);
        assert_eq!(profile.tab_id.as_deref(), Some(tab_id));
        assert_eq!(profile.data_store_identifier.len(), 16);
        assert_eq!(profile.data_directory, "workspace-browser/projects/repo-1");
    }
}
