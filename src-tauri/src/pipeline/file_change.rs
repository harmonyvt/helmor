use serde_json::Value;

/// Build the text attached to a normalized Codex/Pi `file_change` tool result.
///
/// Codex historically only supplies `status`, so we keep the generic patch
/// labels as a fallback. Pi file mutation tools also include their native
/// result payload (`content: [{ type: "text", ... }]` and, for edits,
/// `details.diff`), so prefer that text to avoid throwing away concrete
/// failure/success details during live streaming and historical reload.
pub(crate) fn file_change_result_text(item: &Value, status: &str) -> String {
    let message = item
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| item.get("result").and_then(extract_result_text))
        .filter(|text| !text.trim().is_empty());

    match status {
        "completed" => message.unwrap_or_else(|| "Patch applied".to_string()),
        "failed" => {
            let message = message.unwrap_or_else(|| "Patch failed".to_string());
            if message.starts_with("Error:") || message == "Patch failed" {
                message
            } else {
                format!("Error: {message}")
            }
        }
        other => message.unwrap_or_else(|| format!("Patch {other}")),
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
