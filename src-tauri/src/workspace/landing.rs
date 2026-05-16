use std::{fmt, path::Path, str::FromStr};

use anyhow::{bail, Context, Result};
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

use crate::{
    db, git_ops,
    models::workspaces::{self as workspace_models, WorkspaceRecord},
    workspace_kind::WorkspaceKind,
    workspace_pr_sync::PrSyncState,
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LandingState {
    #[default]
    Unlanded,
    Landed,
    Unknown,
}

impl LandingState {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Unlanded => "unlanded",
            Self::Landed => "landed",
            Self::Unknown => "unknown",
        }
    }
}

impl fmt::Display for LandingState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug)]
pub struct UnknownLandingState(pub String);

impl fmt::Display for UnknownLandingState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown workspace landing_state: {:?}", self.0)
    }
}

impl std::error::Error for UnknownLandingState {}

impl FromStr for LandingState {
    type Err = UnknownLandingState;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "" | "unlanded" => Ok(Self::Unlanded),
            "landed" => Ok(Self::Landed),
            "unknown" => Ok(Self::Unknown),
            _ => Err(UnknownLandingState(s.to_string())),
        }
    }
}

impl FromSql for LandingState {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?;
        s.parse()
            .map_err(|e: UnknownLandingState| FromSqlError::Other(Box::new(e)))
    }
}

impl ToSql for LandingState {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::Borrowed(ValueRef::Text(
            self.as_str().as_bytes(),
        )))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LandingSource {
    PullRequest,
    BranchAncestry,
    ManualRepair,
}

impl LandingSource {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::PullRequest => "pull-request",
            Self::BranchAncestry => "branch-ancestry",
            Self::ManualRepair => "manual-repair",
        }
    }
}

impl fmt::Display for LandingSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug)]
pub struct UnknownLandingSource(pub String);

impl fmt::Display for UnknownLandingSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown workspace landing_source: {:?}", self.0)
    }
}

impl std::error::Error for UnknownLandingSource {}

impl FromStr for LandingSource {
    type Err = UnknownLandingSource;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "pull-request" => Ok(Self::PullRequest),
            "branch-ancestry" => Ok(Self::BranchAncestry),
            "manual-repair" => Ok(Self::ManualRepair),
            _ => Err(UnknownLandingSource(s.to_string())),
        }
    }
}

impl FromSql for LandingSource {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?;
        s.parse()
            .map_err(|e: UnknownLandingSource| FromSqlError::Other(Box::new(e)))
    }
}

impl ToSql for LandingSource {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::Borrowed(ValueRef::Text(
            self.as_str().as_bytes(),
        )))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LandingReconcileResponse {
    pub workspace_id: String,
    pub landing_state: LandingState,
    pub landing_source: Option<LandingSource>,
    pub landed_at: Option<String>,
    pub landed_target_branch: Option<String>,
    pub landed_source_ref: Option<String>,
    pub landed_commit_sha: Option<String>,
    pub last_known_head_sha: Option<String>,
    pub changed: bool,
}

#[derive(Debug, Clone)]
struct LandingDetection {
    state: LandingState,
    source: Option<LandingSource>,
    target_branch: Option<String>,
    source_ref: Option<String>,
    commit_sha: Option<String>,
    last_known_head_sha: Option<String>,
}

pub fn reconcile_workspace_landing_state(workspace_id: &str) -> Result<LandingReconcileResponse> {
    let record = workspace_models::load_workspace_record_by_id(workspace_id)?
        .with_context(|| format!("Workspace not found: {workspace_id}"))?;
    let changed = reconcile_workspace_landing_record(&record)?;
    let refreshed = workspace_models::load_workspace_record_by_id(workspace_id)?
        .with_context(|| format!("Workspace not found after landing reconcile: {workspace_id}"))?;
    Ok(response_from_record(refreshed, changed))
}

