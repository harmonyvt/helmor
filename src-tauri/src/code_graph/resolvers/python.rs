//! Python import resolver.
//!
//! - `rel:N:tail` → walk up N levels from the importing file's dir, then
//!   resolve `tail` (dotted module name) against `{path}/__init__.py` or
//!   `{path}.py`.
//! - `abs:dotted.name` → try `{project_root}/dotted/name.py` and
//!   `{project_root}/dotted/name/__init__.py` for each known package root
//!   (directories containing `pyproject.toml` or `__init__.py`-rooted
//!   trees). Falls back to `External` if nothing matches.

use std::{collections::HashSet, path::Path};

use super::Resolution;

#[derive(Debug, Clone, Default)]
pub struct PythonResolverContext {
    pub known_files: HashSet<String>,
    /// Workspace-relative directories that can sit at the top of a
    /// dotted import path (project roots). The walker discovers these by
    /// finding directories with `pyproject.toml`.
    pub package_roots: Vec<String>,
}

pub struct PythonResolver<'a> {
    ctx: &'a PythonResolverContext,
}

impl<'a> PythonResolver<'a> {
    pub fn new(ctx: &'a PythonResolverContext) -> Self {
        Self { ctx }
    }

    pub fn resolve(&self, from_file: &str, specifier: &str) -> Resolution {
        if let Some(abs) = specifier.strip_prefix("abs:") {
            return self.resolve_absolute(abs);
        }
        if let Some(rest) = specifier.strip_prefix("rel:") {
            // rel:N:tail
            let mut split = rest.splitn(2, ':');
            let dots: u32 = split.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let tail = split.next().unwrap_or("");
            return self.resolve_relative(from_file, dots, tail);
        }
        Resolution::Unknown
    }

    fn resolve_relative(&self, from_file: &str, dots: u32, tail: &str) -> Resolution {
        let mut dir = match Path::new(from_file).parent() {
            Some(p) => p.to_path_buf(),
            None => return Resolution::Unknown,
        };
        for _ in 1..dots {
            dir = match dir.parent() {
                Some(p) => p.to_path_buf(),
                None => return Resolution::Unknown,
            };
        }
        let target = dotted_to_relative(tail);
        let prefix = dir.to_string_lossy().replace('\\', "/");
        for candidate in candidate_paths(&prefix, &target) {
            if self.ctx.known_files.contains(&candidate) {
                return Resolution::File {
                    relative_path: candidate,
                };
            }
        }
        Resolution::Unknown
    }

    fn resolve_absolute(&self, dotted: &str) -> Resolution {
        let target = dotted_to_relative(dotted);
        for root in &self.ctx.package_roots {
            for candidate in candidate_paths(root, &target) {
                if self.ctx.known_files.contains(&candidate) {
                    return Resolution::File {
                        relative_path: candidate,
                    };
                }
            }
        }
        Resolution::External {
            package: dotted.split('.').next().unwrap_or(dotted).to_string(),
        }
    }
}

fn dotted_to_relative(dotted: &str) -> String {
    dotted.replace('.', "/")
}

fn candidate_paths(prefix: &str, target: &str) -> Vec<String> {
    let mut out = Vec::new();
    let base = if prefix.is_empty() {
        target.to_string()
    } else if target.is_empty() {
        prefix.to_string()
    } else {
        format!("{}/{}", prefix.trim_end_matches('/'), target)
    };
    out.push(format!("{base}.py"));
    out.push(format!("{base}/__init__.py"));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx_with(files: &[&str], roots: &[&str]) -> PythonResolverContext {
        PythonResolverContext {
            known_files: files.iter().map(|f| f.to_string()).collect(),
            package_roots: roots.iter().map(|f| f.to_string()).collect(),
        }
    }

    #[test]
    fn absolute_dotted_resolves_in_package_root() {
        let ctx = ctx_with(
            &["knowledge-sidecar/src/pkg/foo.py"],
            &["knowledge-sidecar/src"],
        );
        let r = PythonResolver::new(&ctx);
        match r.resolve("knowledge-sidecar/src/main.py", "abs:pkg.foo") {
            Resolution::File { relative_path } => {
                assert_eq!(relative_path, "knowledge-sidecar/src/pkg/foo.py");
            }
            other => panic!("expected File, got {other:?}"),
        }
    }

    #[test]
    fn relative_one_dot_resolves_sibling() {
        let ctx = ctx_with(&["pkg/bar.py", "pkg/__init__.py"], &[]);
        let r = PythonResolver::new(&ctx);
        match r.resolve("pkg/main.py", "rel:1:bar") {
            Resolution::File { relative_path } => assert_eq!(relative_path, "pkg/bar.py"),
            other => panic!("expected File, got {other:?}"),
        }
    }

    #[test]
    fn unknown_absolute_becomes_external() {
        let ctx = ctx_with(&[], &["src"]);
        let r = PythonResolver::new(&ctx);
        match r.resolve("src/main.py", "abs:numpy.linalg") {
            Resolution::External { package } => assert_eq!(package, "numpy"),
            other => panic!("expected External, got {other:?}"),
        }
    }
}
