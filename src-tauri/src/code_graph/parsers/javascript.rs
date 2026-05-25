//! JavaScript / JSX import extractor. Same structure as the TypeScript
//! parser, minus the type-only branch.

use tree_sitter::{Node, Parser};

use super::LanguageParser;
use crate::code_graph::types::{CodeGraphEdgeKind, UnresolvedEdge};

pub struct JavascriptParser;

impl JavascriptParser {
    pub fn new() -> Self {
        Self
    }
}

impl Default for JavascriptParser {
    fn default() -> Self {
        Self::new()
    }
}

impl LanguageParser for JavascriptParser {
    fn parse(&self, source: &str) -> Vec<UnresolvedEdge> {
        let mut parser = Parser::new();
        if parser
            .set_language(&tree_sitter_javascript::LANGUAGE.into())
            .is_err()
        {
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
    match node.kind() {
        "import_statement" => {
            if let Some(spec) = string_child_value(node, src) {
                out.push(UnresolvedEdge {
                    specifier: spec,
                    kind: CodeGraphEdgeKind::Static,
                });
            }
        }
        "export_statement" => {
            if let Some(spec) = string_child_value(node, src) {
                out.push(UnresolvedEdge {
                    specifier: spec,
                    kind: CodeGraphEdgeKind::Reexport,
                });
            }
        }
        "call_expression" => {
            if let Some(fn_node) = node.child_by_field_name("function") {
                let kind = fn_node.kind();
                if kind == "import" {
                    if let Some(args) = node.child_by_field_name("arguments") {
                        if let Some(spec) = first_string_in(args, src) {
                            out.push(UnresolvedEdge {
                                specifier: spec,
                                kind: CodeGraphEdgeKind::Dynamic,
                            });
                        }
                    }
                } else if kind == "identifier" {
                    // CommonJS: require("x")
                    let text = std::str::from_utf8(&src[fn_node.start_byte()..fn_node.end_byte()])
                        .unwrap_or("");
                    if text == "require" {
                        if let Some(args) = node.child_by_field_name("arguments") {
                            if let Some(spec) = first_string_in(args, src) {
                                out.push(UnresolvedEdge {
                                    specifier: spec,
                                    kind: CodeGraphEdgeKind::Static,
                                });
                            }
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

    #[test]
    fn extracts_imports_and_requires() {
        let src = r#"
            import x from "./x";
            const y = require("./y");
        "#;
        let parser = JavascriptParser::new();
        let specs: Vec<_> = parser.parse(src).into_iter().map(|e| e.specifier).collect();
        assert!(specs.iter().any(|s| s == "./x"));
        assert!(specs.iter().any(|s| s == "./y"));
    }
}
