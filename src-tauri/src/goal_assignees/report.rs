use serde::Serialize;

use crate::pipeline;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssigneeReportMarker {
    pub report_type: String,
    pub message_id: Option<String>,
    pub created_at: Option<String>,
    pub excerpt: String,
    pub full_text: String,
}

pub(super) fn latest_report_marker(
    messages: &[pipeline::types::ThreadMessageLike],
) -> Option<AssigneeReportMarker> {
    messages.iter().rev().find_map(|message| {
        if message.role != pipeline::types::MessageRole::Assistant {
            return None;
        }
        let text = message_text(message);
        let report_type = detect_report_type(&text)?;
        Some(AssigneeReportMarker {
            report_type: report_type.to_string(),
            message_id: message.id.clone(),
            created_at: message.created_at.clone(),
            excerpt: excerpt(&text),
            full_text: text,
        })
    })
}

pub(super) fn report_marker_from_text(
    message_id: Option<String>,
    created_at: Option<String>,
    text: &str,
) -> Option<AssigneeReportMarker> {
    let report_type = detect_report_type(text)?;
    Some(AssigneeReportMarker {
        report_type: report_type.to_string(),
        message_id,
        created_at,
        excerpt: excerpt(text),
        full_text: text.to_string(),
    })
}

pub(super) fn message_text(message: &pipeline::types::ThreadMessageLike) -> String {
    message
        .content
        .iter()
        .filter_map(|part| match part {
            pipeline::types::ExtendedMessagePart::Basic(pipeline::types::MessagePart::Text {
                text,
                ..
            }) => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn detect_report_type(text: &str) -> Option<&'static str> {
    let mut best: Option<&'static str> = None;
    for report_type in text.lines().filter_map(detect_report_type_in_line) {
        best = Some(match (best, report_type) {
            (Some("blocked"), _) | (_, "blocked") => "blocked",
            (Some("completed"), _) | (_, "completed") => "completed",
            (Some("handoff"), _) | (_, "handoff") => "handoff",
            _ => "progress",
        });
    }
    best
}

fn detect_report_type_in_line(line: &str) -> Option<&'static str> {
    let normalized = normalize_report_marker_line(line);
    ["blocked", "completed", "handoff", "progress"]
        .into_iter()
        .find(|marker| normalized == *marker || normalized.starts_with(&format!("{marker}:")))
}

fn normalize_report_marker_line(line: &str) -> String {
    let mut trimmed = line.trim().trim_start_matches('#').trim();
    loop {
        let next = trimmed.trim_matches(|character: char| {
            character == '*' || character == '_' || character.is_whitespace()
        });
        if next.len() == trimmed.len() {
            break;
        }
        trimmed = next;
    }
    trimmed.to_lowercase()
}

pub(super) fn excerpt(text: &str) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    const MAX_LEN: usize = 220;
    if compact.chars().count() <= MAX_LEN {
        compact
    } else {
        let truncated = compact.chars().take(MAX_LEN).collect::<String>();
        format!("{truncated}…")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_heading_based_report_markers() {
        assert_eq!(
            detect_report_type("## Blocked\nNeed an API key"),
            Some("blocked")
        );
        assert_eq!(detect_report_type("**Completed**"), Some("completed"));
        assert_eq!(
            detect_report_type("Completed: ready for review"),
            Some("completed")
        );
        assert_eq!(
            detect_report_type("## Completed\n\nAll set.\n\n## Blocked\nNone."),
            Some("blocked")
        );
        assert_eq!(
            detect_report_type("## Progress\nWorking\n\n## Completed\nDone."),
            Some("completed")
        );
        assert_eq!(
            detect_report_type("__Progress__\nValidated the first path."),
            Some("progress")
        );
        assert_eq!(detect_report_type("Status only"), None);
    }

    #[test]
    fn excerpt_truncates_on_utf8_character_boundaries() {
        let text = "é".repeat(221);
        let result = excerpt(&text);

        assert_eq!(result.chars().count(), 221);
        assert!(result.ends_with('…'));
    }
}
