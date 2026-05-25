//! Top-level pipeline: walk → hash-diff → parse changed → resolve →
//! assemble the `CodeGraph` and persist updated cache rows.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    sync::atomic::{AtomicU32, Ordering},
    time::SystemTime,
};

use anyhow::{Context, Result};
use tauri::ipc::Channel;

use super::{
    cache::{self, CachedFileEdges, WorkspaceEdgeCache},
    hash::hash_bytes,
    parsers::parser_for,
    resolvers::{
        self,
        python::PythonResolverContext,
        rust::RustResolverContext,
        ts_js::{discover_aliases, TsResolverContext},
    },
    types::{
        BuildProgress, CodeGraph, CodeGraphEdge, CodeGraphLanguage, CodeGraphNode, CodeGraphStats,
    },
    walker::{walk_workspace, WalkedFile, MAX_PARSE_BYTES},
};
use crate::{editor_files::list_workspace_changes, git_ops};

/// Build (or refresh) the code graph for a workspace.
pub fn build_code_graph(
    workspace_id: &str,
    workspace_root: &Path,
    channel: Option<&Channel<BuildProgress>>,
) -> Result<CodeGraph> {
    // 1. Walk the workspace.
    let files = walk_workspace(workspace_root).context("walk_workspace failed")?;
    send_progress(
        channel,
        BuildProgress::Walking {
            discovered: files.len() as u32,
        },
    );

    let present_paths: HashSet<String> = files.iter().map(|f| f.relative_path.clone()).collect();

    // 2. Load existing cache rows for unchanged-content reuse.
    let mut existing_cache = cache::load_workspace_cache(workspace_id).unwrap_or_default();
    let parsed_counter = AtomicU32::new(0);
    let total = files.len() as u32;

    // 3. Parse files whose hash changed.
    let updated: Vec<(String, CachedFileEdges)> = files
        .iter()
        .filter_map(|file| {
            // Cap parsing at MAX_PARSE_BYTES; treat over-cap as empty edges
            // (still emit a node so the file appears on the graph).
            if file.size_bytes > MAX_PARSE_BYTES {
                return None;
            }
            let bytes = match fs::read(&file.absolute_path) {
                Ok(b) => b,
                Err(error) => {
                    tracing::warn!(
                        path = %file.absolute_path.display(),
                        error = %error,
                        "failed to read source for code-graph",
                    );
                    return None;
                }
            };
            let content_hash = hash_bytes(&bytes);

            if let Some(cached) = existing_cache.entries.get(&file.relative_path) {
                if cached.content_hash == content_hash && cached.language == file.language {
                    return None;
                }
            }

            let Ok(source) = std::str::from_utf8(&bytes) else {
                return None;
            };
            let parser = parser_for(file.language);
            let edges = parser.parse(source);
            let processed = parsed_counter.fetch_add(1, Ordering::Relaxed) + 1;
            if processed.is_multiple_of(50) || processed == 1 {
                send_progress(channel, BuildProgress::Parsing { processed, total });
            }
            Some((
                file.relative_path.clone(),
                CachedFileEdges {
                    content_hash,
                    language: file.language,
                    edges,
                },
            ))
        })
        .collect();

    let parsed_files = updated.len() as u32;
    let cached_files = total.saturating_sub(parsed_files);

    // Apply updates to the in-memory cache view so resolution below sees
    // the fresh edges.
    for (path, entry) in &updated {
        existing_cache.entries.insert(path.clone(), entry.clone());
    }

    // 4. Persist updated cache rows + prune deleted files.
    if let Err(error) = cache::persist_file_edges(workspace_id, &updated) {
        tracing::warn!(error = %error, "failed to persist code-graph cache rows");
    }
    if let Err(error) = cache::prune_missing_files(workspace_id, &present_paths) {
        tracing::warn!(error = %error, "failed to prune missing code-graph files");
    }

    // 5. Resolve all edges into the final graph.
    let (mut nodes, mut edges, stats) =
        assemble_graph(workspace_root, &files, &existing_cache, channel);

    // 6. Mark changed nodes by overlaying `list_workspace_changes`.
    apply_change_status(workspace_root, &mut nodes);

    // 7. Recompute fan-in/out (cheap, deterministic on the final edge set).
    compute_fan_counts(&mut nodes, &edges);

    // Dedup edges (parser may emit `import x from "./a"` twice).
    edges.sort_by(|a, b| {
        a.source
            .cmp(&b.source)
            .then(a.target.cmp(&b.target))
            .then((a.kind as u8).cmp(&(b.kind as u8)))
    });
    edges.dedup_by(|a, b| {
        a.source == b.source && a.target == b.target && a.kind as u8 == b.kind as u8
    });
    for (idx, edge) in edges.iter_mut().enumerate() {
        edge.id = format!("e{idx}");
    }

    let content_revision = compute_content_revision(workspace_root, &existing_cache);
    let graph = CodeGraph {
        workspace_id: workspace_id.to_string(),
        generated_at_ms: SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        content_revision: content_revision.clone(),
        nodes,
        edges,
        stats: CodeGraphStats {
            parsed_files,
            cached_files,
            ..stats
        },
    };

    send_progress(channel, BuildProgress::Done { content_revision });

    cache::put_in_memory(workspace_id, graph.clone());
    Ok(graph)
}

