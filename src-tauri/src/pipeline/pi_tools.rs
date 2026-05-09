//! Normalization helpers for Pi tool calls flowing through the Codex-shaped
//! pipeline path.
//!
//! Helmor receives Pi SDK tool events from the sidecar as `mcp_tool_call`
//! items with `server: "pi"`. These helpers keep live streaming and
//! historical reload rendering aligned while preserving the canonical MCP
//! tool-name shape expected by the frontend (`mcp__{server}__{tool}`).

use serde_json::Value;

/// Return the canonical frontend tool name for a Pi/MCP tool call.
pub(crate) fn canonical_pi_tool_name(server: &str, tool: &str) -> String {
    format!("mcp__{server}__{tool}")
}

/// Normalize Pi tool arguments enough for stable rendering.
///
/// Pi built-in tools use `path` while Claude Code renderers traditionally use
/// `file_path`. The frontend's Pi-specific renderer understands `path`, so we
/// preserve the original shape but tolerate JSON-encoded argument strings and
/// fill the common path alias when only `file_path` is present.
pub(crate) fn normalize_pi_tool_args(server: &str, tool: &str, raw_arguments: Value) -> Value {
    if server != "pi" {
        return raw_arguments;
    }

    let mut args = parse_argument_value(raw_arguments);
    let Some(obj) = args.as_object_mut() else {
        return args;
    };

    match tool {
        "read" | "write" | "edit" | "ls" | "find" => {
            if !obj.contains_key("path") {
                if let Some(file_path) = obj.get("file_path").cloned() {
                    obj.insert("path".to_string(), file_path);
                }
            }
        }
        _ => {}
    }

    args
}

/// Extract display text for an MCP/Pi tool result.
pub(crate) fn mcp_result_text(server: &str, _tool: &str, item: &Value, failed: bool) -> String {
    if failed {
        let message = item
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| item.get("result").and_then(extract_result_text))
            .unwrap_or_else(|| "MCP tool failed".to_string());
        return if message.starts_with("Error:") {
            message
        } else {
            format!("Error: {message}")
        };
    }

    let Some(result) = item.get("result") else {
        return "OK".to_string();
    };

    if server == "pi" {
        if let Some(text) = extract_result_text(result).filter(|text| !text.trim().is_empty()) {
            return text;
        }
    }

    serde_json::to_string(result)
        .ok()
        .filter(|text| text != "null")
        .unwrap_or_else(|| "OK".to_string())
}

fn parse_argument_value(raw: Value) -> Value {
    match raw {
        Value::Null => serde_json::json!({}),
        Value::String(text) => serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text)),
        other => other,
    }
}

fn extract_result_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Object(obj) => {
            if let Some(content) = obj.get("content").and_then(Value::as_array) {
                let text = content
                    .iter()
                    .filter_map(|item| {
                        item.as_object().and_then(|block| {
                            (block.get("type").and_then(Value::as_str) == Some("text"))
                                .then(|| block.get("text").and_then(Value::as_str))
                                .flatten()
                        })
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                if !text.is_empty() {
                    return Some(text);
                }
            }

            ["text", "output", "stdout", "stderr"]
                .iter()
                .find_map(|key| obj.get(*key).and_then(Value::as_str).map(str::to_string))
        }
        _ => None,
    }
}
