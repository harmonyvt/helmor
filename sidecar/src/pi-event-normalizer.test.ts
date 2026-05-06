import { describe, expect, test } from "bun:test";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { createPiEventState, normalizePiEvent } from "./pi-event-normalizer.js";

describe("Pi event normalization", () => {
	test("maps assistant text deltas to codex-like item events", () => {
		const state = createPiEventState();
		expect(
			normalizePiEvent(
				{ type: "turn_start", turnIndex: 0, timestamp: 1 } as AgentSessionEvent,
				state,
			),
		).toEqual([{ type: "turn/started", turn: { id: "pi-turn-0" } }]);
		expect(
			normalizePiEvent(
				{
					type: "message_start",
					message: { role: "assistant", responseId: "msg-1", content: [] },
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/started",
				item: { id: "msg-1", type: "agent_message", text: "" },
			},
		]);
		expect(
			normalizePiEvent(
				{
					type: "message_update",
					message: { role: "assistant", responseId: "msg-1", content: [] },
					assistantMessageEvent: { type: "text_delta", delta: "hello" },
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{ type: "item/agentMessage/delta", itemId: "msg-1", text: "hello" },
		]);
		expect(
			normalizePiEvent(
				{
					type: "message_end",
					message: {
						role: "assistant",
						responseId: "msg-1",
						content: [{ type: "text", text: "hello" }],
					},
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/completed",
				item: { id: "msg-1", type: "agent_message", text: "hello" },
			},
		]);
	});

	test("maps bash tool lifecycle to command execution items", () => {
		const state = createPiEventState();
		expect(
			normalizePiEvent(
				{
					type: "tool_execution_start",
					toolCallId: "tool-1",
					toolName: "bash",
					args: { command: "pwd" },
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/started",
				item: {
					id: "tool-1",
					type: "command_execution",
					command: "pwd",
					aggregated_output: "",
				},
			},
		]);
		expect(
			normalizePiEvent(
				{
					type: "tool_execution_update",
					toolCallId: "tool-1",
					toolName: "bash",
					args: { command: "pwd" },
					partialResult: { content: [{ type: "text", text: "/tmp" }] },
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/commandExecution/outputDelta",
				itemId: "tool-1",
				output: "/tmp",
			},
		]);
		expect(
			normalizePiEvent(
				{
					type: "tool_execution_end",
					toolCallId: "tool-1",
					toolName: "bash",
					result: { content: [{ type: "text", text: "/tmp" }] },
					isError: false,
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/completed",
				item: {
					id: "tool-1",
					type: "command_execution",
					command: "pwd",
					aggregated_output: "/tmp",
					exit_code: 0,
				},
			},
		]);
	});

	test("persists accumulated reasoning when thinking_end omits content", () => {
		const state = createPiEventState("request-a");
		expect(
			normalizePiEvent(
				{
					type: "message_update",
					message: { role: "assistant", content: [] },
					assistantMessageEvent: { type: "thinking_start" },
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/started",
				item: { id: "pi-reasoning-request-a-0", type: "reasoning", text: "" },
			},
		]);
		normalizePiEvent(
			{
				type: "message_update",
				message: { role: "assistant", content: [] },
				assistantMessageEvent: { type: "thinking_delta", delta: "step one" },
			} as unknown as AgentSessionEvent,
			state,
		);
		normalizePiEvent(
			{
				type: "message_update",
				message: { role: "assistant", content: [] },
				assistantMessageEvent: { type: "thinking_delta", delta: " and two" },
			} as unknown as AgentSessionEvent,
			state,
		);

		expect(
			normalizePiEvent(
				{
					type: "message_update",
					message: { role: "assistant", content: [] },
					assistantMessageEvent: { type: "thinking_end" },
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/completed",
				item: {
					id: "pi-reasoning-request-a-0",
					type: "reasoning",
					text: "step one and two",
				},
			},
		]);
	});

	test("preserves Pi MCP tool arguments when completion events omit args", () => {
		const state = createPiEventState();
		normalizePiEvent(
			{
				type: "tool_execution_start",
				toolCallId: "tool-read",
				toolName: "read",
				args: { path: "src/App.tsx", limit: 40 },
			} as unknown as AgentSessionEvent,
			state,
		);

		expect(
			normalizePiEvent(
				{
					type: "tool_execution_end",
					toolCallId: "tool-read",
					toolName: "read",
					result: { content: [{ type: "text", text: "content" }] },
					isError: false,
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/completed",
				item: {
					id: "tool-read",
					type: "mcp_tool_call",
					server: "pi",
					tool: "read",
					arguments: { path: "src/App.tsx", limit: 40 },
					status: "completed",
					result: { content: [{ type: "text", text: "content" }] },
				},
			},
		]);
	});

	test("scopes fallback assistant message IDs by request ID", () => {
		const first = createPiEventState("request-a");
		const second = createPiEventState("request-b");

		expect(
			normalizePiEvent(
				{
					type: "message_start",
					message: { role: "assistant", content: [] },
				} as unknown as AgentSessionEvent,
				first,
			),
		).toEqual([
			{
				type: "item/started",
				item: {
					id: "pi-message-request-a-0",
					type: "agent_message",
					text: "",
				},
			},
		]);
		expect(
			normalizePiEvent(
				{
					type: "message_start",
					message: { role: "assistant", content: [] },
				} as unknown as AgentSessionEvent,
				second,
			),
		).toEqual([
			{
				type: "item/started",
				item: {
					id: "pi-message-request-b-0",
					type: "agent_message",
					text: "",
				},
			},
		]);
	});

	test("scopes reasoning IDs by content index and fallback turn index", () => {
		const state = createPiEventState("request-a");

		expect(
			normalizePiEvent(
				{ type: "turn_start", timestamp: 1 } as AgentSessionEvent,
				state,
			),
		).toEqual([{ type: "turn/started", turn: { id: "pi-turn-request-a-0" } }]);
		expect(
			normalizePiEvent(
				{
					type: "message_update",
					message: { role: "assistant", content: [] },
					assistantMessageEvent: { type: "thinking_start", contentIndex: 1 },
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/started",
				item: {
					id: "pi-reasoning-request-a-0-1",
					type: "reasoning",
					text: "",
				},
			},
		]);
		expect(
			normalizePiEvent(
				{
					type: "message_update",
					message: { role: "assistant", content: [] },
					assistantMessageEvent: {
						type: "thinking_delta",
						contentIndex: 1,
						delta: "indexed thought",
					},
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/reasoning/textDelta",
				itemId: "pi-reasoning-request-a-0-1",
				text: "indexed thought",
			},
		]);
		normalizePiEvent(
			{
				type: "turn_end",
				message: { role: "assistant", usage: { input: 1, output: 2 } },
			} as unknown as AgentSessionEvent,
			state,
		);
		expect(
			normalizePiEvent(
				{ type: "turn_start", timestamp: 2 } as AgentSessionEvent,
				state,
			),
		).toEqual([{ type: "turn/started", turn: { id: "pi-turn-request-a-1" } }]);
	});

	test("surfaces unknown Pi events as diagnostic cards", () => {
		const state = createPiEventState("request-a");

		expect(
			normalizePiEvent(
				{
					type: "new_transcript_event",
					payload: { text: "surprise" },
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/completed",
				item: {
					id: "pi-unknown-request-a-0-new_transcript_event",
					type: "generic_card",
					provider: "pi",
					severity: "warning",
					title: "Pi SDK event not rendered",
					body: "Unhandled Pi event: new_transcript_event",
					details: {
						type: "new_transcript_event",
						payload: { text: "surprise" },
					},
				},
			},
		]);
	});

	test("turns assistant error completions into sidecar errors", () => {
		const state = createPiEventState("request-a");

		expect(
			normalizePiEvent(
				{
					type: "message_end",
					message: {
						role: "assistant",
						stopReason: "error",
						errorMessage: "Provider returned no chunks",
						content: [],
					},
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "error",
				message: "Pi error: Provider returned no chunks",
			},
		]);
	});
});
