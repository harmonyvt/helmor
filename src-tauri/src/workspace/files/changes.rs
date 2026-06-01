use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
#[cfg(test)]
use rusqlite::Connection;

use super::{
    support::allowed_workspace_roots,
    types::{
        EditorFileListItem, EditorFilePrefetchItem, EditorFilesWithContentResponse,
        GitPanelContext, GitPanelResponse,
    },
};
use crate::{
    bail_coded, db,
    error::{AnyhowCodedExt, ErrorCode},
    forge::ChangeRequestInfo,
    git_ops, workspace_state,
};

const MAX_PREFETCH_BYTES: u64 = 1_048_576;
const CONTEXT_CHANGE_REQUEST_TTL: Duration = Duration::from_secs(60);
/// Bound on the per-(remote, branch) PR cache so long-running sessions
/// with many branch switches don't leak entries forever. When the cache
/// hits this size we drop the oldest-recorded entries on insert.
const CONTEXT_CHANGE_REQUEST_CACHE_LIMIT: usize = 256;

type ContextChangeRequestCache =
    Mutex<BTreeMap<(String, String), (Instant, Option<ChangeRequestInfo>)>>;

static CONTEXT_CHANGE_REQUEST_CACHE: OnceLock<ContextChangeRequestCache> = OnceLock::new();

fn context_change_request_cache() -> &'static ContextChangeRequestCache {
    CONTEXT_CHANGE_REQUEST_CACHE.get_or_init(|| Mutex::new(BTreeMap::new()))
}

/// Drop the cached PR lookup for a specific (remote, branch) pair. Called
/// after merge/close mutations and from `evict_all_context_change_requests`
/// when the UI requests a force-refresh.
pub fn evict_context_change_request_cache(remote_url: &str, branch: &str) {
    let key = (remote_url.to_string(), branch.trim().to_string());
    let mut guard = context_change_request_cache()
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    guard.remove(&key);
}

/// Drop every cached PR lookup. Used by the manual "Refresh PR status"
/// affordance so the next git-panel call goes straight to gh instead of
/// waiting on the 60s TTL.
pub fn evict_all_context_change_requests() {
    let mut guard = context_change_request_cache()
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    guard.clear();
}

pub fn list_workspace_changes(workspace_root_path: &str) -> Result<Vec<EditorFileListItem>> {
    list_git_root_changes(workspace_root_path, None)
}

