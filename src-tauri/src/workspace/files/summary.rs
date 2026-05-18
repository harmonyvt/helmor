use std::{
    fmt::Write as _,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};

use super::{
    changes::{list_workspace_changes, resolve_target_ref},
    editor::get_file_unified_diff,
    types::{
        WorkspaceChangeSummaryContext, WorkspaceChangeSummaryFile, WorkspaceChangeSummaryScope,
        WorkspaceChangeSummarySection,
    },
};
use crate::git_ops;

const MAX_DIFF_BYTES_PER_FILE: usize = 64 * 1024;
const MAX_UNTRACKED_BYTES_PER_FILE: usize = 64 * 1024;

pub fn build_workspace_change_summary_context(
    workspace_root_path: &str,
    scopes: Option<Vec<WorkspaceChangeSummaryScope>>,
) -> Result<WorkspaceChangeSummaryContext> {
    let workspace_root = Path::new(workspace_root_path);
    if !workspace_root.is_absolute() {
        bail!(
            "Workspace root must be an absolute path: {}",
            workspace_root.display()
        );
    }
    if !workspace_root.is_dir() {
        tracing::warn!(
            path = %workspace_root.display(),
            "workspace root missing; returning empty change summary context",
        );
        return Ok(empty_context(workspace_root_path));
    }

    let target_ref = resolve_target_ref(workspace_root)?;
    let head_sha = git_ops::run_git(["rev-parse", "HEAD"], Some(workspace_root))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let items = list_workspace_changes(workspace_root_path)?;
    let scopes = normalize_scopes(scopes);

    let mut sections = Vec::new();
    for scope in scopes {
        let files = items
            .iter()
            .filter_map(|item| {
                let status = status_for_scope(item, scope)?;
                let (diff, diff_truncated) =
                    diff_for_scope(workspace_root, &item.path, status, scope).unwrap_or_else(
                        |error| {
                            tracing::warn!(
                                path = %item.path,
                                scope = ?scope,
                                error = %format!("{error:#}"),
                                "failed to collect change-summary diff",
                            );
                            (None, false)
                        },
                    );
                Some(WorkspaceChangeSummaryFile {
                    path: item.path.clone(),
                    status: status.to_string(),
                    insertions: item.insertions,
                    deletions: item.deletions,
                    diff,
                    diff_truncated,
                })
            })
            .collect::<Vec<_>>();

        if !files.is_empty() {
            sections.push(WorkspaceChangeSummarySection {
                scope,
                title: title_for_scope(scope).to_string(),
                files,
            });
        }
    }

    let fingerprint = fingerprint_context(&target_ref, head_sha.as_deref(), &sections);
    let prompt = build_prompt(&sections);

    Ok(WorkspaceChangeSummaryContext {
        workspace_root_path: workspace_root_path.to_string(),
        target_ref,
        head_sha,
        fingerprint,
        prompt,
        sections,
    })
}

fn empty_context(workspace_root_path: &str) -> WorkspaceChangeSummaryContext {
    WorkspaceChangeSummaryContext {
        workspace_root_path: workspace_root_path.to_string(),
        target_ref: String::new(),
        head_sha: None,
        fingerprint: fingerprint_text(workspace_root_path),
        prompt: build_prompt(&[]),
        sections: Vec::new(),
    }
}

fn normalize_scopes(
    scopes: Option<Vec<WorkspaceChangeSummaryScope>>,
) -> Vec<WorkspaceChangeSummaryScope> {
    let scopes = scopes.unwrap_or_else(|| {
        vec![
            WorkspaceChangeSummaryScope::Branch,
            WorkspaceChangeSummaryScope::Staged,
            WorkspaceChangeSummaryScope::Unstaged,
        ]
    });
    let mut normalized = Vec::new();
    for scope in scopes {
        if !normalized.contains(&scope) {
            normalized.push(scope);
        }
    }
    normalized
}

fn status_for_scope(
    item: &super::types::EditorFileListItem,
    scope: WorkspaceChangeSummaryScope,
) -> Option<&str> {
    match scope {
        WorkspaceChangeSummaryScope::Branch => item.committed_status.as_deref(),
        WorkspaceChangeSummaryScope::Staged => item.staged_status.as_deref(),
        WorkspaceChangeSummaryScope::Unstaged => item.unstaged_status.as_deref(),
    }
}

fn diff_for_scope(
    workspace_root: &Path,
    relative_path: &str,
    status: &str,
    scope: WorkspaceChangeSummaryScope,
) -> Result<(Option<String>, bool)> {
    if scope == WorkspaceChangeSummaryScope::Unstaged && status == "A" {
        let absolute_path = workspace_root.join(relative_path);
        if is_untracked(workspace_root, relative_path) {
            return read_untracked_file_diff(&absolute_path, relative_path);
        }
    }

    let (from_ref, to_ref, cached) = match scope {
        WorkspaceChangeSummaryScope::Branch => {
            let target_ref = resolve_target_ref(workspace_root)?;
            (Some(target_ref), Some("HEAD".to_string()), false)
        }
        WorkspaceChangeSummaryScope::Staged => (None, None, true),
        WorkspaceChangeSummaryScope::Unstaged => (None, None, false),
    };

    let diff = get_file_unified_diff(
        &workspace_root.display().to_string(),
        relative_path,
        from_ref.as_deref(),
        to_ref.as_deref(),
        cached,
    )?;
    Ok(diff.map(|value| truncate_text(&value, MAX_DIFF_BYTES_PER_FILE))).map(|value| match value {
        Some((text, truncated)) => (Some(text), truncated),
        None => (None, false),
    })
}

