//! IPC types for the code-graph diagram view.
//!
//! All structs use per-struct `#[serde(rename_all = "camelCase")]` so the
//! frontend can consume them directly without a translation layer.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CodeGraphLanguage {
    Typescript,
    Tsx,
    Javascript,
    Jsx,
    Rust,
    Python,
}

impl CodeGraphLanguage {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext {
            "ts" => Some(Self::Typescript),
            "tsx" => Some(Self::Tsx),
            "js" | "mjs" | "cjs" => Some(Self::Javascript),
            "jsx" => Some(Self::Jsx),
            "rs" => Some(Self::Rust),
            "py" => Some(Self::Python),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Typescript => "typescript",
            Self::Tsx => "tsx",
            Self::Javascript => "javascript",
            Self::Jsx => "jsx",
            Self::Rust => "rust",
            Self::Python => "python",
        }
    }

    pub fn from_label(value: &str) -> Option<Self> {
        match value {
            "typescript" => Some(Self::Typescript),
            "tsx" => Some(Self::Tsx),
            "javascript" => Some(Self::Javascript),
            "jsx" => Some(Self::Jsx),
            "rust" => Some(Self::Rust),
            "python" => Some(Self::Python),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CodeGraphEdgeKind {
    Static,
    Dynamic,
    TypeOnly,
    Reexport,
}

/// Edge in its pre-resolved form: a raw module specifier the parser saw
/// in source. Persisted to SQLite so resolver tweaks don't force a
/// re-parse.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnresolvedEdge {
    pub specifier: String,
    pub kind: CodeGraphEdgeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraphNode {
    pub id: String,
    pub path: String,
    pub name: String,
    pub language: CodeGraphLanguage,
    pub is_external: bool,
    pub status: Option<String>,
    pub insertions: u32,
    pub deletions: u32,
    pub fan_in: u32,
    pub fan_out: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: CodeGraphEdgeKind,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraphStats {
    pub parsed_files: u32,
    pub cached_files: u32,
    pub unresolved_specifiers: u32,
    pub external_packages: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGraph {
    pub workspace_id: String,
    pub generated_at_ms: u64,
    pub content_revision: String,
    pub nodes: Vec<CodeGraphNode>,
    pub edges: Vec<CodeGraphEdge>,
    pub stats: CodeGraphStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "phase")]
pub enum BuildProgress {
    Walking { discovered: u32 },
    Parsing { processed: u32, total: u32 },
    Resolving { processed: u32, total: u32 },
    Done { content_revision: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_round_trips_through_strings() {
        for lang in [
            CodeGraphLanguage::Typescript,
            CodeGraphLanguage::Tsx,
            CodeGraphLanguage::Javascript,
            CodeGraphLanguage::Jsx,
            CodeGraphLanguage::Rust,
            CodeGraphLanguage::Python,
        ] {
            let s = lang.as_str();
            assert_eq!(CodeGraphLanguage::from_label(s), Some(lang));
        }
    }

    #[test]
    fn graph_serialises_with_camel_case_fields() {
        let graph = CodeGraph {
            workspace_id: "w".into(),
            generated_at_ms: 0,
            content_revision: "rev".into(),
            nodes: vec![CodeGraphNode {
                id: "n1".into(),
                path: "src/a.ts".into(),
                name: "a.ts".into(),
                language: CodeGraphLanguage::Typescript,
                is_external: false,
                status: None,
                insertions: 0,
                deletions: 0,
                fan_in: 0,
                fan_out: 0,
            }],
            edges: Vec::new(),
            stats: CodeGraphStats::default(),
        };
        let json = serde_json::to_string(&graph).unwrap();
        assert!(json.contains("workspaceId"));
        assert!(json.contains("generatedAtMs"));
        assert!(json.contains("isExternal"));
        assert!(json.contains("fanIn"));
        assert!(json.contains("fanOut"));
        assert!(!json.contains("workspace_id"));
    }

    #[test]
    fn build_progress_tags_phase_field() {
        let p = BuildProgress::Parsing {
            processed: 3,
            total: 10,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"phase\":\"parsing\""));
        assert!(json.contains("\"processed\":3"));
        assert!(json.contains("\"total\":10"));
    }
}
