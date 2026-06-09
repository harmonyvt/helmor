//! Import Orca-managed workspaces into Helmor without moving the worktrees.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::{
    db, git_ops,
    models::repos::{self as repo_models, RepositoryRecord},
    workspace_status::WorkspaceStatus,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrcaRepo {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub workspace_count: i64,
    pub already_imported_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrcaWorkspace {
    pub id: String,
    pub directory_name: String,
    pub title: Option<String>,
    pub branch: Option<String>,
    pub status: Option<String>,
    pub absolute_path: String,
    pub already_imported: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOrcaWorkspacesResult {
    pub success: bool,
    pub imported_count: i64,
    pub skipped_count: i64,
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrcaData {
    #[serde(default)]
    repos: Vec<OrcaDataRepo>,
    #[serde(default)]
    worktree_meta: HashMap<String, OrcaWorktreeMeta>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrcaDataRepo {
    id: String,
    path: String,
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrcaWorktreeMeta {
    instance_id: String,
    display_name: Option<String>,
    is_archived: Option<bool>,
    workspace_status: Option<String>,
    orca_creation_workspace_layout: Option<OrcaWorkspaceLayout>,
}

#[derive(Debug, Deserialize)]
struct OrcaWorkspaceLayout {
    path: String,
}

#[derive(Debug, Clone)]
struct OrcaCandidate {
    import_id: String,
    repo_id: String,
    repo_name: String,
    repo_root: PathBuf,
    directory_name: String,
    title: Option<String>,
    status: Option<String>,
    workspace_path: PathBuf,
}

pub fn orca_source_available() -> bool {
    orca_data_path().is_some_and(|path| path.is_file())
}

pub fn list_orca_repos() -> Result<Vec<OrcaRepo>> {
    let candidates = load_orca_candidates()?;
    let imported = imported_orca_workspace_ids()?;
    let mut grouped: HashMap<String, OrcaRepo> = HashMap::new();

    for candidate in candidates {
        let entry = grouped
            .entry(candidate.repo_id.clone())
            .or_insert(OrcaRepo {
                id: candidate.repo_id.clone(),
                name: candidate.repo_name.clone(),
                root_path: candidate.repo_root.display().to_string(),
                workspace_count: 0,
                already_imported_count: 0,
            });
        entry.workspace_count += 1;
        if imported.contains(&candidate.import_id) {
            entry.already_imported_count += 1;
        }
    }

    let mut repos = grouped.into_values().collect::<Vec<_>>();
    repos.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(repos)
}

pub fn list_orca_workspaces(repo_id: &str) -> Result<Vec<OrcaWorkspace>> {
    let imported = imported_orca_workspace_ids()?;
    let mut workspaces = load_orca_candidates()?
        .into_iter()
        .filter(|candidate| candidate.repo_id == repo_id)
        .map(|candidate| {
            let branch = git_ops::current_branch_name(&candidate.workspace_path).ok();
            OrcaWorkspace {
                id: candidate.import_id.clone(),
                directory_name: candidate.directory_name,
                title: candidate.title,
                branch,
                status: candidate.status,
                absolute_path: candidate.workspace_path.display().to_string(),
                already_imported: imported.contains(&candidate.import_id),
            }
        })
        .collect::<Vec<_>>();

    workspaces.sort_by(|left, right| {
        left.title
            .as_deref()
            .unwrap_or(&left.directory_name)
            .to_lowercase()
            .cmp(
                &right
                    .title
                    .as_deref()
                    .unwrap_or(&right.directory_name)
                    .to_lowercase(),
            )
    });
    Ok(workspaces)
}

pub fn import_orca_workspaces(workspace_ids: &[String]) -> Result<ImportOrcaWorkspacesResult> {
    if workspace_ids.is_empty() {
        return Ok(ImportOrcaWorkspacesResult {
            success: true,
            imported_count: 0,
            skipped_count: 0,
            errors: Vec::new(),
        });
    }

    let selected = workspace_ids.iter().cloned().collect::<HashSet<_>>();
    let candidates = load_orca_candidates()?
        .into_iter()
        .filter(|candidate| selected.contains(&candidate.import_id))
        .map(|candidate| (candidate.import_id.clone(), candidate))
        .collect::<HashMap<_, _>>();

    let mut imported_count = 0;
    let mut skipped_count = 0;
    let mut errors = Vec::new();

    for workspace_id in workspace_ids {
        let Some(candidate) = candidates.get(workspace_id) else {
            errors.push(format!("{workspace_id}: Orca workspace not found"));
            continue;
        };

        match import_orca_workspace(candidate) {
            Ok(ImportOneOutcome::Imported) => imported_count += 1,
            Ok(ImportOneOutcome::Skipped) => skipped_count += 1,
            Err(error) => errors.push(format!("{workspace_id}: {error:#}")),
        }
    }

    Ok(ImportOrcaWorkspacesResult {
        success: errors.is_empty(),
        imported_count,
        skipped_count,
        errors,
    })
}

enum ImportOneOutcome {
    Imported,
    Skipped,
}

fn import_orca_workspace(candidate: &OrcaCandidate) -> Result<ImportOneOutcome> {
    if workspace_exists(&candidate.import_id)? {
        return Ok(ImportOneOutcome::Skipped);
    }

    if !candidate.workspace_path.is_dir() {
        bail!(
            "Orca workspace directory is missing: {}",
            candidate.workspace_path.display()
        );
    }

    let repository = ensure_repository(candidate)?;
    let branch = git_ops::current_branch_name(&candidate.workspace_path).ok();
    let initial_head_sha = git_ops::current_workspace_head_commit(&candidate.workspace_path).ok();
    let status = candidate
        .status
        .as_deref()
        .and_then(|value| value.parse::<WorkspaceStatus>().ok())
        .unwrap_or(WorkspaceStatus::InProgress)
        .as_str()
        .to_string();
    let pr_title = candidate
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let link_path = crate::data_dir::workspace_dir(&repository.name, &candidate.directory_name)?;
    ensure_workspace_link(&candidate.workspace_path, &link_path)?;

    let insert_result = block_on_orca_db(db::libsql_write_async(|connection| {
        let import_id = candidate.import_id.clone();
        let repository_id = repository.id.clone();
        let directory_name = candidate.directory_name.clone();
        let branch = branch.clone();
        let status = status.clone();
        let pr_title = pr_title.clone();
        let initial_head_sha = initial_head_sha.clone();
        async move {
            connection
                .execute(
                    r#"
                    INSERT INTO workspaces (
                        id,
                        repository_id,
                        directory_name,
                        state,
                        status,
                        branch,
                        pr_title,
                        initial_head_sha,
                        last_known_head_sha,
                        created_at,
                        updated_at
                    ) VALUES (?1, ?2, ?3, 'ready', ?4, ?5, ?6, ?7, ?7, datetime('now'), datetime('now'))
                    "#,
                    libsql::params![
                        import_id,
                        repository_id,
                        directory_name,
                        status,
                        branch,
                        pr_title,
                        initial_head_sha,
                    ],
                )
                .await
                .context("Failed to insert imported Orca workspace")?;
            Ok(())
        }
    }));

    if let Err(error) = insert_result {
        cleanup_created_link(&link_path, &candidate.workspace_path);
        return Err(error);
    }

    Ok(ImportOneOutcome::Imported)
}

fn ensure_repository(candidate: &OrcaCandidate) -> Result<RepositoryRecord> {
    if let Some(repository) =
        repo_models::load_repository_by_root_path(&candidate.repo_root.display().to_string())?
    {
        return Ok(repository);
    }

    let resolved =
        repo_models::resolve_repository_from_local_path(&candidate.repo_root.display().to_string())
            .with_context(|| {
                format!(
                    "Failed to resolve repository {}",
                    candidate.repo_root.display()
                )
            })?;
    let repo_id = repo_models::insert_repository(&resolved)?;
    repo_models::load_repository_by_id(&repo_id)?
        .with_context(|| format!("Inserted repository {repo_id} could not be loaded"))
}

fn ensure_workspace_link(target: &Path, link_path: &Path) -> Result<()> {
    if let Some(parent) = link_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create {}", parent.display()))?;
    }

    if link_path.exists() {
        let existing = link_path
            .canonicalize()
            .with_context(|| format!("Failed to resolve {}", link_path.display()))?;
        let target = target
            .canonicalize()
            .with_context(|| format!("Failed to resolve {}", target.display()))?;
        if existing == target {
            return Ok(());
        }
        bail!(
            "Helmor workspace path already exists and points elsewhere: {}",
            link_path.display()
        );
    }

    create_dir_symlink(target, link_path).with_context(|| {
        format!(
            "Failed to link {} to {}",
            link_path.display(),
            target.display()
        )
    })
}

#[cfg(unix)]
fn create_dir_symlink(target: &Path, link_path: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link_path)
}

#[cfg(windows)]
fn create_dir_symlink(target: &Path, link_path: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link_path)
}

fn cleanup_created_link(link_path: &Path, target: &Path) {
    let Ok(existing_target) = link_path.canonicalize() else {
        return;
    };
    let Ok(target) = target.canonicalize() else {
        return;
    };
    if existing_target == target {
        let _ = fs::remove_file(link_path);
    }
}

fn workspace_exists(workspace_id: &str) -> Result<bool> {
    let workspace_id = workspace_id.to_string();
    block_on_orca_db(async move {
        let connection = db::libsql_conn_async().await?;
        let mut rows = connection
            .query(
                "SELECT 1 FROM workspaces WHERE id = ?1 LIMIT 1",
                [workspace_id],
            )
            .await
            .context("Failed to query imported Orca workspace")?;
        Ok(rows.next().await?.is_some())
    })
}

fn imported_orca_workspace_ids() -> Result<HashSet<String>> {
    block_on_orca_db(async {
        let connection = db::libsql_conn_async().await?;
        let mut rows = connection
            .query("SELECT id FROM workspaces WHERE id LIKE 'orca-%'", ())
            .await
            .context("Failed to query imported Orca workspaces")?;
        let mut ids = HashSet::new();
        while let Some(row) = rows.next().await? {
            ids.insert(row.get::<String>(0)?);
        }
        Ok(ids)
    })
}

fn load_orca_candidates() -> Result<Vec<OrcaCandidate>> {
    let data_path = orca_data_path().context("Orca data file not found")?;
    let raw = fs::read_to_string(&data_path)
        .with_context(|| format!("Failed to read {}", data_path.display()))?;
    let data: OrcaData = serde_json::from_str(&raw).context("Failed to parse Orca data")?;
    let repos_by_id = data
        .repos
        .into_iter()
        .map(|repo| (repo.id.clone(), repo))
        .collect::<HashMap<_, _>>();
    let default_orca_root = default_orca_workspace_root();
    let mut candidates = Vec::new();

    for (key, meta) in data.worktree_meta {
        if meta.is_archived.unwrap_or(false) {
            continue;
        }
        let Some((repo_id, workspace_path)) = parse_worktree_key(&key) else {
            continue;
        };
        let Some(repo) = repos_by_id.get(repo_id) else {
            continue;
        };
        if !is_orca_created_workspace(
            &workspace_path,
            meta.orca_creation_workspace_layout.as_ref(),
            &default_orca_root,
        ) {
            continue;
        }
        if !workspace_path.is_dir() {
            continue;
        }
        let Some(directory_name) = workspace_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(ToOwned::to_owned)
        else {
            continue;
        };
        let repo_name = repo
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                Path::new(&repo.path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&repo.path)
            })
            .to_string();

        candidates.push(OrcaCandidate {
            import_id: format!("orca-{}", meta.instance_id),
            repo_id: repo_id.to_string(),
            repo_name,
            repo_root: PathBuf::from(&repo.path),
            directory_name,
            title: meta.display_name.filter(|value| !value.trim().is_empty()),
            status: meta.workspace_status,
            workspace_path,
        });
    }

    candidates.sort_by(|left, right| {
        left.repo_name
            .to_lowercase()
            .cmp(&right.repo_name.to_lowercase())
            .then_with(|| left.directory_name.cmp(&right.directory_name))
    });
    Ok(candidates)
}

