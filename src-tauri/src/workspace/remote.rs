use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::{
    error::{coded, ErrorCode},
    git_ops::{WorkspaceGitActionStatus, WorkspacePushStatus, WorkspaceSyncStatus},
    models::workspaces::WorkspaceRecord,
    repos,
    workspace::files::{
        EditorFileListItem, EditorFilePrefetchItem, EditorFileReadResponse, EditorFileStatResponse,
        EditorFileWriteResponse, EditorFilesWithContentResponse,
    },
    workspace_state::WorkspaceState,
};

const MAX_PREFETCH_BYTES: usize = 1_048_576;
const REMOTE_URI_PREFIX: &str = "helmor-remote://";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RemoteWorkspaceBackend {
    Docker,
    Ssh,
}

impl RemoteWorkspaceBackend {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Docker => "docker",
            Self::Ssh => "ssh",
        }
    }

    pub fn from_db(value: Option<&str>) -> Option<Self> {
        match value {
            Some("docker") => Some(Self::Docker),
            Some("ssh") => Some(Self::Ssh),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWorkspaceProfile {
    pub id: String,
    pub name: String,
    pub backend: RemoteWorkspaceBackend,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub docker_image: Option<String>,
    #[serde(default)]
    pub remote_root: Option<String>,
    #[serde(default)]
    pub bootstrap_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWorkspaceCreateOptions {
    pub profile: RemoteWorkspaceProfile,
    #[serde(default)]
    pub copy_pi_config: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRuntimeInfo {
    pub backend: RemoteWorkspaceBackend,
    pub profile_id: Option<String>,
    pub profile_name: Option<String>,
    pub remote_root_path: Option<String>,
    pub container_name: Option<String>,
    pub host: Option<String>,
    pub status: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSidecarExecution {
    pub backend: RemoteWorkspaceBackend,
    pub cwd: String,
    pub container_name: Option<String>,
    pub host: Option<String>,
}

pub fn remote_uri(workspace_id: &str) -> String {
    format!("{REMOTE_URI_PREFIX}{workspace_id}")
}

pub fn remote_file_uri(workspace_id: &str, relative_path: &str) -> String {
    let clean = relative_path.trim_start_matches('/');
    format!("{}{workspace_id}/{clean}", REMOTE_URI_PREFIX)
}

pub fn parse_remote_uri(value: &str) -> Option<(String, Option<String>)> {
    let rest = value.strip_prefix(REMOTE_URI_PREFIX)?;
    let (workspace_id, path) = rest.split_once('/').unwrap_or((rest, ""));
    if workspace_id.trim().is_empty() {
        return None;
    }
    let path = if path.trim().is_empty() {
        None
    } else {
        Some(path.to_string())
    };
    Some((workspace_id.to_string(), path))
}

pub fn is_remote_record(record: &WorkspaceRecord) -> bool {
    record.location_kind.as_deref() == Some("remote")
}

pub fn runtime_for_record(record: &WorkspaceRecord) -> Option<RemoteRuntimeInfo> {
    if !is_remote_record(record) {
        return None;
    }
    Some(RemoteRuntimeInfo {
        backend: RemoteWorkspaceBackend::from_db(record.remote_backend.as_deref())?,
        profile_id: record.remote_profile_id.clone(),
        profile_name: None,
        remote_root_path: record.remote_root_path.clone(),
        container_name: record.remote_container_name.clone(),
        host: record.remote_host.clone(),
        status: record.remote_status.clone(),
        error: record.remote_error.clone(),
    })
}

pub fn sidecar_execution_for_session(
    session_id: Option<&str>,
) -> Result<Option<RemoteSidecarExecution>> {
    let Some(session_id) = session_id else {
        return Ok(None);
    };
    let conn = crate::models::db::read_conn()?;
    let record = conn.query_row(
        r#"
        SELECT w.location_kind, w.remote_backend, w.remote_root_path, w.remote_container_name, w.remote_host
        FROM sessions s
        JOIN workspaces w ON w.id = s.workspace_id
        WHERE s.id = ?1
        "#,
        [session_id],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        },
    );
    let (location_kind, backend, cwd, container_name, host) = match record {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if location_kind.as_deref() != Some("remote") {
        return Ok(None);
    }
    let backend = RemoteWorkspaceBackend::from_db(backend.as_deref())
        .with_context(|| format!("Remote session {session_id} is missing backend"))?;
    let cwd = cwd.with_context(|| format!("Remote session {session_id} is missing cwd"))?;
    Ok(Some(RemoteSidecarExecution {
        backend,
        cwd,
        container_name,
        host,
    }))
}

pub(crate) fn prepare_metadata(
    repository: &repos::RepositoryRecord,
    directory_name: &str,
    options: &RemoteWorkspaceCreateOptions,
) -> Result<RemoteRuntimeInfo> {
    validate_profile(&options.profile)?;
    let remote_root_base = options
        .profile
        .remote_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("~/helmor-workspaces");
    let remote_root_path = format!(
        "{}/{}/{}",
        remote_root_base.trim_end_matches('/'),
        shell_safe_segment(&repository.name),
        shell_safe_segment(directory_name),
    );
    let container_name = match options.profile.backend {
        RemoteWorkspaceBackend::Docker => {
            Some(project_container_name(repository, &options.profile))
        }
        RemoteWorkspaceBackend::Ssh => None,
    };
    Ok(RemoteRuntimeInfo {
        backend: options.profile.backend.clone(),
        profile_id: Some(options.profile.id.clone()),
        profile_name: Some(options.profile.name.clone()),
        remote_root_path: Some(remote_root_path),
        container_name,
        host: options.profile.ssh_host.clone(),
        status: Some("pending".to_string()),
        error: None,
    })
}

pub(crate) fn finalize_remote_workspace(
    workspace_id: &str,
    record: &WorkspaceRecord,
    repository: &repos::RepositoryRecord,
    copy_pi_config: bool,
) -> Result<WorkspaceState> {
    let result = (|| -> Result<()> {
        let backend = backend(record)?;
        let remote_root = remote_root(record)?;
        match backend {
            RemoteWorkspaceBackend::Docker => ensure_docker_container(record)?,
            RemoteWorkspaceBackend::Ssh => ensure_ssh_host(record)?,
        }
        if let Some(command) = remote_bootstrap_command(record)? {
            run(record, &command)?;
        }
        run(record, "command -v git >/dev/null").context("Remote target is missing git")?;
        run(record, "(command -v node >/dev/null && command -v npx >/dev/null) || command -v bunx >/dev/null")
            .context("Remote target needs node+npx or bunx for Pi")?;
        if copy_pi_config {
            copy_local_pi_config(record)?;
        }
        let remote = repository.remote.as_deref().unwrap_or("origin");
        let remote_url =
            repos::resolve_repository_remote_url(Path::new(&repository.root_path), remote)
                .with_context(|| {
                    format!(
                        "Repository {} has no remote URL for remote workspace clone",
                        repository.name
                    )
                })?;
        let default_branch = record
            .default_branch
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("main");
        let branch = record
            .branch
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .with_context(|| format!("Remote workspace {workspace_id} is missing branch"))?;
        let clone_script = format!(
            r#"
            set -e
            mkdir -p {parent}
            if [ ! -d {dir}/.git ]; then
              git clone {remote_url} {dir}
            fi
            cd {dir}
            git remote set-url {remote_name} {remote_url} 2>/dev/null || git remote add {remote_name} {remote_url}
            git fetch {remote_name} --prune
            if git rev-parse --verify --quiet refs/remotes/{remote_name}/{branch} >/dev/null; then
              git checkout -B {branch} refs/remotes/{remote_name}/{branch}
            else
              git checkout -B {branch} refs/remotes/{remote_name}/{default_branch}
            fi
            "#,
            parent = shell_path(parent_dir(&remote_root)),
            dir = shell_path(&remote_root),
            remote_url = shell_quote(&remote_url),
            remote_name = shell_quote(remote),
            branch = shell_quote(branch),
            default_branch = shell_quote(default_branch),
        );
        run(record, &clone_script)?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            update_remote_status(workspace_id, "ready", None)?;
            Ok(WorkspaceState::Ready)
        }
        Err(error) => {
            update_remote_status(workspace_id, "error", Some(&format!("{error:#}")))?;
            Err(error)
        }
    }
}

pub fn list_files(workspace_id: &str) -> Result<Vec<EditorFileListItem>> {
    let record = load_remote_record(workspace_id)?;
    let output = run(
        &record,
        "find . -type f -not -path './.git/*' -not -path './node_modules/*' -not -path './target/*' | sed 's#^./##' | head -n 500",
    )?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|path| {
            file_item(
                workspace_id,
                FileItemParts {
                    path,
                    status: "M",
                    insertions: 0,
                    deletions: 0,
                    staged_status: None,
                    unstaged_status: None,
                    committed_status: None,
                },
            )
        })
        .collect())
}

pub fn list_editor_files(workspace_id: &str) -> Result<Vec<EditorFileListItem>> {
    let mut items = list_files(workspace_id)?;
    items.truncate(24);
    Ok(items)
}

pub fn list_editor_files_with_content(
    workspace_id: &str,
) -> Result<EditorFilesWithContentResponse> {
    let items = list_editor_files(workspace_id)?;
    let prefetched = prefetch(workspace_id, &items)?;
    Ok(EditorFilesWithContentResponse { items, prefetched })
}

pub fn list_changes(workspace_id: &str) -> Result<Vec<EditorFileListItem>> {
    let record = load_remote_record(workspace_id)?;
    if !record.state.is_operational() {
        return Ok(Vec::new());
    }
    let committed = run(&record, "git diff --name-status $(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main) HEAD 2>/dev/null || true")?;
    let staged = run(
        &record,
        "git diff --name-status --cached 2>/dev/null || true",
    )?;
    let unstaged = run(&record, "git diff --name-status 2>/dev/null || true")?;
    let untracked = run(
        &record,
        "git ls-files --others --exclude-standard 2>/dev/null || true",
    )?;
    let numstat = run(
        &record,
        "{ git diff --numstat HEAD 2>/dev/null; git diff --numstat --cached 2>/dev/null; } || true",
    )?;
    Ok(parse_change_items(
        workspace_id,
        &committed,
        &staged,
        &unstaged,
        &untracked,
        &numstat,
    ))
}

pub fn list_changes_with_content(workspace_id: &str) -> Result<EditorFilesWithContentResponse> {
    let items = list_changes(workspace_id)?;
    let prefetched = prefetch(workspace_id, &items)?;
    Ok(EditorFilesWithContentResponse { items, prefetched })
}

pub fn read_file(workspace_id: &str, relative_path: &str) -> Result<EditorFileReadResponse> {
    validate_relative_path(relative_path)?;
    let record = load_remote_record(workspace_id)?;
    let content = run(&record, &format!("cat -- {}", shell_quote(relative_path)))?;
    let mtime_ms = stat_mtime_ms(&record, relative_path).unwrap_or(0);
    Ok(EditorFileReadResponse {
        path: remote_file_uri(workspace_id, relative_path),
        content,
        mtime_ms,
    })
}

pub fn read_file_at_ref(
    workspace_id: &str,
    relative_path: &str,
    git_ref: &str,
) -> Result<Option<String>> {
    validate_relative_path(relative_path)?;
    let record = load_remote_record(workspace_id)?;
    let object = format!("{}:{}", git_ref, relative_path);
    match run(
        &record,
        &format!("git show {} 2>/dev/null", shell_quote(&object)),
    ) {
        Ok(content) => Ok(Some(content)),
        Err(_) => Ok(None),
    }
}

pub fn write_file(
    workspace_id: &str,
    relative_path: &str,
    content: &str,
) -> Result<EditorFileWriteResponse> {
    validate_relative_path(relative_path)?;
    let record = load_remote_record(workspace_id)?;
    run_with_stdin(
        &record,
        &format!(
            "mkdir -p -- $(dirname -- {}) && cat > {}",
            shell_quote(relative_path),
            shell_quote(relative_path)
        ),
        content.as_bytes(),
    )?;
    let mtime_ms = stat_mtime_ms(&record, relative_path).unwrap_or(0);
    Ok(EditorFileWriteResponse {
        path: remote_file_uri(workspace_id, relative_path),
        mtime_ms,
    })
}

pub fn stat_file(workspace_id: &str, relative_path: &str) -> Result<EditorFileStatResponse> {
    validate_relative_path(relative_path)?;
    let record = load_remote_record(workspace_id)?;
    let output = run(
        &record,
        &format!("if [ -f {p} ]; then printf 'file %s %s' \"$(stat -c %Y {p})\" \"$(stat -c %s {p})\"; elif [ -e {p} ]; then printf 'other'; else printf 'missing'; fi", p = shell_quote(relative_path)),
    )?;
    let parts: Vec<&str> = output.split_whitespace().collect();
    Ok(match parts.as_slice() {
        ["file", mtime, size] => EditorFileStatResponse {
            path: remote_file_uri(workspace_id, relative_path),
            exists: true,
            is_file: true,
            mtime_ms: mtime.parse::<i64>().ok().map(|v| v * 1000),
            size: size.parse::<i64>().ok(),
        },
        ["other"] => EditorFileStatResponse {
            path: remote_file_uri(workspace_id, relative_path),
            exists: true,
            is_file: false,
            mtime_ms: None,
            size: None,
        },
        _ => EditorFileStatResponse {
            path: remote_file_uri(workspace_id, relative_path),
            exists: false,
            is_file: false,
            mtime_ms: None,
            size: None,
        },
    })
}

pub fn stage_file(workspace_id: &str, relative_path: &str) -> Result<()> {
    git_file_command(workspace_id, "git add --", relative_path)
}

pub fn unstage_file(workspace_id: &str, relative_path: &str) -> Result<()> {
    git_file_command(workspace_id, "git restore --staged --", relative_path)
}

pub fn discard_file(workspace_id: &str, relative_path: &str) -> Result<()> {
    validate_relative_path(relative_path)?;
    let record = load_remote_record(workspace_id)?;
    run(
        &record,
        &format!(
            "if git ls-files --error-unmatch -- {p} >/dev/null 2>&1; then git checkout HEAD -- {p}; elif [ -e {p} ]; then rm -f -- {p}; fi",
            p = shell_quote(relative_path)
        ),
    )?;
    Ok(())
}

pub fn git_action_status(workspace_id: &str) -> Result<WorkspaceGitActionStatus> {
    let record = load_remote_record(workspace_id)?;
    if !record.state.is_operational() {
        return Ok(quiet_status(&record));
    }
    let porcelain = run(&record, "git status --porcelain 2>/dev/null || true")?;
    let uncommitted_count = porcelain
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    let conflict_count = porcelain
        .lines()
        .filter(|line| line.starts_with("UU") || line.starts_with("AA") || line.starts_with("DD"))
        .count();
    let target = record
        .intended_target_branch
        .clone()
        .or_else(|| record.default_branch.clone());
    let remote = record.remote.as_deref().unwrap_or("origin");
    let behind_target_count = target
        .as_deref()
        .and_then(|branch| {
            run(
                &record,
                &format!(
                    "git rev-list --count HEAD..{}/{} 2>/dev/null || true",
                    shell_quote(remote),
                    shell_quote(branch)
                ),
            )
            .ok()
        })
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(0);
    Ok(WorkspaceGitActionStatus {
        uncommitted_count,
        conflict_count,
        sync_target_branch: target,
        sync_status: if behind_target_count > 0 {
            WorkspaceSyncStatus::Behind
        } else {
            WorkspaceSyncStatus::UpToDate
        },
        behind_target_count,
        remote_tracking_ref: None,
        ahead_of_remote_count: 0,
        push_status: WorkspacePushStatus::Unpublished,
    })
}

fn git_file_command(workspace_id: &str, command: &str, relative_path: &str) -> Result<()> {
    validate_relative_path(relative_path)?;
    let record = load_remote_record(workspace_id)?;
    run(
        &record,
        &format!("{} {}", command, shell_quote(relative_path)),
    )?;
    Ok(())
}

fn quiet_status(record: &WorkspaceRecord) -> WorkspaceGitActionStatus {
    WorkspaceGitActionStatus {
        uncommitted_count: 0,
        conflict_count: 0,
        sync_target_branch: record
            .intended_target_branch
            .clone()
            .or_else(|| record.default_branch.clone()),
        sync_status: WorkspaceSyncStatus::UpToDate,
        behind_target_count: 0,
        remote_tracking_ref: None,
        ahead_of_remote_count: 0,
        push_status: WorkspacePushStatus::Unpublished,
    }
}

fn parse_change_items(
    workspace_id: &str,
    committed: &str,
    staged: &str,
    unstaged: &str,
    untracked: &str,
    numstat: &str,
) -> Vec<EditorFileListItem> {
    use std::collections::BTreeMap;
    let mut committed_map = BTreeMap::new();
    let mut staged_map = BTreeMap::new();
    let mut unstaged_map = BTreeMap::new();
    parse_name_status(committed, &mut committed_map);
    parse_name_status(staged, &mut staged_map);
    parse_name_status(unstaged, &mut unstaged_map);
    for line in untracked
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        unstaged_map
            .entry(line.to_string())
            .or_insert_with(|| "A".to_string());
    }
    let mut file_map = BTreeMap::new();
    for map in [&committed_map, &staged_map, &unstaged_map] {
        for (path, status) in map {
            file_map.insert(path.clone(), status.clone());
        }
    }
    let mut stats = BTreeMap::<String, (u32, u32)>::new();
    for line in numstat.lines() {
        let mut parts = line.split('\t');
        let insertions = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        let deletions = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        if let Some(path) = parts.next() {
            stats.insert(path.to_string(), (insertions, deletions));
        }
    }
    file_map
        .into_iter()
        .map(|(path, status)| {
            let (insertions, deletions) = stats.get(&path).copied().unwrap_or((0, 0));
            file_item(
                workspace_id,
                FileItemParts {
                    path: &path,
                    status: &status,
                    insertions,
                    deletions,
                    staged_status: staged_map.get(&path).cloned(),
                    unstaged_status: unstaged_map.get(&path).cloned(),
                    committed_status: committed_map.get(&path).cloned(),
                },
            )
        })
        .collect()
}

fn parse_name_status(output: &str, map: &mut std::collections::BTreeMap<String, String>) {
    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let Some(status) = parts.next() else { continue };
        let Some(path) = parts.next_back().or_else(|| parts.next()) else {
            continue;
        };
        map.insert(
            path.to_string(),
            status.chars().next().unwrap_or('M').to_string(),
        );
    }
}

struct FileItemParts<'a> {
    path: &'a str,
    status: &'a str,
    insertions: u32,
    deletions: u32,
    staged_status: Option<String>,
    unstaged_status: Option<String>,
    committed_status: Option<String>,
}