fn list_git_root_changes(
    workspace_root_path: &str,
    target_ref_override: Option<&str>,
) -> Result<Vec<EditorFileListItem>> {
    let workspace_root = Path::new(workspace_root_path);
    if !workspace_root.is_absolute() {
        bail!(
            "Workspace root must be an absolute path: {}",
            workspace_root.display()
        );
    }
    if !workspace_root.is_dir() {
        // Workspace dir vanished externally (deleted / archive cleanup /
        // repo moved). The inspector polls this on a fixed interval — if
        // we bailed, every tick would log an error. Return empty changes
        // silently; the selection layer is responsible for reconciling.
        tracing::warn!(
            path = %workspace_root.display(),
            "workspace root missing; returning empty change list",
        );
        return Ok(Vec::new());
    }

    let target_ref = target_ref_override
        .map(ToOwned::to_owned)
        .map(Ok)
        .unwrap_or_else(|| resolve_target_ref(workspace_root))?;

    // Run all git commands in parallel — they're independent reads.
    let (
        committed_output,
        unstaged_output,
        staged_output,
        untracked_output,
        committed_numstat,
        staged_numstat,
        unstaged_numstat,
    ) = std::thread::scope(|s| {
        let h_committed = s.spawn(|| {
            git_ops::run_git(
                ["diff", "--name-status", target_ref.as_str(), "HEAD"],
                Some(workspace_root),
            )
            .unwrap_or_default()
        });
        let h_unstaged = s.spawn(|| {
            git_ops::run_git(["diff", "--name-status"], Some(workspace_root)).unwrap_or_default()
        });
        let h_staged = s.spawn(|| {
            git_ops::run_git(["diff", "--name-status", "--cached"], Some(workspace_root))
                .unwrap_or_default()
        });
        let h_untracked = s.spawn(|| {
            git_ops::run_git(
                ["ls-files", "--others", "--exclude-standard"],
                Some(workspace_root),
            )
            .unwrap_or_default()
        });
        let tr = target_ref.as_str();
        let h_cn = s.spawn(move || {
            git_ops::run_git(["diff", "--numstat", tr, "HEAD"], Some(workspace_root))
                .unwrap_or_default()
        });
        let h_sn = s.spawn(|| {
            git_ops::run_git(["diff", "--numstat", "--cached"], Some(workspace_root))
                .unwrap_or_default()
        });
        let h_un = s.spawn(|| {
            git_ops::run_git(["diff", "--numstat"], Some(workspace_root)).unwrap_or_default()
        });
        (
            h_committed.join().unwrap_or_default(),
            h_unstaged.join().unwrap_or_default(),
            h_staged.join().unwrap_or_default(),
            h_untracked.join().unwrap_or_default(),
            h_cn.join().unwrap_or_default(),
            h_sn.join().unwrap_or_default(),
            h_un.join().unwrap_or_default(),
        )
    });

    let mut committed_map = BTreeMap::<String, String>::new();
    parse_name_status_into(&committed_output, &mut committed_map);

    let mut staged_map = BTreeMap::<String, String>::new();
    parse_name_status_into(&staged_output, &mut staged_map);

    let mut unstaged_map = BTreeMap::<String, String>::new();
    parse_name_status_into(&unstaged_output, &mut unstaged_map);

    let mut untracked_paths = Vec::<String>::new();
    for line in untracked_output.lines() {
        let path = line.trim();
        if !path.is_empty() {
            untracked_paths.push(path.to_string());
            unstaged_map
                .entry(path.to_string())
                .or_insert_with(|| "A".to_string());
        }
    }

    let mut file_map = BTreeMap::<String, String>::new();
    for (path, status) in &committed_map {
        file_map.insert(path.clone(), status.clone());
    }
    for (path, status) in &staged_map {
        file_map.insert(path.clone(), status.clone());
    }
    for (path, status) in &unstaged_map {
        file_map.insert(path.clone(), status.clone());
    }

    let mut stats_map = BTreeMap::<String, (u32, u32)>::new();
    parse_numstat_into(&committed_numstat, &mut stats_map);
    parse_numstat_into(&staged_numstat, &mut stats_map);
    parse_numstat_into(&unstaged_numstat, &mut stats_map);
    for path in &untracked_paths {
        stats_map.entry(path.clone()).or_insert_with(|| {
            count_text_file_lines(&workspace_root.join(path)).map_or((0, 0), |lines| (lines, 0))
        });
    }

    let items = file_map
        .into_iter()
        .map(|(relative_path, status)| {
            let absolute = workspace_root.join(&relative_path);
            let name = Path::new(&relative_path)
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| relative_path.clone());
            let (insertions, deletions) = stats_map.get(&relative_path).copied().unwrap_or((0, 0));
            EditorFileListItem {
                path: relative_path.clone(),
                absolute_path: absolute.display().to_string(),
                name,
                status,
                insertions,
                deletions,
                staged_status: staged_map.get(&relative_path).cloned(),
                unstaged_status: unstaged_map.get(&relative_path).cloned(),
                committed_status: committed_map.get(&relative_path).cloned(),
            }
        })
        .collect();

    Ok(items)
}

pub fn list_workspace_changes_with_content(
    workspace_root_path: &str,
) -> Result<EditorFilesWithContentResponse> {
    let items = list_workspace_changes(workspace_root_path)?;
    let prefetched = items
        .iter()
        .filter(|item| item.status != "D")
        .filter_map(|item| {
            let path = Path::new(&item.absolute_path);
            let metadata = fs::metadata(path).ok()?;
            if metadata.len() > MAX_PREFETCH_BYTES {
                return None;
            }
            let bytes = fs::read(path).ok()?;
            let content = String::from_utf8(bytes).ok()?;
            Some(EditorFilePrefetchItem {
                absolute_path: item.absolute_path.clone(),
                content,
            })
        })
        .collect();

    Ok(EditorFilesWithContentResponse { items, prefetched })
}