pub fn reconcile_goal_child_landing_states(records: &[WorkspaceRecord]) -> Result<bool> {
    let mut changed = false;
    for record in records {
        changed |= reconcile_workspace_landing_record(record)?;
    }
    Ok(changed)
}

pub fn mark_workspace_landed_from_pull_request(workspace_id: &str) -> Result<bool> {
    let record = workspace_models::load_workspace_record_by_id(workspace_id)?
        .with_context(|| format!("Workspace not found: {workspace_id}"))?;
    let workspace_dir = workspace_dir_for_record(&record).ok();
    let last_known_head_sha = workspace_dir
        .as_deref()
        .and_then(|dir| preferred_head_sha(dir, &record));
    persist_landing(
        &record,
        LandingState::Landed,
        Some(LandingSource::PullRequest),
        record.intended_target_branch.clone(),
        record.branch.clone(),
        last_known_head_sha.clone(),
        last_known_head_sha,
    )
}

pub fn mark_workspace_landed_manually(workspace_id: &str) -> Result<LandingReconcileResponse> {
    let record = workspace_models::load_workspace_record_by_id(workspace_id)?
        .with_context(|| format!("Workspace not found: {workspace_id}"))?;
    let workspace_dir = workspace_dir_for_record(&record).ok();
    let last_known_head_sha = workspace_dir
        .as_deref()
        .and_then(|dir| preferred_head_sha(dir, &record));
    let changed = persist_landing(
        &record,
        LandingState::Landed,
        Some(LandingSource::ManualRepair),
        record.intended_target_branch.clone(),
        record.branch.clone(),
        last_known_head_sha.clone(),
        last_known_head_sha,
    )?;
    let refreshed = workspace_models::load_workspace_record_by_id(workspace_id)?
        .with_context(|| format!("Workspace not found after manual landing: {workspace_id}"))?;
    Ok(response_from_record(refreshed, changed))
}

fn reconcile_workspace_landing_record(record: &WorkspaceRecord) -> Result<bool> {
    if !record.state.is_operational() {
        return Ok(false);
    }
    if record.pr_sync_state == PrSyncState::Merged {
        return mark_workspace_landed_from_pull_request(&record.id);
    }

    let detection = detect_landing_by_branch_ancestry(record);
    if record.landing_state == LandingState::Landed && detection.state != LandingState::Landed {
        return Ok(false);
    }

    persist_landing(
        record,
        detection.state,
        detection.source,
        detection.target_branch,
        detection.source_ref,
        detection.commit_sha,
        detection.last_known_head_sha,
    )
}

