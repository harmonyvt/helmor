//! Message transformation pipeline.
//!
//! Converts raw sidecar JSON events into rendered messages for the frontend.
//!
//! # Incremental IPC strategy
//!
//! - **Finalization events** (assistant, user, result, error): run the full
//!   pipeline (adapt + collapse) and emit `Full(Vec<ThreadMessageLike>)`.
//! - **Streaming deltas** (stream_event, tool_progress): only build the
//!   trailing partial message and emit `Partial(ThreadMessageLike)`.
//!   The frontend appends/replaces this at the end of its cached array.
//!
//! This keeps per-delta IPC payload small (~hundreds of bytes, one message)
//! instead of serializing the entire conversation on every keystroke.

pub mod accumulator;
pub mod adapter;
pub mod classify;
pub mod collapse;
pub mod event_filter;
pub(crate) mod file_change;
pub(crate) mod pi_tools;
pub mod types;

use serde_json::Value;

use accumulator::PushOutcome;
use serde::{Deserialize, Serialize};

use types::{
    ExtendedMessagePart, HistoricalRecord, IntermediateMessage, MessagePart, ThreadMessageLike,
};

// ---------------------------------------------------------------------------
// Pipeline output
// ---------------------------------------------------------------------------

/// What the pipeline wants to emit after processing an event.
pub enum PipelineEmit {
    /// Full snapshot — sent on finalization events (assistant, user, result, error).
    /// The frontend replaces its entire message array.
    Full(Vec<ThreadMessageLike>),
    /// Only the streaming partial changed — sent on stream deltas.
    /// The frontend replaces only the trailing streaming message.
    Partial(ThreadMessageLike),
    /// Append-only text growth inside the current trailing streaming message.
    /// The frontend can patch its local tail without receiving the whole
    /// accumulated message again.
    Delta(StreamingTextDelta),
    /// Nothing changed (e.g. event didn't affect visible output).
    None,
}

/// Which text-bearing part kind changed in a streaming delta.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StreamingTextDeltaPartType {
    Text,
    Reasoning,
}

/// Compact append-only update for the current streaming assistant tail.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StreamingTextDelta {
    pub message_id: String,
    pub part_id: String,
    pub part_type: StreamingTextDeltaPartType,
    pub text_delta: String,
}

// ---------------------------------------------------------------------------
// MessagePipeline
// ---------------------------------------------------------------------------

pub struct MessagePipeline {
    pub accumulator: accumulator::StreamAccumulator,
    context_key: String,
    session_id: String,
    last_partial: Option<ThreadMessageLike>,
}

impl MessagePipeline {
    pub fn new(provider: &str, fallback_model: &str, context_key: &str, session_id: &str) -> Self {
        Self {
            accumulator: accumulator::StreamAccumulator::new(provider, fallback_model),
            context_key: context_key.to_string(),
            session_id: session_id.to_string(),
            last_partial: None,
        }
    }

    /// Feed a raw sidecar JSON event.
    ///
    /// The accumulator classifies its own state change via `PushOutcome`,
    /// which decides between a full re-render, a partial render, or a
    /// no-op. A new SDK event type only has ONE place to land — the
    /// dispatch in `StreamAccumulator::push_event`.
    pub fn push_event(&mut self, value: &Value, raw_line: &str) -> PipelineEmit {
        let outcome = self.accumulator.push_event(value, raw_line);

        match outcome {
            PushOutcome::Finalized => PipelineEmit::Full(self.render_full()),
            PushOutcome::StreamingDelta => self.emit_partial(),
            PushOutcome::NoOp => PipelineEmit::None,
        }
    }

    /// Force a fresh full render. Called once at end-of-stream.
    pub fn finish(&mut self) -> Vec<ThreadMessageLike> {
        self.render_full()
    }

    /// Finalize any active streaming partial into a collected assistant
    /// message. Used on abort paths where no terminal provider assistant
    /// event will arrive, but the last visible partial should still remain
    /// in the thread ahead of the terminal abort notice.
    pub fn materialize_partial(&mut self) {
        self.accumulator
            .materialize_partial(&self.context_key, &self.session_id);
    }

    /// Convert historical DB records (static, no accumulator).
    pub fn convert_historical(records: &[HistoricalRecord]) -> Vec<ThreadMessageLike> {
        let intermediate: Vec<IntermediateMessage> = records
            .iter()
            .map(|r| IntermediateMessage {
                id: r.id.clone(),
                role: r.role,
                raw_json: r.content.clone(),
                parsed: r.parsed_content.clone(),
                created_at: r.created_at.clone(),
                is_streaming: false,
            })
            .collect();
        render_pipeline(&intermediate)
    }

    // -----------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------

