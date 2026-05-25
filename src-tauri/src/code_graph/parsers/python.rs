//! Python import extractor.
//!
//! Emits specifiers in two shapes the resolver understands:
//!   - `abs:pkg.module` for `import pkg.module` / `from pkg.module import x`
//!   - `rel:N:remainder` for `from .module import x` (N = leading dots)

use tree_sitter::{Node, Parser};

use super::LanguageParser;
use crate::code_graph::types::{CodeGraphEdgeKind, UnresolvedEdge};

pub struct PythonParser;

impl PythonParser {
    pub fn new() -> Self {
        Self
    }
}

impl Default for PythonParser {
    fn default() -> Self {
        Self::new()
    }
}

impl LanguageParser for PythonParser {
    fn parse(&self, source: &str) -> Vec<UnresolvedEdge> {
        let mut parser = Parser::new();
        if parser
            .set_language(&tree_sitter_python::LANGUAGE.into())
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
            // import pkg.module [as alias], pkg2.module2
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                if child.kind() == "dotted_name" || child.kind() == "aliased_import" {
                    let target = if child.kind() == "aliased_import" {
                        child.child_by_field_name("name").unwrap_or(child)
                    } else {
                        child
                    };
                    if let Some(text) = node_text(target, src) {
                        out.push(UnresolvedEdge {
                            specifier: format!("abs:{text}"),
                            kind: CodeGraphEdgeKind::Static,
                        });
                    }
                }
            }
        }
        "import_from_statement" => {
            // tree-sitter-python represents `from .x import y` as an
            // `import_from_statement` whose `module_name` field is
            // either a `dotted_name` (absolute) or a `relative_import`
            // wrapping an `import_prefix` (the dots) and optionally a
            // `dotted_name`.
            let module_field = node.child_by_field_name("module_name");

            // Some grammar versions don't set the field on the relative
            // branch — fall back to scanning children.
            let mut module_node = module_field;
            if module_node.is_none() {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    let kind = child.kind();
                    if matches!(kind, "dotted_name" | "relative_import") {
                        module_node = Some(child);
                        break;
                    }
                }
            }

            let Some(module) = module_node else {
                return;
            };

            match module.kind() {
                "relative_import" => {
                    let mut dots = 0u32;
                    let mut tail = String::new();
                    let mut cursor = module.walk();
                    for child in module.children(&mut cursor) {
                        match child.kind() {
                            "import_prefix" => {
                                if let Some(text) = node_text(child, src) {
                                    dots += text.chars().filter(|c| *c == '.').count() as u32;
                                }
                            }
                            "." => dots += 1,
                            "dotted_name" => {
                                tail = node_text(child, src).unwrap_or_default();
                            }
                            _ => {}
                        }
                    }
                    out.push(UnresolvedEdge {
                        specifier: format!("rel:{dots}:{tail}"),
                        kind: CodeGraphEdgeKind::Static,
                    });
                }
                _ => {
                    let module_text = node_text(module, src).unwrap_or_default();
                    out.push(UnresolvedEdge {
                        specifier: format!("abs:{module_text}"),
                        kind: CodeGraphEdgeKind::Static,
                    });
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

fn node_text(node: Node, src: &[u8]) -> Option<String> {
    std::str::from_utf8(&src[node.start_byte()..node.end_byte()])
        .ok()
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn specs(source: &str) -> Vec<String> {
        PythonParser::new()
            .parse(source)
            .into_iter()
            .map(|e| e.specifier)
            .collect()
    }

    #[test]
    fn extracts_absolute_imports() {
        let s = specs("import os.path\nfrom collections import OrderedDict\n");
        assert!(s.iter().any(|x| x == "abs:os.path"));
        assert!(s.iter().any(|x| x == "abs:collections"));
    }

    #[test]
    fn extracts_relative_imports_with_depth() {
        let s = specs("from .foo import bar\nfrom ..baz import qux\n");
        assert!(s.iter().any(|x| x == "rel:1:foo"));
        assert!(s.iter().any(|x| x == "rel:2:baz"));
    }
}