fn parse_worktree_key(key: &str) -> Option<(&str, PathBuf)> {
    let (repo_id, path) = key.split_once("::")?;
    if repo_id.trim().is_empty() || path.trim().is_empty() {
        return None;
    }
    Some((repo_id, PathBuf::from(path)))
}

fn is_orca_created_workspace(
    workspace_path: &Path,
    layout: Option<&OrcaWorkspaceLayout>,
    default_orca_root: &Path,
) -> bool {
    if let Some(layout) = layout {
        return workspace_path.starts_with(Path::new(&layout.path));
    }
    workspace_path.starts_with(default_orca_root)
}

fn orca_data_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("HELMOR_ORCA_DATA_PATH").map(PathBuf::from) {
        return Some(path);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    Some(
        home.join("Library")
            .join("Application Support")
            .join("orca")
            .join("orca-data.json"),
    )
}

fn default_orca_workspace_root() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
        .join("orca")
        .join("workspaces")
}

fn block_on_orca_db<T>(future: impl std::future::Future<Output = Result<T>>) -> Result<T> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => tokio::task::block_in_place(|| handle.block_on(future)),
        Err(_) => tauri::async_runtime::block_on(future),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{is_orca_created_workspace, parse_worktree_key, OrcaWorkspaceLayout};

    #[test]
    fn parses_orca_worktree_keys() {
        let (repo_id, path) = parse_worktree_key("repo-1::/tmp/orca/workspaces/repo/ws").unwrap();
        assert_eq!(repo_id, "repo-1");
        assert_eq!(path, Path::new("/tmp/orca/workspaces/repo/ws"));
    }

    #[test]
    fn identifies_orca_created_workspaces_by_layout() {
        let layout = OrcaWorkspaceLayout {
            path: "/Users/me/orca/workspaces".to_string(),
        };

        assert!(is_orca_created_workspace(
            Path::new("/Users/me/orca/workspaces/repo/ws"),
            Some(&layout),
            Path::new("/fallback"),
        ));
        assert!(!is_orca_created_workspace(
            Path::new("/Users/me/.claude/worktrees/ws"),
            Some(&layout),
            Path::new("/fallback"),
        ));
    }
}