fn detect_landing_by_branch_ancestry(record: &WorkspaceRecord) -> LandingDetection {
    let unknown = || LandingDetection {
        state: LandingState::Unknown,
        source: None,
        target_branch: record.intended_target_branch.clone(),
        source_ref: record.branch.clone(),
        commit_sha: record.last_known_head_sha.clone(),
        last_known_head_sha: record.last_known_head_sha.clone(),
    };

    if record.workspace_kind != WorkspaceKind::Code || record.goal_workspace_id.is_none() {
        return LandingDetection {
            state: LandingState::Unlanded,
            source: None,
            target_branch: record.intended_target_branch.clone(),
            source_ref: record.branch.clone(),
            commit_sha: record.last_known_head_sha.clone(),
            last_known_head_sha: record.last_known_head_sha.clone(),
        };
    }

    let Some(source_branch) = non_empty(record.branch.as_deref()) else {
        return unknown();
    };
    let Some(target_branch) = non_empty(record.intended_target_branch.as_deref()) else {
        return unknown();
    };
    if source_branch == target_branch {
        return LandingDetection {
            state: LandingState::Unlanded,
            source: None,
            target_branch: Some(target_branch.to_string()),
            source_ref: Some(source_branch.to_string()),
            commit_sha: record.last_known_head_sha.clone(),
            last_known_head_sha: record.last_known_head_sha.clone(),
        };
    }

    let Ok(workspace_dir) = workspace_dir_for_record(record) else {
        return unknown();
    };
    if !workspace_dir.is_dir() {
        return unknown();
    }

    let mut fetch_failed = false;
    if let Some(remote) = non_empty(record.remote.as_deref()) {
        if git_ops::fetch_remote_branch_refspec(&workspace_dir, remote, target_branch).is_err() {
            fetch_failed = true;
        }
        if git_ops::fetch_remote_branch_refspec(&workspace_dir, remote, source_branch).is_err() {
            fetch_failed = true;
        }
    }

    let source = resolve_source_ref(&workspace_dir, record, source_branch);
    let target = resolve_target_ref(&workspace_dir, record, target_branch);
    let head_sha = source
        .as_ref()
        .map(|source| source.commit_sha.clone())
        .or_else(|| preferred_head_sha(&workspace_dir, record));

    let Some(source) = source else {
        return if fetch_failed {
            unknown()
        } else {
            LandingDetection {
                state: LandingState::Unknown,
                source: None,
                target_branch: Some(target_branch.to_string()),
                source_ref: Some(source_branch.to_string()),
                commit_sha: record.last_known_head_sha.clone(),
                last_known_head_sha: head_sha,
            }
        };
    };
    let Some(target_ref) = target else {
        return if fetch_failed {
            unknown()
        } else {
            LandingDetection {
                state: LandingState::Unknown,
                source: None,
                target_branch: Some(target_branch.to_string()),
                source_ref: Some(source.name),
                commit_sha: Some(source.commit_sha),
                last_known_head_sha: head_sha,
            }
        };
    };

    let landed =
        git_ops::is_ancestor_of(&workspace_dir, &source.commit_sha, &target_ref).unwrap_or(false);
    LandingDetection {
        state: if landed {
            LandingState::Landed
        } else {
            LandingState::Unlanded
        },
        source: landed.then_some(LandingSource::BranchAncestry),
        target_branch: Some(target_branch.to_string()),
        source_ref: Some(source.name),
        commit_sha: Some(source.commit_sha),
        last_known_head_sha: head_sha,
    }
}

struct ResolvedSource {
    name: String,
    commit_sha: String,
}

fn resolve_source_ref(
    workspace_dir: &Path,
    record: &WorkspaceRecord,
    source_branch: &str,
) -> Option<ResolvedSource> {
    if record.landing_state == LandingState::Landed {
        if let Some(sha) = record
            .last_known_head_sha
            .as_deref()
            .and_then(|sha| resolve_commit_sha(workspace_dir, sha))
        {
            return Some(ResolvedSource {
                name: sha.clone(),
                commit_sha: sha,
            });
        }
    }

    for candidate in source_candidates(record, source_branch) {
        if let Some(commit_sha) = resolve_commit_sha(workspace_dir, &candidate) {
            return Some(ResolvedSource {
                name: candidate,
                commit_sha,
            });
        }
    }
    if let Some(sha) = record
        .last_known_head_sha
        .as_deref()
        .and_then(|sha| resolve_commit_sha(workspace_dir, sha))
    {
        return Some(ResolvedSource {
            name: sha.clone(),
            commit_sha: sha,
        });
    }
    None
}

fn source_candidates(record: &WorkspaceRecord, source_branch: &str) -> Vec<String> {
    let mut candidates = vec![source_branch.to_string()];
    if let Some(remote) = non_empty(record.remote.as_deref()) {
        candidates.push(format!("refs/remotes/{remote}/{source_branch}"));
    }
    candidates.push("HEAD".to_string());
    candidates
}

fn resolve_target_ref(
    workspace_dir: &Path,
    record: &WorkspaceRecord,
    target_branch: &str,
) -> Option<String> {
    let mut candidates = Vec::new();
    if let Some(remote) = non_empty(record.remote.as_deref()) {
        candidates.push(format!("refs/remotes/{remote}/{target_branch}"));
    }
    candidates.push(target_branch.to_string());

    candidates
        .into_iter()
        .find(|candidate| git_ops::ref_exists(workspace_dir, candidate))
}