    fn render_full(&mut self) -> Vec<ThreadMessageLike> {
        let partial = self
            .accumulator
            .build_partial(&self.context_key, &self.session_id);
        let collected = self.accumulator.collected();

        self.last_partial = None;

        match partial {
            Some(p) => {
                let mut all = Vec::with_capacity(collected.len() + 1);
                all.extend_from_slice(collected);
                all.push(p);
                render_pipeline(&all)
            }
            None => render_pipeline(collected),
        }
    }

    /// Partial render: only build the trailing streaming message.
    /// Sent on stream deltas. Much cheaper than a full render.
    ///
    /// Tries the Claude path first (block-level deltas in `blocks` /
    /// `fallback_text`), then falls back to the Codex path (last-touched
    /// `collected[]` entry tracked by `codex_partial_idx`).
    fn emit_partial(&mut self) -> PipelineEmit {
        let partial = match self
            .accumulator
            .build_partial(&self.context_key, &self.session_id)
            .or_else(|| self.accumulator.build_codex_partial())
        {
            Some(p) => p,
            None => return PipelineEmit::None,
        };

        // Adapt only this single partial message. Cross-message
        // stabilization of streaming tails happens in the frontend cache
        // layer where the base snapshot and pending partial are combined.
        let rendered = adapter::convert(&[partial]);
        let mut msg = match rendered.into_iter().next() {
            Some(m) => m,
            None => return PipelineEmit::None,
        };
        msg.streaming = Some(true);

        let delta = self
            .last_partial
            .as_ref()
            .and_then(|previous| derive_streaming_text_delta(previous, &msg));
        self.last_partial = Some(msg.clone());

        match delta {
            Some(delta) => PipelineEmit::Delta(delta),
            None => PipelineEmit::Partial(msg),
        }
    }
}

fn derive_streaming_text_delta(
    previous: &ThreadMessageLike,
    next: &ThreadMessageLike,
) -> Option<StreamingTextDelta> {
    let message_id = match (&previous.id, &next.id) {
        (Some(previous_id), Some(next_id)) if previous_id == next_id => next_id.clone(),
        _ => return None,
    };
    if previous.role != next.role || previous.content.len() != next.content.len() {
        return None;
    }

    let mut delta: Option<StreamingTextDelta> = None;
    for (previous_part, next_part) in previous.content.iter().zip(next.content.iter()) {
        if let Some(next_delta) = text_part_append_delta(&message_id, previous_part, next_part) {
            if delta.is_some() {
                return None;
            }
            delta = Some(next_delta);
            continue;
        }

        if parts_equal(previous_part, next_part) {
            continue;
        }

        return None;
    }

    delta
}

fn parts_equal(left: &ExtendedMessagePart, right: &ExtendedMessagePart) -> bool {
    serde_json::to_value(left).ok() == serde_json::to_value(right).ok()
}

fn text_part_append_delta(
    message_id: &str,
    previous: &ExtendedMessagePart,
    next: &ExtendedMessagePart,
) -> Option<StreamingTextDelta> {
    match (previous, next) {
        (
            ExtendedMessagePart::Basic(MessagePart::Text {
                id: previous_id,
                text: previous_text,
            }),
            ExtendedMessagePart::Basic(MessagePart::Text {
                id: next_id,
                text: next_text,
            }),
        ) if previous_id == next_id
            && next_text.len() > previous_text.len()
            && next_text.starts_with(previous_text) =>
        {
            Some(StreamingTextDelta {
                message_id: message_id.to_string(),
                part_id: next_id.clone(),
                part_type: StreamingTextDeltaPartType::Text,
                text_delta: next_text[previous_text.len()..].to_string(),
            })
        }
        (
            ExtendedMessagePart::Basic(MessagePart::Reasoning {
                id: previous_id,
                text: previous_text,
                streaming: previous_streaming,
                duration_ms: previous_duration_ms,
            }),
            ExtendedMessagePart::Basic(MessagePart::Reasoning {
                id: next_id,
                text: next_text,
                streaming: next_streaming,
                duration_ms: next_duration_ms,
            }),
        ) if previous_id == next_id
            && previous_streaming == next_streaming
            && previous_duration_ms == next_duration_ms
            && next_text.len() > previous_text.len()
            && next_text.starts_with(previous_text) =>
        {
            Some(StreamingTextDelta {
                message_id: message_id.to_string(),
                part_id: next_id.clone(),
                part_type: StreamingTextDeltaPartType::Reasoning,
                text_delta: next_text[previous_text.len()..].to_string(),
            })
        }
        _ => None,
    }
}

/// Run the adapter + collapse stages on intermediate messages.
fn render_pipeline(intermediate: &[IntermediateMessage]) -> Vec<ThreadMessageLike> {
    let mut messages = adapter::convert(intermediate);
    collapse::collapse_pass(&mut messages);
    messages
}