fn assemble_graph(
    workspace_root: &Path,
    files: &[WalkedFile],
    cache_view: &WorkspaceEdgeCache,
    channel: Option<&Channel<BuildProgress>>,
) -> (Vec<CodeGraphNode>, Vec<CodeGraphEdge>, CodeGraphStats) {
    // Build resolver contexts.
    let known_files: HashSet<String> = files.iter().map(|f| f.relative_path.clone()).collect();
    let crate_roots = discover_crate_roots(files);
    let package_roots = discover_python_roots(files);
    let aliases = discover_aliases(workspace_root);

    let ts_ctx = TsResolverContext {
        known_files: known_files.clone(),
        aliases,
    };
    let rust_ctx = RustResolverContext {
        known_files: known_files.clone(),
        crate_roots,
    };
    let py_ctx = PythonResolverContext {
        known_files: known_files.clone(),
        package_roots,
    };

    let ts_res = resolvers::ts_js::TsResolver::new(workspace_root, &ts_ctx);
    let rust_res = resolvers::rust::RustResolver::new(&rust_ctx);
    let py_res = resolvers::python::PythonResolver::new(&py_ctx);

    // Nodes — one per walked file.
    let nodes: Vec<CodeGraphNode> = files
        .iter()
        .map(|f| CodeGraphNode {
            id: f.relative_path.clone(),
            path: f.relative_path.clone(),
            name: Path::new(&f.relative_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| f.relative_path.clone()),
            language: f.language,
            is_external: false,
            status: None,
            insertions: 0,
            deletions: 0,
            fan_in: 0,
            fan_out: 0,
        })
        .collect();

    let mut edges: Vec<CodeGraphEdge> = Vec::new();
    let mut unresolved = 0u32;
    let mut external_packages: HashSet<String> = HashSet::new();

    let total = files.len() as u32;
    let mut resolved_count = 0u32;

    for file in files {
        let Some(cached) = cache_view.entries.get(&file.relative_path) else {
            continue;
        };

        for raw in &cached.edges {
            let resolution = match file.language {
                CodeGraphLanguage::Typescript
                | CodeGraphLanguage::Tsx
                | CodeGraphLanguage::Javascript
                | CodeGraphLanguage::Jsx => ts_res.resolve(&file.relative_path, &raw.specifier),
                CodeGraphLanguage::Rust => rust_res.resolve(&file.relative_path, &raw.specifier),
                CodeGraphLanguage::Python => py_res.resolve(&file.relative_path, &raw.specifier),
            };
            match resolution {
                resolvers::Resolution::File { relative_path } => {
                    if relative_path == file.relative_path {
                        // Self-edge → skip (a barrel index might re-export itself).
                        continue;
                    }
                    edges.push(CodeGraphEdge {
                        id: String::new(), // assigned after dedup
                        source: file.relative_path.clone(),
                        target: relative_path,
                        kind: raw.kind,
                    });
                }
                resolvers::Resolution::External { package } => {
                    external_packages.insert(package);
                }
                resolvers::Resolution::Unknown => {
                    unresolved += 1;
                }
            }
        }

        resolved_count += 1;
        if resolved_count.is_multiple_of(100) || resolved_count == total {
            send_progress(
                channel,
                BuildProgress::Resolving {
                    processed: resolved_count,
                    total,
                },
            );
        }
    }

    let stats = CodeGraphStats {
        parsed_files: 0,
        cached_files: 0,
        unresolved_specifiers: unresolved,
        external_packages: external_packages.len() as u32,
    };

    (nodes, edges, stats)
}