pub fn list_workspace_git_panel(workspace_root_path: &str) -> Result<GitPanelResponse> {
    let workspace_root = Path::new(workspace_root_path);
    let mut contexts = discover_git_panel_contexts(workspace_root)?;
    let mut items = Vec::<EditorFileListItem>::new();

    for context in &contexts {
        if !context.available {
            continue;
        }
        let target_ref = context
            .target_branch
            .as_ref()
            .zip(context.remote.as_ref())
            .map(|(branch, remote)| format!("refs/remotes/{remote}/{branch}"));
        let mut context_items =
            list_git_root_changes(&context.root_path, target_ref.as_deref()).unwrap_or_default();
        for item in &mut context_items {
            item.absolute_path = Path::new(&context.root_path)
                .join(&item.path)
                .display()
                .to_string();
            if let Some(prefix) = &context.parent_relative_path {
                item.path = format!(
                    "{}/{}",
                    prefix.trim_matches('/'),
                    item.path.trim_start_matches('/')
                );
            }
        }
        items.extend(context_items);
    }

    let prefetched = prefetch_changed_items(&items);
    contexts.sort_by(|left, right| {
        if left.kind != right.kind {
            return if left.kind == "workspace" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        left.name.cmp(&right.name)
    });
    Ok(GitPanelResponse {
        contexts,
        items,
        prefetched,
    })
}

pub fn push_git_context_to_remote(
    context_root_path: &str,
    remote: Option<&str>,
) -> Result<crate::workspaces::PushWorkspaceToRemoteResponse> {
    let context_root = validate_git_context_root(context_root_path)?;
    let remote = remote
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("origin");

    let current_status = git_ops::workspace_action_status(&context_root, Some(remote), None)?;
    if current_status.conflict_count > 0 {
        bail!("Cannot push branch while merge conflicts are present");
    }

    let push_result = git_ops::push_current_branch(&context_root, remote)?;
    let head_commit = git_ops::current_workspace_head_commit(&context_root)?;
    Ok(crate::workspaces::PushWorkspaceToRemoteResponse {
        target_ref: push_result.target_ref,
        head_commit,
    })
}

pub fn sync_git_context_with_target_branch(
    context_root_path: &str,
    remote: Option<&str>,
    target_branch: Option<&str>,
) -> Result<crate::workspaces::SyncWorkspaceTargetResponse> {
    let context_root = validate_git_context_root(context_root_path)?;
    let remote = remote
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("origin");

    // Try caller-provided value first; if missing, attempt to re-resolve
    // from the local git config (upstream → remote HEAD → main → master).
    // If none of those apply, return NoTargetBranch instead of silently
    // assuming "main" and pulling the wrong branch — this hits submodules
    // whose default branch is `master`, `trunk`, `develop`, etc.
    let target_branch = target_branch
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| resolve_context_target_branch(&context_root, remote));
    let Some(target_branch) = target_branch else {
        return Ok(crate::workspaces::SyncWorkspaceTargetResponse {
            outcome: crate::workspaces::SyncWorkspaceTargetOutcome::NoTargetBranch,
            target_branch: String::new(),
            conflicted_files: Vec::new(),
        });
    };

    let current_status =
        git_ops::workspace_action_status(&context_root, Some(remote), Some(&target_branch))?;
    if current_status.conflict_count > 0 {
        return Ok(crate::workspaces::SyncWorkspaceTargetResponse {
            outcome: crate::workspaces::SyncWorkspaceTargetOutcome::Conflict,
            target_branch,
            conflicted_files: Vec::new(),
        });
    }
    if current_status.uncommitted_count > 0 {
        return Ok(crate::workspaces::SyncWorkspaceTargetResponse {
            outcome: crate::workspaces::SyncWorkspaceTargetOutcome::DirtyWorktree,
            target_branch,
            conflicted_files: Vec::new(),
        });
    }

    if let Err(error) = git_ops::fetch_remote_branch(&context_root, remote, &target_branch) {
        tracing::warn!(
            context_root = %context_root.display(),
            remote,
            target_branch,
            error = %error,
            "git fetch failed during context sync",
        );
        return Ok(crate::workspaces::SyncWorkspaceTargetResponse {
            outcome: crate::workspaces::SyncWorkspaceTargetOutcome::FetchFailed,
            target_branch,
            conflicted_files: Vec::new(),
        });
    }
    let target_ref = format!("refs/remotes/{remote}/{target_branch}");
    let behind_count = git_ops::commits_behind(&context_root, &target_ref)?;
    if behind_count == 0 {
        return Ok(crate::workspaces::SyncWorkspaceTargetResponse {
            outcome: crate::workspaces::SyncWorkspaceTargetOutcome::AlreadyUpToDate,
            target_branch,
            conflicted_files: Vec::new(),
        });
    }

    let preflight = git_ops::preflight_merge_ref(&context_root, &target_ref)?;
    if !preflight.conflicted_files.is_empty() {
        return Ok(crate::workspaces::SyncWorkspaceTargetResponse {
            outcome: crate::workspaces::SyncWorkspaceTargetOutcome::Conflict,
            target_branch,
            conflicted_files: preflight.conflicted_files,
        });
    }

    match git_ops::merge_ref_no_edit(&context_root, &target_ref) {
        Ok(()) => Ok(crate::workspaces::SyncWorkspaceTargetResponse {
            outcome: crate::workspaces::SyncWorkspaceTargetOutcome::Updated,
            target_branch,
            conflicted_files: Vec::new(),
        }),
        Err(error) => {
            let merge_status = git_ops::workspace_action_status(
                &context_root,
                Some(remote),
                Some(&target_branch),
            )?;
            if merge_status.conflict_count > 0 {
                let _ = git_ops::abort_merge(&context_root);
                Ok(crate::workspaces::SyncWorkspaceTargetResponse {
                    outcome: crate::workspaces::SyncWorkspaceTargetOutcome::Conflict,
                    target_branch,
                    conflicted_files: Vec::new(),
                })
            } else {
                Err(error)
            }
        }
    }
}