fn is_untracked(workspace_root: &Path, relative_path: &str) -> bool {
    git_ops::run_git(
        ["ls-files", "--error-unmatch", "--", relative_path],
        Some(workspace_root),
    )
    .is_err()
}

fn read_untracked_file_diff(
    absolute_path: &PathBuf,
    relative_path: &str,
) -> Result<(Option<String>, bool)> {
    let bytes = fs::read(absolute_path)
        .with_context(|| format!("Failed to read untracked file {}", absolute_path.display()))?;
    let (content, truncated) = truncate_bytes(&bytes, MAX_UNTRACKED_BYTES_PER_FILE);
    let text = String::from_utf8(content)
        .with_context(|| format!("Untracked file is not valid UTF-8: {relative_path}"))?;
    let mut diff = format!("diff --git a/{relative_path} b/{relative_path}\nnew file\n");
    for line in text.lines() {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    Ok((Some(diff), truncated))
}

fn truncate_text(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.to_string(), false);
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    let mut truncated = value[..end].to_string();
    truncated.push_str("\n[diff truncated]\n");
    (truncated, true)
}

fn truncate_bytes(bytes: &[u8], max_bytes: usize) -> (Vec<u8>, bool) {
    if bytes.len() <= max_bytes {
        return (bytes.to_vec(), false);
    }
    (bytes[..max_bytes].to_vec(), true)
}

fn title_for_scope(scope: WorkspaceChangeSummaryScope) -> &'static str {
    match scope {
        WorkspaceChangeSummaryScope::Branch => "Branch changes",
        WorkspaceChangeSummaryScope::Staged => "Staged changes",
        WorkspaceChangeSummaryScope::Unstaged => "Unstaged changes",
    }
}

fn build_prompt(sections: &[WorkspaceChangeSummarySection]) -> String {
    let mut prompt = String::from(
        "Summarize these git changes for a human. Focus on intent, user-visible behavior, notable implementation details, and risks or follow-up. Keep it concise and group the summary by branch, staged, and unstaged changes when those sections are present.",
    );
    if sections.is_empty() {
        prompt.push_str("\n\nNo git changes were found.");
        return prompt;
    }

    for section in sections {
        let _ = write!(prompt, "\n\n## {}", section.title);
        for file in &section.files {
            let _ = write!(
                prompt,
                "\n\n### {} ({}, +{}, -{})",
                file.path, file.status, file.insertions, file.deletions
            );
            match &file.diff {
                Some(diff) => {
                    prompt.push_str("\n```diff\n");
                    prompt.push_str(diff);
                    if !diff.ends_with('\n') {
                        prompt.push('\n');
                    }
                    prompt.push_str("```");
                }
                None => prompt.push_str("\nDiff unavailable."),
            }
        }
    }

    prompt
}

fn fingerprint_context(
    target_ref: &str,
    head_sha: Option<&str>,
    sections: &[WorkspaceChangeSummarySection],
) -> String {
    let mut value = String::new();
    value.push_str(target_ref);
    value.push('\n');
    if let Some(head_sha) = head_sha {
        value.push_str(head_sha);
    }
    for section in sections {
        let _ = write!(value, "\n{:?}", section.scope);
        for file in &section.files {
            let _ = write!(
                value,
                "\n{}\t{}\t{}\t{}\t{}",
                file.path,
                file.status,
                file.insertions,
                file.deletions,
                file.diff.as_deref().unwrap_or("")
            );
        }
    }
    fingerprint_text(&value)
}

fn fingerprint_text(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::files::tests::support::GitRepoHarness;

    #[test]
    fn context_groups_branch_staged_and_unstaged_changes() {
        let repo = GitRepoHarness::new();
        repo.write_file("branch.ts", "export const branch = true;\n");
        repo.git(&["add", "branch.ts"]);
        repo.git(&["commit", "-m", "branch change"]);
        repo.write_file("staged.ts", "export const staged = true;\n");
        repo.git(&["add", "staged.ts"]);
        repo.write_file("unstaged.ts", "export const unstaged = true;\n");

        let context = build_workspace_change_summary_context(repo.path_str(), None).unwrap();

        assert_eq!(context.sections.len(), 3);
        assert_eq!(
            context.sections[0].scope,
            WorkspaceChangeSummaryScope::Branch
        );
        assert_eq!(context.sections[0].files[0].path, "branch.ts");
        assert_eq!(
            context.sections[1].scope,
            WorkspaceChangeSummaryScope::Staged
        );
        assert_eq!(context.sections[1].files[0].path, "staged.ts");
        assert_eq!(
            context.sections[2].scope,
            WorkspaceChangeSummaryScope::Unstaged
        );
        assert_eq!(context.sections[2].files[0].path, "unstaged.ts");
        assert!(context.prompt.contains("## Branch changes"));
        assert!(context.prompt.contains("```diff"));
        assert!(!context.fingerprint.is_empty());
    }

    #[test]
    fn context_can_focus_on_one_scope() {
        let repo = GitRepoHarness::new();
        repo.write_file("only-unstaged.ts", "export const value = true;\n");

        let context = build_workspace_change_summary_context(
            repo.path_str(),
            Some(vec![WorkspaceChangeSummaryScope::Unstaged]),
        )
        .unwrap();

        assert_eq!(context.sections.len(), 1);
        assert_eq!(
            context.sections[0].scope,
            WorkspaceChangeSummaryScope::Unstaged
        );
        assert_eq!(context.sections[0].files[0].path, "only-unstaged.ts");
        assert!(context.prompt.contains("+export const value = true;"));
    }
}