fn file_item(workspace_id: &str, parts: FileItemParts<'_>) -> EditorFileListItem {
    let FileItemParts {
        path,
        status,
        insertions,
        deletions,
        staged_status,
        unstaged_status,
        committed_status,
    } = parts;
    let name = Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    EditorFileListItem {
        path: path.to_string(),
        absolute_path: remote_file_uri(workspace_id, path),
        name,
        status: status.to_string(),
        insertions,
        deletions,
        staged_status,
        unstaged_status,
        committed_status,
    }
}

fn prefetch(
    workspace_id: &str,
    items: &[EditorFileListItem],
) -> Result<Vec<EditorFilePrefetchItem>> {
    let mut prefetched = Vec::new();
    for item in items.iter().filter(|item| item.status != "D").take(12) {
        if let Ok(stat) = stat_file(workspace_id, &item.path) {
            if stat.size.unwrap_or(0) as usize > MAX_PREFETCH_BYTES {
                continue;
            }
        }
        if let Ok(read) = read_file(workspace_id, &item.path) {
            prefetched.push(EditorFilePrefetchItem {
                absolute_path: item.absolute_path.clone(),
                content: read.content,
            });
        }
    }
    Ok(prefetched)
}

fn stat_mtime_ms(record: &WorkspaceRecord, relative_path: &str) -> Result<i64> {
    let output = run(
        record,
        &format!("stat -c %Y -- {}", shell_quote(relative_path)),
    )?;
    Ok(output.trim().parse::<i64>().unwrap_or(0) * 1000)
}

