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