fn validate_git_context_root(context_root_path: &str) -> Result<PathBuf> {
    let context_root = PathBuf::from(context_root_path);
    if !context_root.is_absolute() {
        bail!(
            "Git context root must be an absolute path: {}",
            context_root.display()
        );
    }
    if !context_root.is_dir() {
        bail_coded!(
            ErrorCode::WorkspaceBroken,
            "Git context directory is missing: {}",
            context_root.display()
        );
    }
    let canonical = context_root.canonicalize().map_err(|error| {
        anyhow::Error::new(error)
            .context(format!(
                "Failed to canonicalize git context root: {}",
                context_root.display()
            ))
            .with_code(ErrorCode::WorkspaceBroken)
    })?;
    let workspace_roots = allowed_workspace_roots()?;
    if !workspace_roots
        .iter()
        .any(|root| canonical.starts_with(root))
    {
        bail!(
            "Git context root is not registered as an editable location: {}",
            context_root.display()
        );
    }
    Ok(context_root)
}

fn discover_git_panel_contexts(workspace_root: &Path) -> Result<Vec<GitPanelContext>> {
    if !workspace_root.is_absolute() {
        bail!(
            "Workspace root must be an absolute path: {}",
            workspace_root.display()
        );
    }
    if !workspace_root.is_dir() {
        tracing::warn!(
            path = %workspace_root.display(),
            "workspace root missing; returning empty git panel",
        );
        return Ok(Vec::new());
    }

    // Build per-submodule descriptors first (cheap, sync), then fan out
    // the gh GraphQL lookups in parallel. The old serial loop blocked
    // panel discovery for ~N × 500ms in workspaces with many submodules
    // because each `lookup_context_change_request` waits on a `gh`
    // subprocess. We keep the workspace descriptor in slot 0 so the
    // existing "workspace first" sort contract still holds.
    let mut descriptors: Vec<ContextDescriptor> = Vec::new();
    descriptors.push(ContextDescriptor {
        root: workspace_root.to_path_buf(),
        parent_relative_path: None,
        kind: "workspace",
        name: "Workspace".to_string(),
    });

    let output = git_ops::run_git(["submodule", "status", "--recursive"], Some(workspace_root))
        .unwrap_or_default();
    for line in output.lines() {
        let Some(relative_path) = parse_submodule_status_path(line) else {
            continue;
        };
        let root = workspace_root.join(&relative_path);
        let name = Path::new(&relative_path)
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| relative_path.clone());
        descriptors.push(ContextDescriptor {
            root,
            parent_relative_path: Some(relative_path),
            kind: "submodule",
            name,
        });
    }

    let contexts: Vec<GitPanelContext> = std::thread::scope(|scope| {
        let handles: Vec<_> = descriptors
            .into_iter()
            .map(|descriptor| {
                scope.spawn(move || {
                    build_git_panel_context(
                        &descriptor.root,
                        descriptor.parent_relative_path,
                        descriptor.kind,
                        &descriptor.name,
                    )
                })
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|handle| handle.join().ok())
            .collect()
    });

    Ok(contexts)
}

struct ContextDescriptor {
    root: PathBuf,
    parent_relative_path: Option<String>,
    kind: &'static str,
    name: String,
}