fn apply_change_status(workspace_root: &Path, nodes: &mut [CodeGraphNode]) {
    let workspace_root_str = workspace_root.to_string_lossy().to_string();
    let changes = match list_workspace_changes(&workspace_root_str) {
        Ok(c) => c,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "list_workspace_changes failed; code-graph nodes will have no status",
            );
            return;
        }
    };
    let mut by_path: HashMap<String, (String, u32, u32)> = HashMap::new();
    for change in changes {
        by_path.insert(
            change.path.clone(),
            (change.status, change.insertions, change.deletions),
        );
    }
    for node in nodes.iter_mut() {
        if let Some((status, ins, del)) = by_path.get(&node.path) {
            node.status = Some(status.clone());
            node.insertions = *ins;
            node.deletions = *del;
        }
    }
}

fn compute_fan_counts(nodes: &mut [CodeGraphNode], edges: &[CodeGraphEdge]) {
    let mut fan_in: HashMap<&str, u32> = HashMap::new();
    let mut fan_out: HashMap<&str, u32> = HashMap::new();
    for edge in edges {
        *fan_in.entry(edge.target.as_str()).or_insert(0) += 1;
        *fan_out.entry(edge.source.as_str()).or_insert(0) += 1;
    }
    for node in nodes.iter_mut() {
        node.fan_in = fan_in.get(node.id.as_str()).copied().unwrap_or(0);
        node.fan_out = fan_out.get(node.id.as_str()).copied().unwrap_or(0);
    }
}

fn discover_crate_roots(files: &[WalkedFile]) -> Vec<String> {
    let mut roots: HashSet<String> = HashSet::new();
    for f in files {
        if Path::new(&f.relative_path)
            .file_name()
            .and_then(|n| n.to_str())
            == Some("Cargo.toml")
        {
            let parent = Path::new(&f.relative_path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            roots.insert(parent);
        }
    }
    // Always include root as a fallback.
    roots.insert(String::new());
    let mut out: Vec<String> = roots.into_iter().collect();
    out.sort_by_key(|s| std::cmp::Reverse(s.len()));
    out
}

fn discover_python_roots(files: &[WalkedFile]) -> Vec<String> {
    let mut roots: HashSet<String> = HashSet::new();
    for f in files {
        let Some(name) = Path::new(&f.relative_path)
            .file_name()
            .and_then(|n| n.to_str())
        else {
            continue;
        };
        if name == "pyproject.toml" {
            let parent = Path::new(&f.relative_path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            // Convention: src layout.
            let src = if parent.is_empty() {
                "src".to_string()
            } else {
                format!("{parent}/src")
            };
            roots.insert(parent);
            roots.insert(src);
        }
    }
    roots.insert(String::new());
    let mut out: Vec<String> = roots.into_iter().collect();
    out.sort_by_key(|s| std::cmp::Reverse(s.len()));
    out
}

fn compute_content_revision(workspace_root: &Path, cache_view: &WorkspaceEdgeCache) -> String {
    let head = git_ops::run_git(["rev-parse", "HEAD"], Some(workspace_root))
        .unwrap_or_default()
        .trim()
        .to_string();
    let mut hashes: Vec<&String> = cache_view
        .entries
        .values()
        .map(|e| &e.content_hash)
        .collect();
    hashes.sort();
    let mut hasher = blake3::Hasher::new();
    hasher.update(head.as_bytes());
    for h in hashes {
        hasher.update(h.as_bytes());
    }
    hasher.finalize().to_hex().to_string()
}

fn send_progress(channel: Option<&Channel<BuildProgress>>, progress: BuildProgress) {
    if let Some(channel) = channel {
        let _ = channel.send(progress);
    }
}
