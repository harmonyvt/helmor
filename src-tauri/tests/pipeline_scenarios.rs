//! Handcrafted scenario tests for the message pipeline.
//!
//! Each test feeds a small (1-3 record) scenario into
//! `MessagePipeline::convert_historical` and freezes the resulting
//! `Vec<ThreadMessageLike>` via `insta::assert_yaml_snapshot!`. The output
//! goes through a normalization pass (`common::run_normalized`) that strips
//! timestamps, lowercases the role enum, truncates long strings, and reports
//! tool-call args as sorted key sets — making each snapshot short enough to
//! review in a diff while still pinning behaviorally significant edge cases.
//!
//! # Coverage by category
//!
//! - `err_*`   — error message normalization (5)
//! - `user_*`  — user message edge cases (8, including 3 user_prompt-shape tests)
//! - `res_*`   — result message duration / token formatting (6)
//! - `edge_*`  — empty/100-alternating/unknown-type/non-json (8)
//! - `asst_*`  — selected assistant variants (5)
//! - `sys_*`   — system message rendering (2)
//! - `merge_*` — merging boundaries (2)
//!
//! Real-data fixtures (full DB sessions) live in `pipeline_fixtures.rs`.
//! Raw stream-event jsonl replay lives in `pipeline_streams.rs`.
//!
//! # Updating snapshots
//!
//! ```sh
//! INSTA_UPDATE=always cargo test --test pipeline_scenarios
//! # or, with the insta CLI:
//! cargo insta review
//! ```

mod common;

use common::*;
use helmor_lib::pipeline::types::{ExtendedMessagePart, MessagePart, ThreadMessageLike};
use helmor_lib::pipeline::PipelineEmit;
use insta::assert_yaml_snapshot;
use serde::Serialize;
use serde_json::json;

// ============================================================================
// 1. Error messages
// ============================================================================