fn build_git_panel_context(
    root: &Path,
    parent_relative_path: Option<String>,
    kind: &str,
    name: &str,
) -> GitPanelContext {
    let root_path = root.display().to_string();
    if !root.is_dir() {
        return GitPanelContext {
            id: context_id(kind, parent_relative_path.as_deref()),
            kind: kind.to_string(),
            name: name.to_string(),
            root_path,
            parent_relative_path,
            branch: None,
            remote: None,
            remote_url: None,
            target_branch: None,
            git_status: quiet_git_status(None),
            change_request: None,
            available: false,
            unavailable_reason: Some("Submodule is not initialized on disk".to_string()),
        };
    }

    let branch = git_ops::current_branch_name(root).ok();
    let remote = resolve_default_remote(root);
    let remote_url = remote
        .as_deref()
        .and_then(|remote| git_config(root, &format!("remote.{remote}.url")));
    let target_branch = remote
        .as_deref()
        .and_then(|remote| resolve_context_target_branch(root, remote));
    let git_status =
        git_ops::workspace_action_status(root, remote.as_deref(), target_branch.as_deref())
            .unwrap_or_else(|_| quiet_git_status(target_branch.clone()));
    // Only query GitHub for submodule PRs when the local branch has a
    // remote-tracking ref. Mirrors the workspace-PR guard — without it a
    // freshly-created local branch can match a historical PR whose head
    // ref happens to share the placeholder name, badging the submodule
    // with a stranger's old PR.
    let has_remote_tracking = remote
        .as_deref()
        .is_some_and(|remote| git_ops::resolve_remote_tracking_ref(root, Some(remote)).is_some());
    let change_request = (kind == "submodule" && has_remote_tracking)
        .then(|| remote_url.as_deref().zip(branch.as_deref()))
        .flatten()
        .and_then(|(remote_url, branch)| lookup_context_change_request(remote_url, branch));

    GitPanelContext {
        id: context_id(kind, parent_relative_path.as_deref()),
        kind: kind.to_string(),
        name: name.to_string(),
        root_path,
        parent_relative_path,
        branch,
        remote,
        remote_url,
        target_branch,
        git_status,
        change_request,
        available: true,
        unavailable_reason: None,
    }
}

fn lookup_context_change_request(remote_url: &str, branch: &str) -> Option<ChangeRequestInfo> {
    let key = (remote_url.to_string(), branch.to_string());
    let cache = context_change_request_cache();
    {
        let guard = cache.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((cached_at, value)) = guard.get(&key) {
            if cached_at.elapsed() <= CONTEXT_CHANGE_REQUEST_TTL {
                return value.clone();
            }
        }
    }

    let loaded =
        crate::github_graphql::lookup_change_request_by_remote_and_branch(remote_url, branch)
            .unwrap_or_else(|error| {
                tracing::debug!(
                    remote_url,
                    branch,
                    error = %error,
                    "Git context change request lookup failed"
                );
                None
            });
    let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
    // Bound the cache before insert. We don't track real LRU; popping
    // the lexicographically-smallest key is good enough as long as we
    // bound the working set — the goal is preventing unbounded growth,
    // not perfect recall.
    while guard.len() >= CONTEXT_CHANGE_REQUEST_CACHE_LIMIT {
        let Some(first_key) = guard.keys().next().cloned() else {
            break;
        };
        guard.remove(&first_key);
    }
    guard.insert(key, (Instant::now(), loaded.clone()));
    loaded
}

fn context_id(kind: &str, parent_relative_path: Option<&str>) -> String {
    match parent_relative_path {
        Some(path) => format!("{kind}:{path}"),
        None => "workspace".to_string(),
    }
}

fn quiet_git_status(target_branch: Option<String>) -> git_ops::WorkspaceGitActionStatus {
    git_ops::WorkspaceGitActionStatus {
        uncommitted_count: 0,
        conflict_count: 0,
        sync_target_branch: target_branch,
        sync_status: git_ops::WorkspaceSyncStatus::Unknown,
        behind_target_count: 0,
        remote_tracking_ref: None,
        ahead_of_remote_count: 0,
        push_status: git_ops::WorkspacePushStatus::Unknown,
    }
}

fn parse_submodule_status_path(line: &str) -> Option<String> {
    let trimmed = line.trim_start_matches([' ', '+', '-', 'U']);
    let mut parts = trimmed.split_whitespace();
    let _sha = parts.next()?;
    parts.next().map(ToOwned::to_owned)
}

