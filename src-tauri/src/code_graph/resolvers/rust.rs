//! Rust `use` and `mod` resolver.
//!
//! Strategy: Resolve `mod foo;` against the same directory as the
//! declaring file (`foo.rs` or `foo/mod.rs`). For `use crate::a::b`,
//! find the nearest crate root (Cargo.toml directory) walking up from
//! the declaring file, then walk down `src/a/b{.rs,/mod.rs}` matching
//! against the known-file set.
//!
//! External crates (anything not anchored at `crate::`/`super::`/`self::`)
//! are surfaced as `External` with the leading segment as the package
//! name.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use super::Resolution;

#[derive(Debug, Clone, Default)]
pub struct RustResolverContext {
    pub known_files: HashSet<String>,
    /// Workspace-relative paths of directories containing `Cargo.toml`.
    /// Used as crate roots for `crate::...` resolution.
    pub crate_roots: Vec<String>,
}

pub struct RustResolver<'a> {
    ctx: &'a RustResolverContext,
}

impl<'a> RustResolver<'a> {
    pub fn new(ctx: &'a RustResolverContext) -> Self {
        Self { ctx }
    }

    pub fn resolve(&self, from_file: &str, specifier: &str) -> Resolution {
        if let Some(name) = specifier.strip_prefix("mod:") {
            return self.resolve_mod(from_file, name);
        }
        if let Some(use_path) = specifier.strip_prefix("use:") {
            return self.resolve_use(from_file, use_path);
        }
        Resolution::Unknown
    }

    fn resolve_mod(&self, from_file: &str, name: &str) -> Resolution {
        let from = Path::new(from_file);
        let dir_holder = from.parent().unwrap_or_else(|| Path::new(""));
        let base_dir = if from
            .file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s == "mod" || s == "lib" || s == "main")
        {
            dir_holder.to_path_buf()
        } else {
            // `foo.rs` declaring `mod bar;` looks in `foo/bar.rs` or
            // `foo/bar/mod.rs`.
            let stem = from.file_stem().map(PathBuf::from).unwrap_or_default();
            dir_holder.join(stem)
        };
        let candidates = [
            base_dir.join(format!("{name}.rs")),
            base_dir.join(name).join("mod.rs"),
        ];
        for cand in candidates {
            let normalised = cand.to_string_lossy().replace('\\', "/");
            if self.ctx.known_files.contains(&normalised) {
                return Resolution::File {
                    relative_path: normalised,
                };
            }
        }
        Resolution::Unknown
    }

    fn resolve_use(&self, from_file: &str, use_path: &str) -> Resolution {
        let segments: Vec<&str> = use_path.split("::").collect();
        let Some(first) = segments.first() else {
            return Resolution::Unknown;
        };
        let rest = &segments[1..];

        match *first {
            "crate" => {
                let crate_root = nearest_crate_root(&self.ctx.crate_roots, from_file);
                if let Some(root) = crate_root {
                    self.walk_into(&root, "src", rest)
                } else {
                    Resolution::Unknown
                }
            }
            "self" => {
                let dir = Path::new(from_file)
                    .parent()
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                self.walk_into("", &dir, rest)
            }
            "super" => {
                let parent = Path::new(from_file)
                    .parent()
                    .and_then(|p| p.parent())
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                self.walk_into("", &parent, rest)
            }
            other => {
                // Treat as an external crate or a sibling workspace member.
                // If we have a crate root with that name, treat as in-tree;
                // otherwise external.
                for root in &self.ctx.crate_roots {
                    let root_name = Path::new(root)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("");
                    if root_name == other {
                        return self.walk_into(root, "src", rest);
                    }
                }
                Resolution::External {
                    package: other.to_string(),
                }
            }
        }
    }

    fn walk_into(&self, crate_root: &str, src_dir: &str, rest: &[&str]) -> Resolution {
        let mut cur = if crate_root.is_empty() {
            PathBuf::from(src_dir)
        } else {
            PathBuf::from(crate_root).join(src_dir)
        };
        if rest.is_empty() {
            // `use crate::*` → match lib.rs / mod.rs.
            for filename in ["lib.rs", "mod.rs", "main.rs"] {
                let candidate = cur.join(filename);
                let normalised = candidate.to_string_lossy().replace('\\', "/");
                if self.ctx.known_files.contains(&normalised) {
                    return Resolution::File {
                        relative_path: normalised,
                    };
                }
            }
            return Resolution::Unknown;
        }
        // Walk down all but the last segment, looking for module dirs.
        let mut last_resolved: Option<String> = None;
        for (idx, seg) in rest.iter().enumerate() {
            let is_last = idx == rest.len() - 1;
            let as_file = cur.join(format!("{seg}.rs"));
            let as_mod = cur.join(seg).join("mod.rs");
            let as_file_norm = as_file.to_string_lossy().replace('\\', "/");
            let as_mod_norm = as_mod.to_string_lossy().replace('\\', "/");

            if self.ctx.known_files.contains(&as_file_norm) {
                last_resolved = Some(as_file_norm);
                if is_last {
                    break;
                }
                // The segment was a leaf file but more segments follow —
                // those are items inside the file. Stop here; the file is
                // still the right edge target.
                break;
            }
            if self.ctx.known_files.contains(&as_mod_norm) {
                last_resolved = Some(as_mod_norm);
                cur = cur.join(seg);
                continue;
            }
            // Bail with whatever we last resolved.
            break;
        }
        match last_resolved {
            Some(path) => Resolution::File {
                relative_path: path,
            },
            None => Resolution::Unknown,
        }
    }
}