fn preferred_head_sha(workspace_dir: &Path, record: &WorkspaceRecord) -> Option<String> {
    record
        .branch
        .as_deref()
        .and_then(|branch| resolve_commit_sha(workspace_dir, branch))
        .or_else(|| resolve_commit_sha(workspace_dir, "HEAD"))
}

fn resolve_commit_sha(workspace_dir: &Path, ref_name: &str) -> Option<String> {
    let spec = format!("{ref_name}^{{commit}}");
    let workspace_dir = workspace_dir.display().to_string();
    git_ops::run_git(
        [
            "-C",
            workspace_dir.as_str(),
            "rev-parse",
            "--verify",
            "--quiet",
            spec.as_str(),
        ],
        None,
    )
    .ok()
    .filter(|value| !value.trim().is_empty())
}

fn persist_landing(
    record: &WorkspaceRecord,
    state: LandingState,
    source: Option<LandingSource>,
    target_branch: Option<String>,
    source_ref: Option<String>,
    commit_sha: Option<String>,
    last_known_head_sha: Option<String>,
) -> Result<bool> {
    if record.landing_state == LandingState::Landed && state != LandingState::Landed {
        return Ok(false);
    }

    let (source, target_branch, source_ref, commit_sha) = if state == LandingState::Landed {
        (source, target_branch, source_ref, commit_sha)
    } else {
        (None, None, None, None)
    };
    let landed_fields_changed = record.landed_target_branch != target_branch
        || record.landed_source_ref != source_ref
        || record.landed_commit_sha != commit_sha;
    let changed = record.landing_state != state
        || record.landing_source != source
        || landed_fields_changed
        || record.last_known_head_sha != last_known_head_sha;
    if !changed {
        return Ok(false);
    }

    let connection = db::write_conn()?;
    let landed_at_sql = if state == LandingState::Landed && record.landed_at.is_none() {
        "datetime('now')"
    } else if state == LandingState::Landed {
        "landed_at"
    } else {
        "NULL"
    };
    let sql = format!(
        r#"
        UPDATE workspaces
        SET landing_state = ?2,
            landing_source = ?3,
            landed_at = {landed_at_sql},
            landed_target_branch = ?4,
            landed_source_ref = ?5,
            landed_commit_sha = ?6,
            last_known_head_sha = ?7,
            updated_at = datetime('now')
        WHERE id = ?1
        "#
    );
    let updated = connection
        .execute(
            &sql,
            rusqlite::params![
                record.id,
                state,
                source,
                target_branch,
                source_ref,
                commit_sha,
                last_known_head_sha,
            ],
        )
        .context("Failed to persist workspace landing state")?;
    if updated != 1 {
        bail!(
            "Workspace landing update affected {updated} rows for {}",
            record.id
        );
    }
    Ok(true)
}

fn response_from_record(record: WorkspaceRecord, changed: bool) -> LandingReconcileResponse {
    LandingReconcileResponse {
        workspace_id: record.id,
        landing_state: record.landing_state,
        landing_source: record.landing_source,
        landed_at: record.landed_at,
        landed_target_branch: record.landed_target_branch,
        landed_source_ref: record.landed_source_ref,
        landed_commit_sha: record.landed_commit_sha,
        last_known_head_sha: record.last_known_head_sha,
        changed,
    }
}

fn workspace_dir_for_record(record: &WorkspaceRecord) -> Result<std::path::PathBuf> {
    crate::data_dir::workspace_dir(&record.repo_name, &record.directory_name)
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_landing_state_storage_values() {
        assert_eq!(
            "unlanded".parse::<LandingState>().unwrap(),
            LandingState::Unlanded
        );
        assert_eq!(
            "LANDED".parse::<LandingState>().unwrap(),
            LandingState::Landed
        );
        assert_eq!(
            " unknown ".parse::<LandingState>().unwrap(),
            LandingState::Unknown
        );
    }
}