fn resolve_default_remote(root: &Path) -> Option<String> {
    git_config(root, "branch.HEAD.remote")
        .filter(|value| value != ".")
        .or_else(|| {
            let branch = git_ops::current_branch_name(root).ok()?;
            git_config(root, &format!("branch.{branch}.remote")).filter(|value| value != ".")
        })
        .or_else(|| {
            let remotes = git_ops::run_git(["remote"], Some(root)).ok()?;
            let names = remotes
                .lines()
                .map(str::trim)
                .filter(|remote| !remote.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            names
                .iter()
                .find(|remote| remote.as_str() == "origin")
                .cloned()
                .or_else(|| names.first().cloned())
        })
}

fn resolve_context_target_branch(root: &Path, remote: &str) -> Option<String> {
    let upstream = git_ops::run_git(
        [
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        Some(root),
    )
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
    if let Some(upstream) = upstream {
        if let Some(branch) = upstream.strip_prefix(&format!("{remote}/")) {
            return Some(branch.to_string());
        }
    }

    let remote_head = git_ops::run_git(
        ["symbolic-ref", "-q", &format!("refs/remotes/{remote}/HEAD")],
        Some(root),
    )
    .ok()
    .map(|value| value.trim().to_string())
    .and_then(|value| {
        value
            .strip_prefix(&format!("refs/remotes/{remote}/"))
            .map(ToOwned::to_owned)
    });
    if remote_head.is_some() {
        return remote_head;
    }

    for candidate in ["main", "master"] {
        if git_ops::verify_remote_ref_exists(root, remote, candidate).unwrap_or(false) {
            return Some(candidate.to_string());
        }
    }
    None
}

fn git_config(root: &Path, key: &str) -> Option<String> {
    git_ops::run_git(["config", "--get", key], Some(root))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn prefetch_changed_items(items: &[EditorFileListItem]) -> Vec<EditorFilePrefetchItem> {
    items
        .iter()
        .filter(|item| item.status != "D")
        .filter_map(|item| {
            let path = Path::new(&item.absolute_path);
            let metadata = fs::metadata(path).ok()?;
            if metadata.len() > MAX_PREFETCH_BYTES {
                return None;
            }
            let bytes = fs::read(path).ok()?;
            let content = String::from_utf8(bytes).ok()?;
            Some(EditorFilePrefetchItem {
                absolute_path: item.absolute_path.clone(),
                content,
            })
        })
        .collect()
}

fn validate_workspace_relative_path(
    workspace_root_path: &str,
    relative_path: &str,
) -> Result<(PathBuf, PathBuf)> {
    let workspace_root = PathBuf::from(workspace_root_path);
    if !workspace_root.is_absolute() {
        bail!(
            "Workspace root must be an absolute path: {}",
            workspace_root.display()
        );
    }
    // Directory vanished (archived, deleted externally, repo moved). Tag
    // the error so the frontend can offer "Permanently Delete" rather than
    // a generic red toast with no recovery action.
    if !workspace_root.is_dir() {
        bail_coded!(
            ErrorCode::WorkspaceBroken,
            "Workspace directory is missing: {}",
            workspace_root.display()
        );
    }

    if relative_path.is_empty() {
        bail!("Relative path must not be empty");
    }
    let rel = Path::new(relative_path);
    if rel.is_absolute() {
        bail!("Relative path must not be absolute: {relative_path}");
    }
    if rel
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        bail!("Relative path must not contain parent traversal: {relative_path}");
    }

    let canonical_root = workspace_root.canonicalize().map_err(|error| {
        // canonicalize only fails here if the directory was removed between
        // the is_dir() check above and now (TOCTOU). Same recovery action.
        anyhow::Error::new(error)
            .context(format!(
                "Failed to canonicalize workspace root: {}",
                workspace_root.display()
            ))
            .with_code(ErrorCode::WorkspaceBroken)
    })?;
    let workspace_roots = allowed_workspace_roots()?;
    if !workspace_roots
        .iter()
        .any(|root| canonical_root.starts_with(root))
    {
        bail!(
            "Workspace root is not registered as an editable location: {}",
            workspace_root.display()
        );
    }

    let absolute = workspace_root.join(rel);
    Ok((workspace_root, absolute))
}

pub fn discard_workspace_file(workspace_root_path: &str, relative_path: &str) -> Result<()> {
    let (workspace_root, absolute) =
        validate_workspace_relative_path(workspace_root_path, relative_path)?;

    let is_tracked = git_ops::run_git(
        ["ls-files", "--error-unmatch", "--", relative_path],
        Some(&workspace_root),
    )
    .is_ok();

    if is_tracked {
        git_ops::run_git(
            ["checkout", "HEAD", "--", relative_path],
            Some(&workspace_root),
        )
        .with_context(|| format!("Failed to discard changes for {relative_path}"))?;
    } else if absolute.exists() {
        fs::remove_file(&absolute)
            .with_context(|| format!("Failed to remove untracked file: {}", absolute.display()))?;
    }

    Ok(())
}

pub fn stage_workspace_file(workspace_root_path: &str, relative_path: &str) -> Result<()> {
    let (workspace_root, _) = validate_workspace_relative_path(workspace_root_path, relative_path)?;

    git_ops::run_git(["add", "--", relative_path], Some(&workspace_root))
        .with_context(|| format!("Failed to stage {relative_path}"))?;

    Ok(())
}

pub fn unstage_workspace_file(workspace_root_path: &str, relative_path: &str) -> Result<()> {
    let (workspace_root, _) = validate_workspace_relative_path(workspace_root_path, relative_path)?;

    git_ops::run_git(
        ["restore", "--staged", "--", relative_path],
        Some(&workspace_root),
    )
    .with_context(|| format!("Failed to unstage {relative_path}"))?;

    Ok(())
}

pub(super) fn parse_workspace_path(workspace_root: &Path) -> Option<(&str, &str)> {
    let dir_name = workspace_root.file_name()?.to_str()?;
    let repo_name = workspace_root.parent()?.file_name()?.to_str()?;
    Some((repo_name, dir_name))
}

#[cfg(test)]
pub(super) fn query_workspace_target(
    conn: &Connection,
    repo_name: &str,
    dir_name: &str,
) -> Option<(String, String)> {
    let sql = format!(
        "SELECT r.remote, COALESCE(w.intended_target_branch, r.default_branch)
		 FROM workspaces w
		 JOIN repos r ON r.id = w.repository_id
		 WHERE r.name = ?1 AND w.directory_name = ?2 AND w.state {}",
        workspace_state::OPERATIONAL_FILTER,
    );
    let mut stmt = conn.prepare(&sql).ok()?;

    stmt.query_row(rusqlite::params![repo_name, dir_name], |row| {
        let remote: Option<String> = row.get(0)?;
        let target: Option<String> = row.get(1)?;
        Ok((remote, target))
    })
    .ok()
    .and_then(|(remote, target)| Some((remote.unwrap_or_else(|| "origin".into()), target?)))
}

fn lookup_workspace_target(workspace_root: &Path) -> Option<(String, String)> {
    let (repo_name, dir_name) = parse_workspace_path(workspace_root)?;
    let repo_name = repo_name.to_string();
    let dir_name = dir_name.to_string();
    match std::thread::spawn(move || {
        tauri::async_runtime::block_on(async {
            lookup_workspace_target_async(&repo_name, &dir_name).await
        })
    })
    .join()
    {
        Ok(target) => target,
        Err(_) => {
            tracing::warn!(
                "workspace target lookup worker panicked; falling back to default target refs",
            );
            None
        }
    }
}

async fn lookup_workspace_target_async(
    repo_name: &str,
    dir_name: &str,
) -> Option<(String, String)> {
    let sql = format!(
        "SELECT r.remote, COALESCE(w.intended_target_branch, r.default_branch)
		 FROM workspaces w
		 JOIN repos r ON r.id = w.repository_id
		 WHERE r.name = ?1 AND w.directory_name = ?2 AND w.state {}",
        workspace_state::OPERATIONAL_FILTER,
    );
    let conn = match db::libsql_conn_async().await {
        Ok(conn) => conn,
        Err(error) => {
            tracing::warn!(
                repo_name,
                dir_name,
                error = %error,
                "Failed to open libSQL DB for workspace target lookup; falling back to default target refs",
            );
            return None;
        }
    };
    let mut rows = match conn
        .query(&sql, [repo_name.to_string(), dir_name.to_string()])
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(
                repo_name,
                dir_name,
                error = %error,
                "workspace target query failed; falling back to default target refs",
            );
            return None;
        }
    };
    let row = match rows.next().await {
        Ok(row) => row,
        Err(error) => {
            tracing::warn!(
                repo_name,
                dir_name,
                error = %error,
                "workspace target row iteration failed; falling back to default target refs",
            );
            return None;
        }
    }?;
    let remote: Option<String> = match row.get(0) {
        Ok(remote) => remote,
        Err(error) => {
            tracing::warn!(
                repo_name,
                dir_name,
                error = %error,
                "workspace target remote decode failed; falling back to default target refs",
            );
            return None;
        }
    };
    let target: Option<String> = match row.get(1) {
        Ok(target) => target,
        Err(error) => {
            tracing::warn!(
                repo_name,
                dir_name,
                error = %error,
                "workspace target branch decode failed; falling back to default target refs",
            );
            return None;
        }
    };
    Some((remote.unwrap_or_else(|| "origin".into()), target?))
}