fn load_remote_record(workspace_id: &str) -> Result<WorkspaceRecord> {
    let record = crate::models::workspaces::load_workspace_record_by_id(workspace_id)?
        .ok_or_else(|| coded(ErrorCode::WorkspaceNotFound))?;
    if !is_remote_record(&record) {
        bail!("Workspace {workspace_id} is not remote");
    }
    Ok(record)
}

fn validate_profile(profile: &RemoteWorkspaceProfile) -> Result<()> {
    if profile.id.trim().is_empty() || profile.name.trim().is_empty() {
        bail!("Remote profile needs a name and id");
    }
    match profile.backend {
        RemoteWorkspaceBackend::Docker => {
            if profile
                .docker_image
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
            {
                bail!("Docker remote profile needs an image");
            }
        }
        RemoteWorkspaceBackend::Ssh => {
            if profile.ssh_host.as_deref().unwrap_or("").trim().is_empty() {
                bail!("SSH remote profile needs a host");
            }
        }
    }
    Ok(())
}

fn backend(record: &WorkspaceRecord) -> Result<RemoteWorkspaceBackend> {
    RemoteWorkspaceBackend::from_db(record.remote_backend.as_deref())
        .with_context(|| format!("Workspace {} has invalid remote backend", record.id))
}

fn remote_root(record: &WorkspaceRecord) -> Result<String> {
    record
        .remote_root_path
        .clone()
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("Workspace {} is missing remote root", record.id))
}