#[test]
fn err_content_string() {
    let parsed = json!({ "type": "error", "content": "Something broke" });
    let msgs = vec![make_record(
        "e1",
        "error",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn err_message_string() {
    let parsed = json!({ "type": "error", "message": "Boom" });
    let msgs = vec![make_record(
        "e1",
        "error",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn err_role_plain_text() {
    let msgs = vec![make_record("e1", "error", "crash!")];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn err_raw_json_content() {
    let raw = serde_json::to_string(&json!({ "content": "inner error" })).unwrap();
    let msgs = vec![make_record("e1", "error", &raw)];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn err_empty() {
    let parsed = json!({ "type": "error" });
    let msgs = vec![make_record(
        "e1",
        "error",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

// ============================================================================
// 2. User messages
// ============================================================================

#[test]
fn user_plain_text() {
    // Legacy / unmigrated row form. After the user_prompt migration the
    // production write path uses `user_prompt(...)` instead, but the loader
    // still tolerates a corrupted row by leaving parsed_content = None.
    let msgs = vec![make_record("u1", "user", "hello assistant")];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_wrapped() {
    // Post-migration form: real human prompt wrapped as
    // {"type":"user_prompt","text":"..."}.
    let msgs = vec![user_prompt("u1", "hello assistant")];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_with_brace_content() {
    // Latent-bug regression: prompts that happened to start with `{` were
    // mis-rendered as system "Event" because the sniff classified them as
    // JSON but they had no `type` field. After wrapping, the literal text
    // is preserved verbatim inside `text`.
    let msgs = vec![user_prompt("u1", r#"{"foo":"bar"}"#)];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_with_file_mentions() {
    // @-mention picker output: text contains `@<path>` substrings and the
    // `files` array carries the same paths. The pipeline should split the
    // text on each match and emit interleaved Text + FileMention parts.
    let msgs = vec![user_prompt_with_files(
        "u1",
        "Please review @src/foo.ts and also @README.md for issues",
        &["src/foo.ts", "README.md"],
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_with_file_mention_at_start() {
    let msgs = vec![user_prompt_with_files(
        "u1",
        "@src/App.tsx is the entry point",
        &["src/App.tsx"],
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_with_dotfile_mention() {
    // Dotfile (no `/`) — the picker can produce these from workspace root.
    let msgs = vec![user_prompt_with_files(
        "u1",
        "fix @.clang-format",
        &[".clang-format"],
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_with_repeated_file_mention() {
    // Same file mentioned twice — both occurrences become badges.
    let msgs = vec![user_prompt_with_files(
        "u1",
        "@src/foo.ts and again @src/foo.ts",
        &["src/foo.ts"],
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_with_overlapping_file_paths() {
    // Longer path should win at overlapping positions: `@src/foo.ts` must
    // produce ONE FileMention("src/foo.ts"), not a FileMention("src/foo")
    // followed by ".ts" plain text.
    let msgs = vec![user_prompt_with_files(
        "u1",
        "see @src/foo.ts",
        &["src/foo", "src/foo.ts"],
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_files_array_present_but_empty() {
    // `files: []` should behave identically to no files field — single
    // Text part with the prompt verbatim.
    let msgs = vec![user_prompt_with_files("u1", "no mentions here", &[])];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_with_image_path_containing_spaces() {
    let msgs = vec![user_prompt_with_files_and_images(
        "u1",
        "Clicking on @/Users/me/Library/Application Support/CleanShot/CleanShot 2026-04-29 at 08.24.35@2x.jpg queues",
        &[],
        &[
            "/Users/me/Library/Application Support/CleanShot/CleanShot 2026-04-29 at 08.24.35@2x.jpg",
        ],
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_with_file_path_containing_spaces() {
    let msgs = vec![user_prompt_with_files_and_images(
        "u1",
        "open @/Users/me/My Project/notes.md please",
        &["/Users/me/My Project/notes.md"],
        &[],
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_with_files_and_images_mixed() {
    let msgs = vec![user_prompt_with_files_and_images(
        "u1",
        "compare @/abs path/notes.md with @/abs path/shot.png",
        &["/abs path/notes.md"],
        &["/abs path/shot.png"],
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_steer_with_image_path_containing_spaces() {
    // Mid-turn steer with an image attachment whose absolute path
    // contains whitespace. Persisted JSON carries `images: [...]`
    // because the sidecar's synthetic event MUST forward both `files`
    // and `images` — without `images`, the adapter has no needle to
    // find the `@<path>` substring with and the badge would vanish on
    // reload while still appearing in the optimistic render.
    let msgs = vec![user_prompt_steer_with_files_and_images(
        "u1",
        "actually look at @/Users/me/Library/Application Support/CleanShot/CleanShot 2026-04-29 at 08.24.35@2x.jpg first",
        &[],
        &[
            "/Users/me/Library/Application Support/CleanShot/CleanShot 2026-04-29 at 08.24.35@2x.jpg",
        ],
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_steer_flag_renders_as_user() {
    // A steer prompt is a regular user turn with `steer: true` added to
    // the JSON payload. The adapter should ignore the flag for rendering
    // (the marker only exists so the UI can later add a distinct badge).
    let msgs = vec![user_prompt_steer("u1", "actually focus on failing tests")];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_prompt_steer_groups_in_same_turn() {
    // Two user prompts in the same turn (initial + steer) + an assistant
    // response between them. Shape check: the second prompt still renders
    // as a user bubble and groups inline with the surrounding messages
    // rather than truncating or dropping.
    let msgs = vec![
        user_prompt("u1", "start investigating"),
        assistant_json(
            "a1",
            json!([{ "type": "text", "text": "Looking into it..." }]),
            None,
        ),
        user_prompt_steer("u2", "focus on failing tests first"),
        assistant_json(
            "a2",
            json!([{ "type": "text", "text": "OK, switching focus." }]),
            None,
        ),
    ];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_json_text_swallowed() {
    // JSON user message with pure text content is dropped (the assistant
    // already has the prompt; this avoids double-rendering).
    let msgs = vec![user_json(
        "u1",
        json!([{ "type": "text", "text": "please do X" }]),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_tool_result_only_no_prev() {
    let msgs = vec![user_json(
        "u1",
        json!([{ "type": "tool_result", "tool_use_id": "tX", "content": "out" }]),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_mixed_text_and_tool_result() {
    let msgs = vec![user_json(
        "u1",
        json!([
            { "type": "text", "text": "note" },
            { "type": "tool_result", "tool_use_id": "tX", "content": "out" }
        ]),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn user_multi_plain_text() {
    let msgs = vec![
        make_record("u1", "user", "first"),
        make_record("u2", "user", "second"),
    ];
    assert_yaml_snapshot!(run_normalized(msgs));
}

// ============================================================================
// 3. Result messages
// ============================================================================

#[test]
fn res_full() {
    let msgs = vec![result_json(
        "r1",
        json!({
            "total_cost_usd": 0.0123,
            "duration_ms": 4500,
            "usage": { "input_tokens": 1234, "output_tokens": 567 }
        }),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn res_duration_only() {
    let msgs = vec![result_json("r1", json!({ "duration_ms": 1500 }))];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn res_duration_long() {
    let msgs = vec![result_json("r1", json!({ "duration_ms": 125_000 }))];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn res_duration_exact_60s() {
    let msgs = vec![result_json("r1", json!({ "duration_ms": 60_000 }))];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn res_duration_short() {
    let msgs = vec![result_json("r1", json!({ "duration_ms": 3456 }))];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn res_large_tokens() {
    let msgs = vec![result_json(
        "r1",
        json!({
            "duration_ms": 2000,
            "usage": { "input_tokens": 1_234_567, "output_tokens": 98_765 }
        }),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

// ============================================================================
// 4. Edge cases
// ============================================================================

#[test]
fn edge_empty_array() {
    assert_yaml_snapshot!(run_normalized(vec![]));
}

#[test]
fn edge_single_assistant_text() {
    let msgs = vec![assistant_json(
        "a1",
        json!([{ "type": "text", "text": "hi" }]),
        None,
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn edge_100_alternating() {
    let mut msgs: Vec<HistoricalRecord> = Vec::new();
    for i in 0..100 {
        if i % 2 == 0 {
            msgs.push(user_prompt(&format!("u{i}"), &format!("msg {i}")));
        } else {
            msgs.push(assistant_json(
                &format!("a{i}"),
                json!([{ "type": "text", "text": format!("reply {i}") }]),
                None,
            ));
        }
    }
    let rendered = MessagePipeline::convert_historical(&msgs);

    // High-level structural summary instead of the full normalized form —
    // the bulk content isn't interesting, the shape is.
    #[derive(Serialize)]
    struct Summary {
        total: usize,
        roles: Vec<String>,
        first_id: Option<String>,
        last_id: Option<String>,
    }
    let summary = Summary {
        total: rendered.len(),
        roles: rendered.iter().map(|m| role_str(&m.role)).collect(),
        first_id: rendered.first().and_then(|m| m.id.clone()),
        last_id: rendered.last().and_then(|m| m.id.clone()),
    };
    assert_yaml_snapshot!(summary);
}

#[test]
fn edge_unknown_type() {
    let parsed = json!({ "type": "mystery_event", "whatever": 1 });
    let msgs = vec![make_record(
        "x1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn edge_no_type_no_role_match() {
    let parsed = json!({ "foo": "bar" });
    let msgs = vec![make_record(
        "x1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn edge_non_json_assistant_fallback() {
    // Legacy / corrupted row: assistant role with non-JSON content. The
    // production write path always serializes assistant turns as JSON, but
    // the loader still tolerates this case by falling back to plain text.
    let msgs = vec![make_record("a1", "assistant", "plain-text streaming")];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn edge_streaming_flag() {
    let msgs = vec![assistant_json(
        "a1",
        json!([{ "type": "text", "text": "streaming..." }]),
        Some(json!({ "__streaming": true })),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn edge_non_json_content_with_malformed_json() {
    // Content looks like JSON but isn't parseable → parsed_content stays
    // None and the adapter falls back to the plain-text rendering path.
    let msgs = vec![make_record("a1", "assistant", "{not really json")];
    assert_yaml_snapshot!(run_normalized(msgs));
}

// ============================================================================
// 5. Selected assistant variants
// ============================================================================

#[test]
fn asst_redacted_thinking() {
    let msgs = vec![assistant_json(
        "a1",
        json!([{ "type": "redacted_thinking", "data": "xxx" }]),
        None,
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

// ---------------------------------------------------------------------------
// Reasoning tri-state: pins the streaming flag + duration_ms shape the
// frontend relies on to distinguish "still streaming" / "just finished live"
// / "historical". A regression here is what surfaces to users as thinking
// blocks that collapse themselves or never show "Thought for Ns".
// ---------------------------------------------------------------------------

#[test]
fn asst_thinking_streaming_in_progress() {
    // Partial snapshot mid-stream — `__is_streaming: true`, no duration yet.
    // Frontend must keep the block open and show "Thinking...".
    let msgs = vec![assistant_json(
        "a1",
        json!([{
            "type": "thinking",
            "thinking": "working it out",
            "__is_streaming": true,
            "__part_id": "a1:blk:0",
        }]),
        None,
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn asst_thinking_live_just_finished() {
    // The shape `handle_assistant` produces the moment the SDK emits its
    // finalized assistant event: explicit `__is_streaming: false` plus
    // `__duration_ms`. Frontend keeps the block open and renders
    // "Thought for Ns" even when React never observed streaming=true
    // (fast block coalesced inside one requestAnimationFrame window).
    let msgs = vec![assistant_json(
        "a1",
        json!([{
            "type": "thinking",
            "thinking": "figured it out fast",
            "__is_streaming": false,
            "__duration_ms": 3200,
            "__part_id": "a1:blk:0",
        }]),
        None,
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn asst_thinking_historical_has_duration_without_streaming_flag() {
    // What a DB reload produces: `flush_assistant` stripped the live-only
    // `__is_streaming` marker, `__duration_ms` survived. Frontend treats
    // this as historical → collapsed by default, still labels "Thought
    // for Ns" once the user expands it.
    let msgs = vec![assistant_json(
        "a1",
        json!([{
            "type": "thinking",
            "thinking": "from last session",
            "__duration_ms": 5000,
            "__part_id": "a1:blk:0",
        }]),
        None,
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn asst_thinking_historical_without_duration() {
    // Thinking blocks persisted before duration tracking landed. Both
    // `streaming` and `duration_ms` should be absent so the frontend
    // falls through to its plain "Thinking" label.
    let msgs = vec![assistant_json(
        "a1",
        json!([{
            "type": "thinking",
            "thinking": "legacy",
            "__part_id": "a1:blk:0",
        }]),
        None,
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn stream_thinking_lifecycle_end_to_end() {
    // Replays the ACTUAL Claude SDK event order captured via
    // `sidecar/scripts/trace-thinking-events.ts`: thinking deltas, then
    // the `assistant` finalized event, then `content_block_stop` (after
    // the assistant event, within the same millisecond). Locks in:
    //
    //   1. Streaming partials expose `streaming: true` while deltas arrive.
    //   2. The finalized assistant emission has `streaming: false` and a
    //      measured `duration_ms` — the fix that prevents fast thinking
    //      blocks from mounting already collapsed on the frontend.
    //   3. `persisted_turn_blocks` keeps `__duration_ms` but drops
    //      `__is_streaming` — historical reloads don't resurrect old
    //      thinking blocks as "just completed".
    //   4. `historical_render` round-trips with `streaming: None` +
    //      `duration_ms` — collapsed by default but labelled correctly.
    let events = vec![
        json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "thinking", "thinking": "", "signature": ""},
            },
            "session_id": "session-1",
        }),
        json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "thinking_delta", "thinking": "Quick thought."},
            },
            "session_id": "session-1",
        }),
        json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "signature_delta", "signature": "sig"},
            },
            "session_id": "session-1",
        }),
        // Real-SDK quirk: the finalized assistant event arrives BEFORE
        // `content_block_stop`. Keep this ordering — without the
        // `started_at_ms` snapshot taken in `handle_assistant`, there'd
        // be no way to recover the duration after `finalize_blocks`
        // wipes `self.blocks`.
        json!({
            "type": "assistant",
            "message": {
                "id": "msg_1",
                "role": "assistant",
                "content": [{
                    "type": "thinking",
                    "thinking": "Quick thought.",
                    "signature": "sig",
                }],
            },
            "session_id": "session-1",
        }),
        json!({
            "type": "stream_event",
            "event": {"type": "content_block_stop", "index": 0},
            "session_id": "session-1",
        }),
        json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 1,
                "content_block": {"type": "text", "text": ""},
            },
            "session_id": "session-1",
        }),
        json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 1,
                "delta": {"type": "text_delta", "text": "Done."},
            },
            "session_id": "session-1",
        }),
        json!({
            "type": "assistant",
            "message": {
                "id": "msg_1",
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "Quick thought.", "signature": "sig"},
                    {"type": "text", "text": "Done."},
                ],
            },
            "session_id": "session-1",
        }),
        json!({
            "type": "stream_event",
            "event": {"type": "content_block_stop", "index": 1},
            "session_id": "session-1",
        }),
    ];

    let fingerprint = replay_stream_events("claude", &events);
    assert_yaml_snapshot!(normalize_stream_fingerprint(&fingerprint));
}

#[test]
fn asst_server_tool_use() {
    let msgs = vec![assistant_json(
        "a1",
        json!([{ "type": "server_tool_use", "id": "st1", "name": "WebSearch", "input": { "query": "foo" } }]),
        None,
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn asst_exit_plan_mode_renders_as_plan_review_card() {
    let msgs = vec![exit_plan_mode(
        "a1",
        "tool-plan-1",
        "1. Review the plan\n2. Approve the mode",
        Some("/tmp/plan.md"),
        &[("Read", "Open the implementation notes")],
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn merge_keeps_exit_plan_mode_as_separate_assistant_message() {
    let msgs = vec![
        assistant_json(
            "a1",
            json!([{ "type": "text", "text": "Plan complete." }]),
            Some(json!({ "type": "assistant" })),
        ),
        exit_plan_mode("a2", "tool-plan-1", "1. Review the plan", None, &[]),
    ];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn exit_plan_mode_empty_allowed_prompts_serializes_as_empty_array() {
    let msgs = vec![exit_plan_mode("a1", "tool-1", "Do the thing.", None, &[])];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn exit_plan_mode_missing_plan_file_path() {
    let msgs = vec![exit_plan_mode(
        "a1",
        "tool-1",
        "1. Step one\n2. Step two",
        None,
        &[("Bash", "run tests"), ("Read", "check files")],
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn asst_tool_use_missing_id_name() {
    let msgs = vec![assistant_json(
        "a1",
        json!([
            { "type": "tool_use", "input": { "x": 1 } },
            { "type": "tool_use", "input": { "y": 2 } }
        ]),
        None,
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn asst_merge_tool_result_with_image_block() {
    // Image blocks must NOT break the all-tool-result detection — merge still succeeds.
    let msgs = vec![
        assistant_json(
            "a1",
            json!([{ "type": "tool_use", "id": "t1", "name": "Bash", "input": { "command": "ls" } }]),
            None,
        ),
        user_json(
            "u1",
            json!([
                { "type": "tool_result", "tool_use_id": "t1", "content": "file-a" },
                { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "xxx" } }
            ]),
        ),
    ];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn asst_empty_content_fallback() {
    // assistant message with empty JSON content array + text fallback field
    let parsed = json!({
        "type": "assistant",
        "message": { "role": "assistant", "content": [] },
        "text": "fallback text"
    });
    let msgs = vec![make_record(
        "a1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn asst_unknown_error_prefers_message_text() {
    let msgs = vec![assistant_json(
        "a1",
        json!([{
            "type": "text",
            "text": "API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"
        }]),
        Some(json!({ "error": "unknown" })),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

// ============================================================================
// 6. System messages
// ============================================================================

#[test]
fn sys_error_max_turns_rendered() {
    let msgs = vec![system_json("s1", json!({ "subtype": "error_max_turns" }))];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn sys_no_subtype() {
    let msgs = vec![system_json("s1", json!({}))];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn sys_codex_missing_response_item_recovery_notice() {
    let msgs = vec![system_json(
        "s1",
        json!({ "subtype": "codex_missing_response_item_recovery" }),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn sys_codex_goal_status_notice() {
    let msgs = vec![system_json(
        "s1",
        json!({
            "subtype": "codex_goal_status",
            "action": "set",
            "status": "set",
            "objective": "Ship the goals status UI",
        }),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn sys_goal_assignee_report_renders_message_body() {
    let parsed = json!({
        "type": "goal_assignee_report",
        "message": "## Assignee Report Received\n\nCard: Build API\nReport type: completed",
        "excerpt": "## Completed Done"
    });
    let msgs = vec![make_record(
        "s1",
        "system",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

// ============================================================================
// 7. Merge boundaries
// ============================================================================

#[test]
fn merge_broken_by_real_user() {
    let msgs = vec![
        assistant_json("a1", json!([{ "type": "text", "text": "hello" }]), None),
        user_prompt("u1", "more please"),
        assistant_json("a2", json!([{ "type": "text", "text": "world" }]), None),
    ];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn merge_streaming_flag_from_latest() {
    // Latest assistant sets streaming; earlier one does not — merged result
    // must reflect the latest streaming flag only.
    let msgs = vec![
        assistant_json("a1", json!([{ "type": "text", "text": "done" }]), None),
        assistant_json(
            "a2",
            json!([{ "type": "text", "text": "streaming..." }]),
            Some(json!({ "__streaming": true })),
        ),
    ];
    assert_yaml_snapshot!(run_normalized(msgs));
}

// ============================================================================
// 8. Collapse recursion into sub-agent children
// ============================================================================

#[test]
fn collapse_agent_children_reads() {
    // An Agent tool whose children contain 3 consecutive Read calls. The
    // collapse pass must recurse into children and fold them into a single
    // CollapsedGroup, not leave them as 3 separate parts.
    let msgs = vec![
        user_prompt("u1", "find and read the pipeline files"),
        assistant_json(
            "a1",
            json!([{
                "type": "tool_use",
                "id": "agent-1",
                "name": "Agent",
                "input": { "description": "explore pipeline" }
            }]),
            None,
        ),
        // Child assistant messages — grouped under agent-1 by ID prefix
        assistant_json(
            "child:agent-1:c1",
            json!([{
                "type": "tool_use",
                "id": "r1",
                "name": "Read",
                "input": { "file_path": "/src/pipeline/mod.rs" }
            }]),
            None,
        ),
        // Simulate tool result for first Read
        user_json(
            "child:agent-1:c2",
            json!([{ "type": "tool_result", "tool_use_id": "r1", "content": "mod pipeline;" }]),
        ),
        assistant_json(
            "child:agent-1:c3",
            json!([{
                "type": "tool_use",
                "id": "r2",
                "name": "Read",
                "input": { "file_path": "/src/pipeline/types.rs" }
            }]),
            None,
        ),
        user_json(
            "child:agent-1:c4",
            json!([{ "type": "tool_result", "tool_use_id": "r2", "content": "pub struct..." }]),
        ),
        assistant_json(
            "child:agent-1:c5",
            json!([{
                "type": "tool_use",
                "id": "r3",
                "name": "Read",
                "input": { "file_path": "/src/pipeline/collapse.rs" }
            }]),
            None,
        ),
        user_json(
            "child:agent-1:c6",
            json!([{ "type": "tool_result", "tool_use_id": "r3", "content": "pub fn collapse..." }]),
        ),
        // Agent result comes back on the main assistant
        user_json(
            "u2",
            json!([{ "type": "tool_result", "tool_use_id": "agent-1", "content": "done" }]),
        ),
        assistant_json(
            "a2",
            json!([{ "type": "text", "text": "I've read all three pipeline files." }]),
            None,
        ),
    ];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn collapse_agent_children_mixed_with_text() {
    // Agent children with searches, then text, then reads. The text should
    // break the groups just like at the top level.
    let msgs = vec![
        user_prompt("u1", "investigate the bug"),
        assistant_json(
            "a1",
            json!([{
                "type": "tool_use",
                "id": "agent-2",
                "name": "Agent",
                "input": { "description": "debug issue" }
            }]),
            None,
        ),
        // Two Grep children
        assistant_json(
            "child:agent-2:c1",
            json!([{
                "type": "tool_use",
                "id": "g1",
                "name": "Grep",
                "input": { "pattern": "collapse_pass" }
            }]),
            None,
        ),
        user_json(
            "child:agent-2:c2",
            json!([{ "type": "tool_result", "tool_use_id": "g1", "content": "found 3 matches" }]),
        ),
        assistant_json(
            "child:agent-2:c3",
            json!([{
                "type": "tool_use",
                "id": "g2",
                "name": "Grep",
                "input": { "pattern": "children" }
            }]),
            None,
        ),
        user_json(
            "child:agent-2:c4",
            json!([{ "type": "tool_result", "tool_use_id": "g2", "content": "found 5 matches" }]),
        ),
        // Text analysis in the middle
        assistant_json(
            "child:agent-2:c5",
            json!([{ "type": "text", "text": "Now let me read the relevant files." }]),
            None,
        ),
        // Two Read children
        assistant_json(
            "child:agent-2:c6",
            json!([{
                "type": "tool_use",
                "id": "r1",
                "name": "Read",
                "input": { "file_path": "/src/collapse.rs" }
            }]),
            None,
        ),
        user_json(
            "child:agent-2:c7",
            json!([{ "type": "tool_result", "tool_use_id": "r1", "content": "fn collapse..." }]),
        ),
        assistant_json(
            "child:agent-2:c8",
            json!([{
                "type": "tool_use",
                "id": "r2",
                "name": "Read",
                "input": { "file_path": "/src/types.rs" }
            }]),
            None,
        ),
        user_json(
            "child:agent-2:c9",
            json!([{ "type": "tool_result", "tool_use_id": "r2", "content": "struct Types..." }]),
        ),
        // Agent wraps up
        user_json(
            "u2",
            json!([{ "type": "tool_result", "tool_use_id": "agent-2", "content": "analysis complete" }]),
        ),
        assistant_json(
            "a2",
            json!([{ "type": "text", "text": "Found the bug in the collapse pass." }]),
            None,
        ),
    ];
    assert_yaml_snapshot!(run_normalized(msgs));
}

// ============================================================================
// 9. Codex item.completed historical loading
// ============================================================================
//
// The Codex SDK persists each `item.completed` event as its own DB row.
// item.type=agent_message → assistant text, item.type=command_execution →
// Bash tool call. Both must render in the historical-load path. Before
// 2026-04-08 the adapter only handled agent_message — every command_execution
// row got silently dropped on reload, leaving the user with a wall of text
// and no visible tool calls.

#[test]
fn codex_item_command_execution_renders_as_bash_tool_call() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "item_1",
            "type": "command_execution",
            "command": "ls -la",
            "aggregated_output": "total 4\n.\n..\nREADME.md",
            "status": "completed",
            "exit_code": 0
        }
    });
    let msgs = vec![make_record(
        "c1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_item_command_execution_failed_includes_exit_code() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "item_2",
            "type": "command_execution",
            "command": "false",
            "aggregated_output": "stderr line",
            "status": "failed",
            "exit_code": 1
        }
    });
    let msgs = vec![make_record(
        "c2",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_item_command_execution_legacy_output_field() {
    // Older fixtures (and possibly older SDK builds) used `output` instead
    // of `aggregated_output`. Both must work — pin the fallback so a future
    // cleanup doesn't accidentally drop the legacy reader.
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "item_3",
            "type": "command_execution",
            "command": "echo hello",
            "output": "hello",
            "exit_code": 0
        }
    });
    let msgs = vec![make_record(
        "c3",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_item_completed_full_session_with_text_and_commands() {
    // Realistic Codex session pattern: text → command → text. The middle
    // command_execution must NOT be dropped (the original bug); the merge
    // pass should fold all three into a single assistant turn with three
    // content parts in the original order.
    let agent_message_1 = json!({
        "type": "item.completed",
        "item": {
            "id": "item_0",
            "type": "agent_message",
            "text": "Let me check the directory."
        }
    });
    let command = json!({
        "type": "item.completed",
        "item": {
            "id": "item_1",
            "type": "command_execution",
            "command": "ls",
            "aggregated_output": "README.md",
            "status": "completed",
            "exit_code": 0
        }
    });
    let agent_message_2 = json!({
        "type": "item.completed",
        "item": {
            "id": "item_2",
            "type": "agent_message",
            "text": "There's only README.md."
        }
    });
    let msgs = vec![
        make_record(
            "c1",
            "assistant",
            &serde_json::to_string(&agent_message_1).unwrap(),
        ),
        make_record("c2", "assistant", &serde_json::to_string(&command).unwrap()),
        make_record(
            "c3",
            "assistant",
            &serde_json::to_string(&agent_message_2).unwrap(),
        ),
    ];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_item_completed_consecutive_git_show_commands_collapse() {
    let command_1 = json!({
        "type": "item.completed",
        "item": {
            "id": "item_git_1",
            "type": "command_execution",
            "command": "/bin/zsh -lc 'git show --unified=80 --no-ext-diff 4ca2fe1 -- sidecar/src/claude-session-manager.ts sidecar/test/claude-session-manager.test.ts src-tauri/src/agents/queries.rs src/lib/workspace-helpers.test.ts'",
            "aggregated_output": "diff --git a/sidecar/src/claude-session-manager.ts b/sidecar/src/claude-session-manager.ts",
            "status": "completed",
            "exit_code": 0
        }
    });
    let command_2 = json!({
        "type": "item.completed",
        "item": {
            "id": "item_git_2",
            "type": "command_execution",
            "command": "/bin/zsh -lc 'git show --unified=80 --no-ext-diff 9b19755 -- src-tauri/src/models/sessions.rs src/lib/workspace-helpers.ts src/features/composer/container.tsx src/features/settings/panels/repository-settings.tsx src/features/settings/index.tsx src/features/composer/index.tsx'",
            "aggregated_output": "diff --git a/src-tauri/src/models/sessions.rs b/src-tauri/src/models/sessions.rs",
            "status": "completed",
            "exit_code": 0
        }
    });
    let msgs = vec![
        make_record(
            "c_git_1",
            "assistant",
            &serde_json::to_string(&command_1).unwrap(),
        ),
        make_record(
            "c_git_2",
            "assistant",
            &serde_json::to_string(&command_2).unwrap(),
        ),
    ];
    assert_yaml_snapshot!(run_normalized(msgs));
}

// ============================================================================
// 9b. Codex plan item, MCP tool call, web search, turn lifecycle
// ============================================================================

#[test]
fn codex_plan_item_renders_as_plan_review() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "plan_1",
            "type": "plan",
            "text": "## Implementation Plan\n\n1. Read codebase\n2. Write tests\n3. Fix bugs"
        }
    });
    let msgs = vec![make_record(
        "p1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_plan_item_empty_text_is_skipped() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "plan_2",
            "type": "plan",
            "text": ""
        }
    });
    let msgs = vec![make_record(
        "p2",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    let result = run_normalized(msgs);
    assert!(
        result.is_empty(),
        "Empty plan text should produce no output"
    );
}

#[test]
fn codex_web_search_item_renders_as_tool_call() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "ws_1",
            "type": "web_search",
            "query": "rust testing frameworks"
        }
    });
    let msgs = vec![make_record(
        "ws1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_web_search_with_action_passes_through() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "ws_2",
            "type": "web_search",
            "query": "openai codex",
            "action": { "type": "openPage", "url": "https://openai.com/codex" }
        }
    });
    let msgs = vec![make_record(
        "ws2",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_image_generation_renders_as_image() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "img_1",
            "type": "image_generation",
            "status": "completed",
            "revised_prompt": "A small architecture diagram",
            "result": "iVBORw0KGgo="
        }
    });
    let msgs = vec![make_record(
        "img1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_image_generation_saved_path_renders_as_file_image() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "img_2",
            "type": "image_generation",
            "status": "completed",
            "saved_path": "/tmp/helmor/generated-images/session/img_2.png"
        }
    });
    let msgs = vec![make_record(
        "img2",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_mcp_tool_call_renders_as_tool_call() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "mcp_1",
            "type": "mcp_tool_call",
            "server": "myserver",
            "tool": "query",
            "arguments": {"q": "hello"},
            "status": "completed",
            "result": {"text": "world"}
        }
    });
    let msgs = vec![make_record(
        "mcp1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_pi_mcp_tool_call_text_result_renders_as_tool_output() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "pi_read_1",
            "type": "mcp_tool_call",
            "server": "pi",
            "tool": "read",
            "arguments": {"path": "src/App.tsx", "limit": 20},
            "status": "completed",
            "result": {"content": [{"type": "text", "text": "file contents"}]}
        }
    });
    let msgs = vec![make_record(
        "pi-mcp1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_pi_reasoning_item_renders_historical_collapsed_with_duration() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "pi_reasoning_1",
            "type": "reasoning",
            "text": "Pi considered the goal state before calling tools.",
            "duration_ms": 2400
        }
    });
    let msgs = vec![make_record(
        "pi-reasoning1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_pi_legacy_text_before_reasoning_reorders_by_matching_turn_id() {
    // Older Pi normalization reserved the agent_message row at message_start,
    // then completed that row with final text before the matching reasoning
    // item completed. Historical reload should still render the thinking
    // before the text because the Pi session content order is
    // reasoning -> text.
    let text = json!({
        "type": "item.completed",
        "item": {
            "id": "pi-message-request-a-0",
            "type": "agent_message",
            "text": "Final answer."
        }
    });
    let reasoning = json!({
        "type": "item.completed",
        "item": {
            "id": "pi-reasoning-request-a-0",
            "type": "reasoning",
            "text": "Thought first.",
            "duration_ms": 1500
        }
    });
    let msgs = vec![
        make_record(
            "codex-item:pi-message-request-a-0",
            "assistant",
            &serde_json::to_string(&text).unwrap(),
        ),
        make_record(
            "codex-reasoning:pi-reasoning-request-a-0",
            "assistant",
            &serde_json::to_string(&reasoning).unwrap(),
        ),
    ];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_pi_reasoning_lifecycle_end_to_end() {
    let events = vec![
        json!({"type": "turn/started", "turn": {"id": "pi-turn-request-a-0"}, "session_id": "session-1"}),
        json!({"type": "item/started", "item": {"id": "pi-reasoning-request-a-0", "type": "reasoning", "text": ""}, "session_id": "session-1"}),
        json!({"type": "item/reasoning/textDelta", "itemId": "pi-reasoning-request-a-0", "text": "Pi is thinking."}),
        json!({"type": "item/started", "item": {"id": "pi-read-1", "type": "mcp_tool_call", "server": "pi", "tool": "read", "arguments": {"path": "README.md"}, "status": "in_progress"}, "session_id": "session-1"}),
        json!({"type": "item/completed", "item": {"id": "pi-reasoning-request-a-0", "type": "reasoning", "text": "Pi is thinking."}, "session_id": "session-1"}),
        json!({"type": "item/completed", "item": {"id": "pi-read-1", "type": "mcp_tool_call", "server": "pi", "tool": "read", "arguments": {"path": "README.md"}, "status": "completed", "result": {"content": [{"type": "text", "text": "Readme"}]}}, "session_id": "session-1"}),
        json!({"type": "item/started", "item": {"id": "pi-message-request-a-0", "type": "agent_message", "text": ""}, "session_id": "session-1"}),
        json!({"type": "item/agentMessage/delta", "itemId": "pi-message-request-a-0", "text": "Done."}),
        json!({"type": "item/completed", "item": {"id": "pi-message-request-a-0", "type": "agent_message", "text": "Done."}, "session_id": "session-1"}),
        json!({"type": "turn/completed", "turn": {"id": "pi-turn-request-a-0", "status": "completed"}, "session_id": "session-1"}),
    ];

    let fingerprint = replay_stream_events("codex", &events);
    assert_yaml_snapshot!(normalize_stream_fingerprint(&fingerprint));
}

#[test]
fn codex_turn_completed_with_duration_shows_result_label() {
    let parsed = json!({
        "type": "turn/completed",
        "duration_ms": 5432.0,
        "usage": {"input_tokens": 1000, "output_tokens": 200}
    });
    let msgs = vec![make_record(
        "tc1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_turn_completed_empty_produces_no_output() {
    // turn/completed with no duration or meaningful data → empty label → skipped
    let parsed = json!({"type": "turn/completed"});
    let msgs = vec![make_record(
        "tc2",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    let result = run_normalized(msgs);
    assert!(
        result.is_empty(),
        "turn/completed with no data should produce no output"
    );
}

#[test]
fn codex_turn_failed_renders_error() {
    let parsed = json!({
        "type": "turn/failed",
        "error": {"message": "API rate limit exceeded"}
    });
    let msgs = vec![make_record(
        "tf1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_legacy_turn_dot_completed_still_works() {
    // Legacy format with dot separator should still be handled
    let parsed = json!({
        "type": "turn.completed",
        "duration_ms": 3000.0
    });
    let msgs = vec![make_record(
        "tc3",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

// ---------------------------------------------------------------------------
// Codex file_change → apply_patch
// ---------------------------------------------------------------------------

#[test]
fn codex_file_change_single_file_renders_as_apply_patch() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "fc_1",
            "type": "file_change",
            "changes": [
                { "path": "/src/lib.rs", "kind": "modify", "diff": "-old\n+new\n+extra" }
            ],
            "status": "completed"
        }
    });
    let msgs = vec![make_record(
        "fc1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_file_change_multi_file() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "fc_2",
            "type": "file_change",
            "changes": [
                { "path": "/src/a.ts", "kind": "modify", "diff": "-old\n+new" },
                { "path": "/src/b.ts", "kind": "create", "diff": "+line1\n+line2" }
            ],
            "status": "completed"
        }
    });
    let msgs = vec![make_record(
        "fc2",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_file_change_failed() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "fc_3",
            "type": "file_change",
            "changes": [
                { "path": "/src/main.rs", "kind": "modify", "diff": "-x\n+y" }
            ],
            "status": "failed"
        }
    });
    let msgs = vec![make_record(
        "fc3",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn codex_file_change_empty_changes() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "fc_4",
            "type": "file_change",
            "changes": [],
            "status": "completed"
        }
    });
    let msgs = vec![make_record(
        "fc4",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn pi_file_change_write_historical_preserves_file_and_result_details() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "pi_write_1",
            "type": "file_change",
            "changes": [
                {
                    "path": "src/new.ts",
                    "kind": "create",
                    "diff": "+one\n+two",
                    "contentLength": 7
                }
            ],
            "status": "completed",
            "result": {
                "content": [
                    { "type": "text", "text": "Successfully wrote 7 bytes to src/new.ts" }
                ]
            }
        }
    });
    let msgs = vec![make_record(
        "piw1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn pi_file_change_failed_historical_preserves_error_details() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "pi_edit_failed",
            "type": "file_change",
            "changes": [
                { "path": "src/app.ts", "kind": "modify", "diff": "-missing\n+new" }
            ],
            "status": "failed",
            "result": {
                "content": [
                    { "type": "text", "text": "Could not find edits[0] in src/app.ts." }
                ]
            }
        }
    });
    let msgs = vec![make_record(
        "pif1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[derive(Serialize)]
struct FileChangeRenderPair {
    live: Vec<common::NormThreadMessage>,
    historical: Vec<common::NormThreadMessage>,
}

#[test]
fn pi_file_change_live_and_historical_reload_match() {
    let event = json!({
        "type": "item/completed",
        "item": {
            "id": "pi_edit_1",
            "type": "file_change",
            "changes": [
                { "path": "src/app.ts", "kind": "modify", "diff": "-1 old\n+1 new" }
            ],
            "status": "completed",
            "result": {
                "content": [
                    { "type": "text", "text": "Successfully replaced 1 block(s) in src/app.ts." }
                ],
                "details": { "diff": "-1 old\n+1 new", "firstChangedLine": 1 }
            }
        }
    });
    let line = serde_json::to_string(&event).unwrap();
    let mut pipeline = MessagePipeline::new("pi", "test-model", "ctx", "sess");
    let live = match pipeline.push_event(&event, &line) {
        PipelineEmit::Full(messages) => normalize_all(&messages),
        PipelineEmit::Partial(message) => normalize_all(&[message]),
        PipelineEmit::Delta(delta) => normalize_all(&[delta_to_message(delta)]),
        PipelineEmit::None => Vec::new(),
    };
    pipeline.accumulator.flush_pending();
    let historical_records: Vec<_> = (0..pipeline.accumulator.turns_len())
        .map(|i| {
            let turn = pipeline.accumulator.turn_at(i);
            HistoricalRecord {
                id: format!("hist-{i}"),
                role: turn.role,
                content: turn.content_json.clone(),
                parsed_content: serde_json::from_str(&turn.content_json).ok(),
                created_at: "2026-04-08T00:00:00.000Z".to_string(),
            }
        })
        .collect();
    let historical = normalize_all(&MessagePipeline::convert_historical(&historical_records));

    assert_yaml_snapshot!(FileChangeRenderPair { live, historical });
}

fn delta_to_message(delta: helmor_lib::pipeline::StreamingTextDelta) -> ThreadMessageLike {
    let part = match delta.part_type {
        helmor_lib::pipeline::StreamingTextDeltaPartType::Text => MessagePart::Text {
            id: delta.part_id,
            text: delta.text_delta,
        },
        helmor_lib::pipeline::StreamingTextDeltaPartType::Reasoning => MessagePart::Reasoning {
            id: delta.part_id,
            text: delta.text_delta,
            streaming: Some(true),
            duration_ms: None,
        },
    };
    ThreadMessageLike {
        role: helmor_lib::pipeline::types::MessageRole::Assistant,
        id: Some(delta.message_id),
        created_at: None,
        content: vec![ExtendedMessagePart::Basic(part)],
        status: None,
        streaming: Some(true),
    }
}

#[test]
fn asst_pi_generic_card_renders_extension_output() {
    let parsed = json!({
        "type": "item.completed",
        "item": {
            "id": "pi-extension-1",
            "type": "generic_card",
            "provider": "pi",
            "title": "Pi extension notification",
            "subtitle": "demo-extension",
            "severity": "warning",
            "body": "Custom UI is not available yet",
            "details": { "action": "custom" }
        }
    });
    let msgs = vec![make_record(
        "pi-card-1",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}

#[test]
fn asst_delegation_anchor_historical() {
    let parsed = json!({
        "type": "delegation_anchor",
        "delegationId": "delegation-1",
        "parentSessionId": "parent-1",
        "childSessionId": "child-1",
        "title": "Inspect parser",
        "provider": "codex",
        "modelId": "gpt-5.4",
        "status": "succeeded",
        "outputSchema": { "type": "object", "properties": { "summary": { "type": "string" } } },
        "structuredResult": { "summary": "ok" },
        "startedAt": "2026-05-08T00:00:00Z",
        "completedAt": "2026-05-08T00:00:05Z"
    });
    let msgs = vec![make_record(
        "delegation-anchor-message",
        "assistant",
        &serde_json::to_string(&parsed).unwrap(),
    )];
    assert_yaml_snapshot!(run_normalized(msgs));
}