/// Resolve the target branch ref for diff comparison.
///
/// Returns the ref itself (not a merge-base) so `git diff <ref> HEAD`
/// compares the two branch tips directly. This means identical trees
/// produce zero diff, which is the correct behavior for "Branch Changes".
///
/// Uses a single `git for-each-ref` call to batch-check all candidates
/// instead of N sequential `rev-parse --verify` invocations.
pub(super) fn resolve_target_ref(workspace_root: &Path) -> Result<String> {
    let mut candidates = Vec::<String>::new();

    if let Some((remote, target)) = lookup_workspace_target(workspace_root) {
        candidates.push(format!("refs/remotes/{remote}/{target}"));
        candidates.push(format!("refs/heads/{target}"));
    }

    candidates.push("refs/remotes/origin/main".into());
    candidates.push("refs/remotes/origin/master".into());
    candidates.push("refs/heads/main".into());
    candidates.push("refs/heads/master".into());

    // Batch-check with a single git call.
    let mut args = vec![
        "for-each-ref".to_string(),
        "--format=%(refname)".to_string(),
    ];
    args.extend(candidates.iter().cloned());
    let existing_refs: std::collections::HashSet<String> =
        git_ops::run_git(args.iter().map(|s| s.as_str()), Some(workspace_root))
            .unwrap_or_default()
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();

    for branch in &candidates {
        if existing_refs.contains(branch) {
            return Ok(branch.clone());
        }
    }

    // No target branch found — fall back to the canonical SHA1 empty-tree
    // hash. This is a git constant (identical on every platform and every
    // git version) so we avoid spawning `hash-object -t tree /dev/null`,
    // which relied on `/dev/null` being mappable on Windows git-for-Windows.
    // Reference: https://git-scm.com/book/en/v2/Git-Internals-Git-Objects
    const EMPTY_TREE_SHA1: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    // Silence unused-variable warning — workspace_root is no longer needed
    // here, but we keep the outer signature stable.
    let _ = workspace_root;
    Ok(EMPTY_TREE_SHA1.to_string())
}