fn remote_bootstrap_command(record: &WorkspaceRecord) -> Result<Option<String>> {
    let Some(profile_id) = record.remote_profile_id.as_deref() else {
        return Ok(None);
    };
    let Some(raw) = crate::models::settings::load_setting_value("app.remote_workspace_profiles")?
    else {
        return Ok(None);
    };
    let profiles: Vec<RemoteWorkspaceProfile> = serde_json::from_str(&raw).unwrap_or_default();
    Ok(profiles
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .and_then(|profile| profile.bootstrap_command)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty()))
}

fn update_remote_status(workspace_id: &str, status: &str, error: Option<&str>) -> Result<()> {
    let conn = crate::models::db::write_conn()?;
    conn.execute(
        "UPDATE workspaces SET remote_status = ?2, remote_error = ?3, updated_at = datetime('now') WHERE id = ?1",
        rusqlite::params![workspace_id, status, error],
    )?;
    Ok(())
}

fn ensure_docker_container(record: &WorkspaceRecord) -> Result<()> {
    let container = record
        .remote_container_name
        .as_deref()
        .with_context(|| format!("Workspace {} is missing Docker container", record.id))?;
    let exists = Command::new("docker")
        .args(["inspect", container])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if exists {
        let _ = Command::new("docker").args(["start", container]).status();
        return Ok(());
    }
    let image = docker_image_for_record(record)?.unwrap_or_else(|| "node:22-bookworm".to_string());
    run_host_command(Command::new("docker").args([
        "run",
        "-d",
        "--name",
        container,
        "-w",
        "/workspace",
        &image,
        "sleep",
        "infinity",
    ]))?;
    Ok(())
}

