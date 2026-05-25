//! Rust import extractor: `use ...;` statements and `mod foo;` declarations.
//!
//! The specifier we emit is the full `::`-joined path for `use`s, and
//! `mod:foo` for module declarations. The resolver then handles the
//! crate-root + mod-tree lookup.

use tree_sitter::{Node, Parser};

use super::LanguageParser;
use crate::code_graph::types::{CodeGraphEdgeKind, UnresolvedEdge};

pub struct RustParser;

impl RustParser {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RustParser {
    fn default() -> Self {
        Self::new()
    }
}

impl LanguageParser for RustParser {
    fn parse(&self, source: &str) -> Vec<UnresolvedEdge> {
        let mut parser = Parser::new();
        if parser
            .set_language(&tree_sitter_rust::LANGUAGE.into())
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
        "use_declaration" => {
            // We just take the textual specifier between `use` and `;` —
            // good enough for the resolver to anchor on the leading
            // segment (`crate`, `super`, `self`, or a crate name).
            if let Some(arg) = node.child_by_field_name("argument") {
                if let Ok(text) = std::str::from_utf8(&src[arg.start_byte()..arg.end_byte()]) {
                    let cleaned = clean_use_path(text);
                    if !cleaned.is_empty() {
                        out.push(UnresolvedEdge {
                            specifier: format!("use:{cleaned}"),
                            kind: CodeGraphEdgeKind::Static,
                        });
                    }
                }
            }
        }
        "mod_item" => {
            // Only inline-less `mod foo;` (no body) generates an external
            // edge; inline `mod foo { ... }` defines a module rather than
            // referencing a file.
            let has_body = {
                let mut cursor = node.walk();
                let mut found = false;
                for c in node.children(&mut cursor) {
                    if c.kind() == "declaration_list" {
                        found = true;
                        break;
                    }
                }
                found
            };
            if !has_body {
                if let Some(name) = node.child_by_field_name("name") {
                    if let Ok(text) = std::str::from_utf8(&src[name.start_byte()..name.end_byte()])
                    {
                        out.push(UnresolvedEdge {
                            specifier: format!("mod:{text}"),
                            kind: CodeGraphEdgeKind::Static,
                        });
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

fn clean_use_path(raw: &str) -> String {
    // Drop `as Alias`, drop `{...}` group bodies (we keep the prefix), and
    // collapse whitespace.
    let trimmed = raw.trim().trim_end_matches(';').trim();
    let without_braces = match trimmed.find('{') {
        Some(idx) => trimmed[..idx].trim_end_matches("::").trim().to_string(),
        None => trimmed.to_string(),
    };
    without_braces.replace(char::is_whitespace, "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_use_statements() {
        let src = r#"
            use crate::foo::bar;
            use super::baz::{qux, quux};
            use serde::Serialize;
            mod helpers;
            mod inline { pub fn x() {} }
        "#;
        let parser = RustParser::new();
        let specs: Vec<_> = parser.parse(src).into_iter().map(|e| e.specifier).collect();
        assert!(specs.contains(&"use:crate::foo::bar".to_string()));
        assert!(specs.iter().any(|s| s.starts_with("use:super::baz")));
        assert!(specs.contains(&"use:serde::Serialize".to_string()));
        assert!(specs.contains(&"mod:helpers".to_string()));
        // Inline mods do not produce a file edge.
        assert!(!specs.contains(&"mod:inline".to_string()));
    }
}
