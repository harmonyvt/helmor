//! Tree-sitter parser dispatch for the code-graph builder.
//!
//! One parser per language; each returns `UnresolvedEdge`s (raw module
//! specifiers + edge kind). Resolution to file paths happens later in
//! `resolvers/`.

pub mod javascript;
pub mod python;
pub mod rust;
pub mod typescript;

use crate::code_graph::types::{CodeGraphLanguage, UnresolvedEdge};

pub trait LanguageParser: Send + Sync {
    fn parse(&self, source: &str) -> Vec<UnresolvedEdge>;
}

pub fn parser_for(language: CodeGraphLanguage) -> Box<dyn LanguageParser> {
    match language {
        CodeGraphLanguage::Typescript => Box::new(typescript::TypescriptParser::new(false)),
        CodeGraphLanguage::Tsx => Box::new(typescript::TypescriptParser::new(true)),
        CodeGraphLanguage::Javascript | CodeGraphLanguage::Jsx => {
            Box::new(javascript::JavascriptParser::new())
        }
        CodeGraphLanguage::Rust => Box::new(rust::RustParser::new()),
        CodeGraphLanguage::Python => Box::new(python::PythonParser::new()),
    }
}