fn docker_image_for_record(record: &WorkspaceRecord) -> Result<Option<String>> {
    let Some(profile_id) = record.remote_profile_id.as_deref() else {
        return Ok(None);
    };
    let Some(raw) = crate::models::settings::load_setting_value("app.remote_workspace_profiles")?
    else {
        return Ok(None);
    };
    let profiles: Vec<RemoteWorkspaceProfile> = serde_json::from_str(&raw).unwrap_or_default();
    Ok(profiles
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .and_then(|profile| profile.docker_image))
}

fn ensure_ssh_host(record: &WorkspaceRecord) -> Result<()> {
    let host = record
        .remote_host
        .as_deref()
        .with_context(|| format!("Workspace {} is missing SSH host", record.id))?;
    run_host_command(Command::new("ssh").args(["-o", "BatchMode=yes", host, "true"]))?;
    Ok(())
}

fn copy_local_pi_config(record: &WorkspaceRecord) -> Result<()> {
    let auth_path = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".pi/agent/auth.json");
    if !auth_path.is_file() {
        tracing::warn!(path = %auth_path.display(), "Pi auth file missing; skipping remote copy");
        return Ok(());
    }
    run(
        record,
        "mkdir -p ~/.pi/agent && chmod 700 ~/.pi ~/.pi/agent",
    )?;
    match backend(record)? {
        RemoteWorkspaceBackend::Docker => {
            let container = record
                .remote_container_name
                .as_deref()
                .context("missing container")?;
            run_host_command(Command::new("docker").args([
                "cp",
                auth_path.to_string_lossy().as_ref(),
                &format!("{container}:/root/.pi/agent/auth.json"),
            ]))?;
        }
        RemoteWorkspaceBackend::Ssh => {
            let host = record.remote_host.as_deref().context("missing SSH host")?;
            run_host_command(Command::new("scp").args([
                auth_path.to_string_lossy().as_ref(),
                &format!("{host}:~/.pi/agent/auth.json"),
            ]))?;
        }
    }
    Ok(())
}