fn parse_name_status_into(output: &str, map: &mut BTreeMap<String, String>) {
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let mut parts = line.splitn(2, '\t');
        let Some(raw_status) = parts.next() else {
            continue;
        };
        let Some(path) = parts.next() else {
            continue;
        };

        let status = match raw_status.chars().next() {
            Some('M') => "M",
            Some('A') => "A",
            Some('D') => "D",
            Some('R') => {
                if let Some(new_path) = path.split('\t').nth(1) {
                    map.insert(new_path.to_string(), "A".to_string());
                }
                if let Some(old_path) = path.split('\t').next() {
                    map.insert(old_path.to_string(), "D".to_string());
                }
                continue;
            }
            Some('C') => "A",
            Some('T') => "M",
            _ => "M",
        };

        map.insert(path.to_string(), status.to_string());
    }
}

fn parse_numstat_into(output: &str, map: &mut BTreeMap<String, (u32, u32)>) {
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let mut parts = line.splitn(3, '\t');
        let Some(ins_str) = parts.next() else {
            continue;
        };
        let Some(del_str) = parts.next() else {
            continue;
        };
        let Some(path) = parts.next() else {
            continue;
        };

        let Ok(ins) = ins_str.parse::<u32>() else {
            continue;
        };
        let Ok(del) = del_str.parse::<u32>() else {
            continue;
        };

        let resolved_path = if let Some(arrow_pos) = path.find(" => ") {
            if let Some(brace_start) = path[..arrow_pos].rfind('{') {
                let prefix = &path[..brace_start];
                let new_part = &path[arrow_pos + 4..];
                let suffix = new_part
                    .find('}')
                    .map_or("", |index| &new_part[index + 1..]);
                let new_name = new_part
                    .find('}')
                    .map_or(new_part, |index| &new_part[..index]);
                format!("{prefix}{new_name}{suffix}")
            } else {
                path[arrow_pos + 4..].to_string()
            }
        } else {
            path.to_string()
        };

        let entry = map.entry(resolved_path).or_insert((0, 0));
        entry.0 += ins;
        entry.1 += del;
    }
}

fn count_text_file_lines(path: &Path) -> Option<u32> {
    let content = fs::read_to_string(path).ok()?;
    if content.is_empty() {
        return Some(0);
    }
    let newline_count = content.bytes().filter(|byte| *byte == b'\n').count() as u32;
    Some(if content.ends_with('\n') {
        newline_count
    } else {
        newline_count + 1
    })
}
