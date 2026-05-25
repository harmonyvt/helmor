//! Workspace file enumeration for the code-graph builder.
//!
//! Reuses the same ignore rules as the inspector's editor file walker
//! (`workspace/files/support.rs`) — `.git`, `node_modules`, `dist`,
//! `target`, hidden dirs etc. — but operates without the 48-file cap.

use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};

use super::types::CodeGraphLanguage;

/// Files larger than this are listed as nodes but their edges are left
/// empty — parsing a 2 MB minified bundle produces a hairball of useless
/// edges and stalls tree-sitter.
pub const MAX_PARSE_BYTES: u64 = 512 * 1024;

/// Hard upper bound on the number of source files we walk. Prevents the
/// build from melting on pathological repos (a renderer's `node_modules`
/// leakage, vendored sources, generated migrations, etc.).
pub const MAX_FILES: usize = 20_000;

/// One enumerated source file with the data the builder needs.
#[derive(Debug, Clone)]
pub struct WalkedFile {
    pub absolute_path: PathBuf,
    pub relative_path: String,
    pub language: CodeGraphLanguage,
    pub size_bytes: u64,
}

pub fn walk_workspace(workspace_root: &Path) -> Result<Vec<WalkedFile>> {
    let mut out = Vec::new();
    walk_dir(workspace_root, workspace_root, &mut out)?;
    out.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(out)
}

fn walk_dir(workspace_root: &Path, current_dir: &Path, out: &mut Vec<WalkedFile>) -> Result<()> {
    if out.len() >= MAX_FILES {
        return Ok(());
    }

    let read_dir = match fs::read_dir(current_dir) {
        Ok(iter) => iter,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            tracing::warn!(
                path = %current_dir.display(),
                "skipping missing dir during code-graph walk",
            );
            return Ok(());
        }
        Err(error) => {
            return Err(error).with_context(|| {
                format!(
                    "Failed to read directory during code-graph walk: {}",
                    current_dir.display()
                )
            })
        }
    };

    let mut entries = read_dir
        .collect::<std::result::Result<Vec<_>, _>>()
        .with_context(|| {
            format!(
                "Failed to iterate directory during code-graph walk: {}",
                current_dir.display()
            )
        })?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        if out.len() >= MAX_FILES {
            break;
        }

        let entry_path = entry.path();
        let file_type = entry
            .file_type()
            .with_context(|| format!("Failed to inspect entry {}", entry_path.display()))?;

        if file_type.is_dir() {
            if should_skip_dir(workspace_root, &entry_path) {
                continue;
            }
            walk_dir(workspace_root, &entry_path, out)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let Some(language) = entry_path
            .extension()
            .and_then(|value| value.to_str())
            .and_then(CodeGraphLanguage::from_extension)
        else {
            continue;
        };

        let metadata = match entry.metadata() {
            Ok(meta) => meta,
            Err(error) => {
                tracing::warn!(
                    path = %entry_path.display(),
                    error = %error,
                    "skipping file with unreadable metadata",
                );
                continue;
            }
        };

        let Ok(relative_path) = entry_path.strip_prefix(workspace_root) else {
            continue;
        };
        let relative_string = relative_path.to_string_lossy().replace('\\', "/");

        out.push(WalkedFile {
            absolute_path: entry_path.clone(),
            relative_path: relative_string,
            language,
            size_bytes: metadata.len(),
        });
    }

    Ok(())
}

fn should_skip_dir(workspace_root: &Path, path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return true;
    };

    matches!(
        name,
        ".git"
            | "node_modules"
            | "dist"
            | "build"
            | "coverage"
            | "target"
            | ".next"
            | ".turbo"
            | ".cache"
            | ".venv"
            | "__pycache__"
            | ".helmor"
            | "out"
            | ".storybook-cache"
    ) || (name.starts_with('.') && path != workspace_root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, File};
    use std::io::Write;

    #[test]
    fn walk_skips_node_modules_and_dotdirs_and_picks_up_languages() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        create_dir_all(root.join("src")).unwrap();
        create_dir_all(root.join("node_modules/foo")).unwrap();
        create_dir_all(root.join(".git/objects")).unwrap();

        File::create(root.join("src/a.ts"))
            .unwrap()
            .write_all(b"export const x = 1;\n")
            .unwrap();
        File::create(root.join("src/b.rs"))
            .unwrap()
            .write_all(b"pub fn foo() {}\n")
            .unwrap();
        File::create(root.join("src/c.py"))
            .unwrap()
            .write_all(b"x = 1\n")
            .unwrap();
        File::create(root.join("node_modules/foo/index.js"))
            .unwrap()
            .write_all(b"module.exports = {};")
            .unwrap();

        let files = walk_workspace(root).unwrap();
        let paths: Vec<_> = files.iter().map(|f| f.relative_path.clone()).collect();
        assert!(paths.iter().any(|p| p == "src/a.ts"));
        assert!(paths.iter().any(|p| p == "src/b.rs"));
        assert!(paths.iter().any(|p| p == "src/c.py"));
        assert!(!paths.iter().any(|p| p.contains("node_modules")));
        assert!(!paths.iter().any(|p| p.starts_with(".git")));
    }
}