pub fn run(record: &WorkspaceRecord, script: &str) -> Result<String> {
    run_with_stdin(record, script, &[])
}

pub fn run_with_stdin(
    record: &WorkspaceRecord,
    script: &str,
    stdin_bytes: &[u8],
) -> Result<String> {
    let cwd = remote_root(record)?;
    let wrapped = format!("cd {} && {}", shell_path(&cwd), script);
    match backend(record)? {
        RemoteWorkspaceBackend::Docker => {
            let container = record
                .remote_container_name
                .as_deref()
                .context("missing Docker container")?;
            let mut command = Command::new("docker");
            command.args(["exec", "-i", container, "sh", "-lc", &wrapped]);
            run_host_command_with_stdin(&mut command, stdin_bytes)
        }
        RemoteWorkspaceBackend::Ssh => {
            let host = record.remote_host.as_deref().context("missing SSH host")?;
            let mut command = Command::new("ssh");
            command.args(["-o", "BatchMode=yes", host, "sh", "-lc", &wrapped]);
            run_host_command_with_stdin(&mut command, stdin_bytes)
        }
    }
}

fn run_host_command(command: &mut Command) -> Result<String> {
    run_host_command_with_stdin(command, &[])
}

fn run_host_command_with_stdin(command: &mut Command, stdin_bytes: &[u8]) -> Result<String> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Failed to spawn remote command")?;
    if !stdin_bytes.is_empty() {
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(stdin_bytes)?;
        }
    }
    drop(child.stdin.take());
    let output = child.wait_with_output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("Remote command failed: {stderr}");
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn validate_relative_path(value: &str) -> Result<()> {
    if value.trim().is_empty()
        || value.starts_with('/')
        || value.split('/').any(|part| part == "..")
    {
        bail!("Invalid remote workspace path: {value}");
    }
    Ok(())
}

fn parent_dir(path: &str) -> &str {
    path.rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or(".")
}

fn shell_safe_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn project_container_name(
    repository: &repos::RepositoryRecord,
    profile: &RemoteWorkspaceProfile,
) -> String {
    format!(
        "helmor-{}-{}",
        shell_safe_segment(&repository.name).to_lowercase(),
        shell_safe_segment(&profile.id).to_lowercase(),
    )
}

fn shell_path(value: &str) -> String {
    if let Some(rest) = value.strip_prefix("~/") {
        format!("$HOME/{}", shell_quote(rest))
    } else {
        shell_quote(value)
    }
}

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_path_preserves_home_expansion() {
        assert_eq!(
            shell_path("~/helmor-workspaces/repo one"),
            "$HOME/'helmor-workspaces/repo one'"
        );
        assert_eq!(shell_path("/workspace/repo one"), "'/workspace/repo one'");
    }
}
