import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export interface PiNormalizedEvent {
	readonly type: string;
	readonly [key: string]: unknown;
}

interface PiEventState {
	messageItemId: string | null;
	reasoningItemId: string | null;
	turnId: string | null;
	turnIndex: number;
}

export function createPiEventState(): PiEventState {
	return {
		messageItemId: null,
		reasoningItemId: null,
		turnId: null,
		turnIndex: 0,
	};
}

export function normalizePiEvent(
	event: AgentSessionEvent,
	state: PiEventState,
): PiNormalizedEvent[] {
	switch (event.type) {
		case "turn_start": {
			const rawEvent = event as AgentSessionEvent & { turnIndex?: number };
			const turnIndex = rawEvent.turnIndex ?? state.turnIndex;
			const turnId = `pi-turn-${turnIndex}`;
			state.turnId = turnId;
			state.turnIndex = turnIndex;
			return [{ type: "turn/started", turn: { id: turnId } }];
		}
		case "message_start": {
			const message = asRecord(event.message);
			if (message?.role !== "assistant") return [];
			const id = piMessageId(message, state);
			state.messageItemId = id;
			return [
				{
					type: "item/started",
					item: {
						id,
						type: "agent_message",
						text: assistantText(message),
					},
				},
			];
		}
		case "message_update":
			return normalizeAssistantMessageUpdate(event, state);
		case "message_end": {
			const message = asRecord(event.message);
			if (message?.role !== "assistant") return [];
			const id = state.messageItemId ?? piMessageId(message, state);
			state.messageItemId = null;
			return [
				{
					type: "item/completed",
					item: {
						id,
						type: "agent_message",
						text: assistantText(message),
					},
				},
			];
		}
		case "tool_execution_start":
			return [
				{
					type: "item/started",
					item: toolItem(
						event.toolCallId,
						event.toolName,
						event.args,
						undefined,
						false,
					),
				},
			];
		case "tool_execution_update":
			return [
				{
					type: "item/commandExecution/outputDelta",
					itemId: event.toolCallId,
					output: toolResultText(event.partialResult),
				},
			];
		case "tool_execution_end":
			return [
				{
					type: "item/completed",
					item: toolItem(
						event.toolCallId,
						event.toolName,
						undefined,
						event.result,
						event.isError,
					),
				},
			];
		case "turn_end": {
			const turnId = state.turnId ?? `pi-turn-${state.turnIndex}`;
			const usage = asRecord(asRecord(event.message)?.usage);
			return [
				{
					type: "turn/completed",
					turn: { id: turnId, status: "completed" },
					usage: normalizeUsage(usage),
				},
			];
		}
		default:
			return [];
	}
}

function normalizeAssistantMessageUpdate(
	event: Extract<AgentSessionEvent, { type: "message_update" }>,
	state: PiEventState,
): PiNormalizedEvent[] {
	const assistantEvent = asRecord(event.assistantMessageEvent);
	const eventType = assistantEvent?.type;
	if (eventType === "text_delta") {
		const text =
			typeof assistantEvent?.delta === "string" ? assistantEvent.delta : "";
		if (!text) return [];
		return [
			{
				type: "item/agentMessage/delta",
				itemId:
					state.messageItemId ?? piMessageId(asRecord(event.message), state),
				text,
			},
		];
	}
	if (eventType === "thinking_start") {
		const id = `pi-reasoning-${state.turnIndex}`;
		state.reasoningItemId = id;
		return [
			{ type: "item/started", item: { id, type: "reasoning", text: "" } },
		];
	}
	if (eventType === "thinking_delta") {
		const text =
			typeof assistantEvent?.delta === "string" ? assistantEvent.delta : "";
		if (!text) return [];
		return [
			{
				type: "item/reasoning/textDelta",
				itemId: state.reasoningItemId ?? `pi-reasoning-${state.turnIndex}`,
				text,
			},
		];
	}
	if (eventType === "thinking_end") {
		const id = state.reasoningItemId ?? `pi-reasoning-${state.turnIndex}`;
		state.reasoningItemId = null;
		return [
			{
				type: "item/completed",
				item: {
					id,
					type: "reasoning",
					text:
						typeof assistantEvent?.content === "string"
							? assistantEvent.content
							: "",
				},
			},
		];
	}
	return [];
}

function toolItem(
	id: string,
	toolName: string,
	args: unknown,
	result: unknown,
	isError: boolean,
): Record<string, unknown> {
	const normalized = normalizeToolName(toolName);
	if (normalized === "command_execution") {
		const input = asRecord(args);
		return withoutUndefined({
			id,
			type: "command_execution",
			command:
				stringField(input, ["command", "cmd"]) ?? JSON.stringify(args ?? {}),
			aggregated_output: toolResultText(result),
			exit_code: result === undefined ? undefined : isError ? 1 : 0,
		});
	}
	if (normalized === "file_change") {
		return withoutUndefined({
			id,
			type: "file_change",
			changes: [],
			status:
				result === undefined ? undefined : isError ? "failed" : "completed",
			result,
		});
	}
	return {
		id,
		type: "mcp_tool_call",
		server: "pi",
		tool: toolName,
		arguments: args ?? {},
		status:
			result === undefined ? "in_progress" : isError ? "failed" : "completed",
		result,
		...(isError
			? { error: { message: toolResultText(result) || "Tool failed" } }
			: {}),
	};
}

function withoutUndefined(
	obj: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(obj).filter(([, value]) => value !== undefined),
	);
}

function normalizeToolName(
	toolName: string,
): "command_execution" | "file_change" | "mcp_tool_call" {
	if (toolName === "bash") return "command_execution";
	if (toolName === "edit" || toolName === "write") return "file_change";
	return "mcp_tool_call";
}

function assistantText(message: Record<string, unknown> | undefined): string {
	const content = message?.content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) => asRecord(item))
		.filter((item) => item?.type === "text" && typeof item.text === "string")
		.map((item) => item?.text as string)
		.join("");
}

function piMessageId(
	message: Record<string, unknown> | undefined,
	state: PiEventState,
): string {
	const responseId =
		typeof message?.responseId === "string" ? message.responseId : "";
	return responseId || `pi-message-${state.turnIndex}`;
}

function normalizeUsage(
	usage: Record<string, unknown> | undefined,
): Record<string, unknown> {
	return {
		input_tokens: numberField(usage, "input"),
		output_tokens: numberField(usage, "output"),
	};
}

function toolResultText(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	const record = asRecord(value);
	if (record) {
		const content = record.content;
		if (Array.isArray(content)) {
			return content
				.map((item) => asRecord(item))
				.filter(
					(item) => item?.type === "text" && typeof item.text === "string",
				)
				.map((item) => item?.text as string)
				.join("\n");
		}
		const text = stringField(record, ["text", "output", "stdout", "stderr"]);
		if (text) return text;
	}
	return JSON.stringify(value);
}

function stringField(
	obj: Record<string, unknown> | undefined,
	keys: readonly string[],
): string | undefined {
	for (const key of keys) {
		const value = obj?.[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return undefined;
}

function numberField(
	obj: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const value = obj?.[key];
	return typeof value === "number" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