fn nearest_crate_root(crate_roots: &[String], from_file: &str) -> Option<String> {
    let mut best: Option<&String> = None;
    let mut best_len = 0usize;
    for root in crate_roots {
        let prefix = if root.is_empty() {
            String::new()
        } else {
            format!("{root}/")
        };
        if from_file.starts_with(&prefix) && prefix.len() > best_len {
            best_len = prefix.len();
            best = Some(root);
        }
    }
    best.cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx_with(files: &[&str], crates: &[&str]) -> RustResolverContext {
        RustResolverContext {
            known_files: files.iter().map(|f| f.to_string()).collect(),
            crate_roots: crates.iter().map(|f| f.to_string()).collect(),
        }
    }

    #[test]
    fn resolves_inline_mod_to_sibling_file() {
        let ctx = ctx_with(&["src-tauri/src/code_graph/walker.rs"], &["src-tauri"]);
        let r = RustResolver::new(&ctx);
        match r.resolve("src-tauri/src/code_graph/mod.rs", "mod:walker") {
            Resolution::File { relative_path } => {
                assert_eq!(relative_path, "src-tauri/src/code_graph/walker.rs");
            }
            other => panic!("expected File, got {other:?}"),
        }
    }

    #[test]
    fn resolves_use_crate_segments() {
        let ctx = ctx_with(
            &[
                "src-tauri/src/lib.rs",
                "src-tauri/src/code_graph/mod.rs",
                "src-tauri/src/code_graph/walker.rs",
            ],
            &["src-tauri"],
        );
        let r = RustResolver::new(&ctx);
        match r.resolve(
            "src-tauri/src/lib.rs",
            "use:crate::code_graph::walker::walk_workspace",
        ) {
            Resolution::File { relative_path } => {
                assert_eq!(relative_path, "src-tauri/src/code_graph/walker.rs");
            }
            other => panic!("expected File, got {other:?}"),
        }
    }

    #[test]
    fn external_crates_surface_as_external() {
        let ctx = ctx_with(&[], &["src-tauri"]);
        let r = RustResolver::new(&ctx);
        match r.resolve("src-tauri/src/lib.rs", "use:serde::Serialize") {
            Resolution::External { package } => assert_eq!(package, "serde"),
            other => panic!("expected External, got {other:?}"),
        }
    }
}
