use std::{fs, path::Path};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

pub const WORKFLOW_FILE_NAME: &str = "WORKFLOW.md";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDocument {
    pub front_matter: serde_yaml::Value,
    pub prompt_body: String,
    pub source_path: String,
}

pub fn try_load_workflow(root: impl AsRef<Path>) -> Result<Option<WorkflowDocument>> {
    let path = root.as_ref().join(WORKFLOW_FILE_NAME);
    if !path.exists() {
        return Ok(None);
    }
    load_workflow_path(path).map(Some)
}

pub fn load_workflow_path(path: impl AsRef<Path>) -> Result<WorkflowDocument> {
    let path = path.as_ref();
    let raw =
        fs::read_to_string(path).with_context(|| format!("Failed to read {}", path.display()))?;
    let mut document = parse_workflow(&raw)?;
    document.source_path = path.display().to_string();
    Ok(document)
}

pub fn parse_workflow(raw: &str) -> Result<WorkflowDocument> {
    let (front_matter, body) = split_front_matter(raw)?;
    Ok(WorkflowDocument {
        front_matter,
        prompt_body: body.trim_start_matches('\n').to_string(),
        source_path: WORKFLOW_FILE_NAME.to_string(),
    })
}

fn split_front_matter(raw: &str) -> Result<(serde_yaml::Value, &str)> {
    let Some(rest) = raw
        .strip_prefix("---\n")
        .or_else(|| raw.strip_prefix("---\r\n"))
    else {
        return Ok((serde_yaml::Value::Mapping(Default::default()), raw));
    };

    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" {
            let yaml = &rest[..offset];
            let body = &rest[offset + line.len()..];
            let value = if yaml.trim().is_empty() {
                serde_yaml::Value::Mapping(Default::default())
            } else {
                serde_yaml::from_str(yaml).context("Invalid WORKFLOW.md YAML front matter")?
            };
            return Ok((value, body));
        }
        offset += line.len();
    }

    bail!("WORKFLOW.md front matter starts with --- but has no closing ---");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_optional_yaml_front_matter() {
        let doc = parse_workflow(
            "---\ntracker:\n  type: local\npolling:\n  intervalSeconds: 30\n---\nRun the work.\n",
        )
        .unwrap();

        assert_eq!(doc.front_matter["tracker"]["type"], "local");
        assert_eq!(doc.prompt_body, "Run the work.\n");
    }

    #[test]
    fn accepts_plain_markdown_without_front_matter() {
        let doc = parse_workflow("Do the thing.").unwrap();
        assert_eq!(
            doc.front_matter,
            serde_yaml::Value::Mapping(Default::default())
        );
        assert_eq!(doc.prompt_body, "Do the thing.");
    }
}
