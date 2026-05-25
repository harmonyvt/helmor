//! TypeScript / TSX import extractor.
//!
//! Tree-sitter is more accurate than regex on edge cases like JSX
//! containing strings that look like imports, multi-line imports with
//! comments, and template literals masquerading as specifiers. We still
//! walk the tree by node kind directly (instead of using
//! `tree_sitter::Query`) because the grammar's named-node API gives us
//! cheaper iteration and avoids query-syntax drift across grammar
//! versions.

use tree_sitter::{Node, Parser};

use super::LanguageParser;
use crate::code_graph::types::{CodeGraphEdgeKind, UnresolvedEdge};

pub struct TypescriptParser {
    tsx: bool,
}

impl TypescriptParser {
    pub fn new(tsx: bool) -> Self {
        Self { tsx }
    }
}

impl LanguageParser for TypescriptParser {
    fn parse(&self, source: &str) -> Vec<UnresolvedEdge> {
        let mut parser = Parser::new();
        let language = if self.tsx {
            tree_sitter_typescript::LANGUAGE_TSX.into()
        } else {
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
        };
        if parser.set_language(&language).is_err() {
            return Vec::new();
        }
        let Some(tree) = parser.parse(source, None) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        collect(tree.root_node(), source.as_bytes(), &mut out);
        out
    }
}

fn collect(node: Node, src: &[u8], out: &mut Vec<UnresolvedEdge>) {
    let kind = node.kind();
    match kind {
        // import "x" / import x from "x" / import type x from "x"
        "import_statement" => {
            let is_type = is_type_only_import(node, src);
            if let Some(spec) = string_child_value(node, src) {
                out.push(UnresolvedEdge {
                    specifier: spec,
                    kind: if is_type {
                        CodeGraphEdgeKind::TypeOnly
                    } else {
                        CodeGraphEdgeKind::Static
                    },
                });
            }
        }
        // export ... from "x"
        "export_statement" => {
            if let Some(spec) = string_child_value(node, src) {
                out.push(UnresolvedEdge {
                    specifier: spec,
                    kind: CodeGraphEdgeKind::Reexport,
                });
            }
        }
        // dynamic import("x")
        "call_expression" => {
            if let Some(fn_node) = node.child_by_field_name("function") {
                if fn_node.kind() == "import" {
                    if let Some(args) = node.child_by_field_name("arguments") {
                        if let Some(spec) = first_string_in(args, src) {
                            out.push(UnresolvedEdge {
                                specifier: spec,
                                kind: CodeGraphEdgeKind::Dynamic,
                            });
                        }
                    }
                }
            }
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect(child, src, out);
    }
}

fn is_type_only_import(node: Node, src: &[u8]) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "type" {
            return true;
        }
        // Some grammars wrap `type` modifier inside `import_clause`.
        if child.kind() == "import_clause" {
            let mut inner = child.walk();
            for grand in child.children(&mut inner) {
                if grand.kind() == "type" {
                    return true;
                }
            }
        }
        // Cheap fallback: look at the source text before the first string.
        if child.kind() == "string" {
            let text = &src[node.start_byte()..child.start_byte()];
            if let Ok(text) = std::str::from_utf8(text) {
                if text.contains(" type ") || text.starts_with("import type ") {
                    return true;
                }
            }
            return false;
        }
    }
    false
}

fn string_child_value(node: Node, src: &[u8]) -> Option<String> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "string" {
            return extract_string_literal(child, src);
        }
    }
    None
}

fn first_string_in(node: Node, src: &[u8]) -> Option<String> {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if child.kind() == "string" {
            return extract_string_literal(child, src);
        }
    }
    None
}

fn extract_string_literal(node: Node, src: &[u8]) -> Option<String> {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if child.kind() == "string_fragment" {
            return std::str::from_utf8(&src[child.start_byte()..child.end_byte()])
                .ok()
                .map(|s| s.to_string());
        }
    }
    // Fallback: strip the surrounding quotes manually.
    let raw = std::str::from_utf8(&src[node.start_byte()..node.end_byte()]).ok()?;
    let trimmed = raw.trim_matches(|c| c == '\'' || c == '"' || c == '`');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn specs(source: &str, tsx: bool) -> Vec<String> {
        let parser = TypescriptParser::new(tsx);
        parser
            .parse(source)
            .into_iter()
            .map(|e| e.specifier)
            .collect()
    }

    fn kinds(source: &str, tsx: bool) -> Vec<CodeGraphEdgeKind> {
        let parser = TypescriptParser::new(tsx);
        parser.parse(source).into_iter().map(|e| e.kind).collect()
    }

    #[test]
    fn extracts_static_imports() {
        let src = r#"
            import { foo } from "./foo";
            import bar from '../bar';
            import "side-effect";
        "#;
        let s = specs(src, false);
        assert!(s.iter().any(|x| x == "./foo"));
        assert!(s.iter().any(|x| x == "../bar"));
        assert!(s.iter().any(|x| x == "side-effect"));
    }

    #[test]
    fn detects_type_only_imports() {
        let src = r#"import type { Foo } from "./foo";"#;
        let k = kinds(src, false);
        assert!(matches!(k.first(), Some(CodeGraphEdgeKind::TypeOnly)));
    }

    #[test]
    fn detects_reexports() {
        let src = r#"export { foo } from "./foo";"#;
        let k = kinds(src, false);
        assert!(matches!(k.first(), Some(CodeGraphEdgeKind::Reexport)));
    }

    #[test]
    fn detects_dynamic_imports() {
        let src = r#"const x = await import("./lazy");"#;
        let k = kinds(src, false);
        assert!(matches!(k.first(), Some(CodeGraphEdgeKind::Dynamic)));
    }

    #[test]
    fn tsx_parses_jsx_with_imports() {
        let src = r#"
            import React from "react";
            export function App() { return <div>"hi"</div>; }
        "#;
        let s = specs(src, true);
        assert!(s.iter().any(|x| x == "react"));
    }
}
