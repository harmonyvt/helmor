//! Resolve raw module specifiers (from parsers) to workspace-relative
//! file paths. Per-language because resolution rules differ wildly.

pub mod python;
pub mod rust;
pub mod ts_js;

/// What a resolver returns for one specifier.
#[derive(Debug, Clone)]
pub enum Resolution {
    /// Resolved to a file inside the workspace.
    File { relative_path: String },
    /// Resolved to a recognised external package (npm/crate/etc.).
    /// Tracked for stats but not rendered as a node in v1.
    External { package: String },
    /// Couldn't be resolved at all. Counted in `stats.unresolvedSpecifiers`.
    Unknown,
}
