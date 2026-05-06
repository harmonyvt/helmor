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

	test("maps Pi write to file_change with file path and synthetic additions", () => {
		const state = createPiEventState();

		expect(
			normalizePiEvent(
				{
					type: "tool_execution_end",
					toolCallId: "tool-write",
					toolName: "write",
					args: { path: "src/new.ts", content: "one\ntwo" },
					result: {
						content: [
							{
								type: "text",
								text: "Successfully wrote 7 bytes to src/new.ts",
							},
						],
					},
					isError: false,
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/completed",
				item: {
					id: "tool-write",
					type: "file_change",
					changes: [
						{
							path: "src/new.ts",
							kind: "create",
							diff: "+one\n+two",
							contentLength: 7,
						},
					],
					status: "completed",
					result: {
						content: [
							{
								type: "text",
								text: "Successfully wrote 7 bytes to src/new.ts",
							},
						],
					},
				},
			},
		]);
	});

	test("maps Pi edit to file_change using result diff when available", () => {
		const state = createPiEventState();
		normalizePiEvent(
			{
				type: "tool_execution_start",
				toolCallId: "tool-edit",
				toolName: "edit",
				args: {
					path: "src/app.ts",
					edits: [{ oldText: "old", newText: "new" }],
				},
			} as unknown as AgentSessionEvent,
			state,
		);

		expect(
			normalizePiEvent(
				{
					type: "tool_execution_end",
					toolCallId: "tool-edit",
					toolName: "edit",
					result: {
						content: [
							{
								type: "text",
								text: "Successfully replaced 1 block(s) in src/app.ts.",
							},
						],
						details: { diff: "-1 old\n+1 new", firstChangedLine: 1 },
					},
					isError: false,
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/completed",
				item: {
					id: "tool-edit",
					type: "file_change",
					changes: [
						{
							path: "src/app.ts",
							kind: "modify",
							diff: "-1 old\n+1 new",
							edits: [{ oldText: "old", newText: "new" }],
						},
					],
					status: "completed",
					result: {
						content: [
							{
								type: "text",
								text: "Successfully replaced 1 block(s) in src/app.ts.",
							},
						],
						details: { diff: "-1 old\n+1 new", firstChangedLine: 1 },
					},
				},
			},
		]);
	});

	test("preserves Pi edit path and failure result details", () => {
		const state = createPiEventState();

		expect(
			normalizePiEvent(
				{
					type: "tool_execution_end",
					toolCallId: "tool-edit-failed",
					toolName: "edit",
					args: { path: "src/app.ts", oldText: "missing", newText: "new" },
					result: {
						content: [
							{
								type: "text",
								text: "Could not find edits[0] in src/app.ts.",
							},
						],
					},
					isError: true,
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/completed",
				item: {
					id: "tool-edit-failed",
					type: "file_change",
					changes: [
						{
							path: "src/app.ts",
							kind: "modify",
							diff: "-missing\n+new",
							edits: [{ oldText: "missing", newText: "new" }],
						},
					],
					status: "failed",
					result: {
						content: [
							{
								type: "text",
								text: "Could not find edits[0] in src/app.ts.",
							},
						],
					},
				},
			},
		]);
	});

	test("maps Pi remove-like tools to delete file_change items", () => {
		const state = createPiEventState();

		expect(
			normalizePiEvent(
				{
					type: "tool_execution_end",
					toolCallId: "tool-delete",
					toolName: "remove",
					args: { path: "src/old.ts" },
					result: { content: [{ type: "text", text: "Removed src/old.ts" }] },
					isError: false,
				} as unknown as AgentSessionEvent,
				state,
			),
		).toEqual([
			{
				type: "item/completed",
				item: {
					id: "tool-delete",
					type: "file_change",
					changes: [{ path: "src/old.ts", kind: "delete" }],
					status: "completed",
					result: { content: [{ type: "text", text: "Removed src/old.ts" }] },
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
