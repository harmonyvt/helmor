use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::agents::AgentStreamEvent;

static LIVE_PROGRESS_PUBLISHED_AT: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

const LIVE_PROGRESS_PUBLISH_INTERVAL: Duration = Duration::from_millis(750);

pub(super) fn should_publish_event(session_id: &str, event: &AgentStreamEvent) -> bool {
    match event {
        AgentStreamEvent::Done { .. }
        | AgentStreamEvent::Aborted { .. }
        | AgentStreamEvent::Error { .. } => {
            clear_live_progress_publish(session_id);
            true
        }
        AgentStreamEvent::Update { .. } | AgentStreamEvent::KanbanToolCall { .. } => {
            remember_live_progress_publish(session_id);
            true
        }
        AgentStreamEvent::StreamingPartial { .. } | AgentStreamEvent::StreamingDelta { .. } => {
            should_publish_throttled_progress(session_id)
        }
        _ => false,
    }
}

fn should_publish_throttled_progress(session_id: &str) -> bool {
    let published_at = LIVE_PROGRESS_PUBLISHED_AT.get_or_init(|| Mutex::new(HashMap::new()));
    let mut published_at = published_at
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = Instant::now();
    if published_at
        .get(session_id)
        .is_some_and(|last| now.duration_since(*last) < LIVE_PROGRESS_PUBLISH_INTERVAL)
    {
        return false;
    }
    published_at.insert(session_id.to_string(), now);
    true
}

fn remember_live_progress_publish(session_id: &str) {
    let published_at = LIVE_PROGRESS_PUBLISHED_AT.get_or_init(|| Mutex::new(HashMap::new()));
    published_at
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(session_id.to_string(), Instant::now());
}

fn clear_live_progress_publish(session_id: &str) {
    if let Some(published_at) = LIVE_PROGRESS_PUBLISHED_AT.get() {
        published_at
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(session_id);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::pipeline::types::{MessageRole, ThreadMessageLike};

    fn empty_message() -> ThreadMessageLike {
        ThreadMessageLike {
            role: MessageRole::Assistant,
            id: None,
            created_at: None,
            content: Vec::new(),
            status: None,
            streaming: None,
        }
    }

    #[test]
    fn live_progress_events_request_ui_publish() {
        assert!(should_publish_event(
            "session-progress-update",
            &AgentStreamEvent::Update {
                messages: vec![empty_message()],
            },
        ));
        assert!(should_publish_event(
            "session-progress-tool",
            &AgentStreamEvent::KanbanToolCall {
                tool_call_id: "tool-1".into(),
                tool: "read_assignee_thread".into(),
                workspace_id: "workspace-1".into(),
                args: json!({}),
            },
        ));
    }

    #[test]
    fn streaming_partial_progress_is_throttled() {
        let event = AgentStreamEvent::StreamingPartial {
            message: empty_message(),
        };

        assert!(should_publish_event("session-progress-partial", &event));
        assert!(!should_publish_event("session-progress-partial", &event));
    }
}
