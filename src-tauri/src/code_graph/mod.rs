//! Code-graph builder for the diagram view.
//!
//! Entry point is `build_code_graph`. The pipeline is:
//!   1. Walk the workspace for source files (`walker.rs`).
//!   2. Diff content hashes against the SQLite cache; re-parse only
//!      files whose hash changed (`cache.rs`, `hash.rs`).
//!   3. Tree-sitter parsers per language emit raw module specifiers
//!      (`parsers/`).
//!   4. Language-specific resolvers map specifiers to workspace-relative
//!      file paths or external packages (`resolvers/`).
//!   5. Cross-reference the result with `list_workspace_changes` so
//!      changed files come back with their status / +- counts.
//!   6. Return a `CodeGraph` and cache it in memory + SQLite.
//!
//! Invalidation is event-driven through the existing
//! `UiMutationEvent::WorkspaceGitStateChanged` /
//! `WorkspaceCodeGraphChanged` channel.

pub mod builder;
pub mod cache;
pub mod hash;
pub mod parsers;
pub mod resolvers;
pub mod types;
pub mod walker;

pub use builder::build_code_graph;
pub use types::{
    BuildProgress, CodeGraph, CodeGraphEdge, CodeGraphEdgeKind, CodeGraphLanguage, CodeGraphNode,
    CodeGraphStats,
};

/// Drop the in-memory graph cache for a workspace, forcing the next
/// `code_graph_get` call to rebuild from SQLite + re-parse changed
/// files. Cheap — used by the invalidation listener and the manual
/// refresh button.
pub fn invalidate(workspace_id: &str) {
    cache::drop_in_memory(workspace_id);
}

/// Returns the in-memory cached graph if present without doing any work.
pub fn get_cached(workspace_id: &str) -> Option<CodeGraph> {
    cache::get_in_memory(workspace_id)
}
