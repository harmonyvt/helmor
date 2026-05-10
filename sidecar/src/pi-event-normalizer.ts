import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export interface PiNormalizedEvent {
	readonly type: string;
	readonly [key: string]: unknown;
}

interface ReasoningState {
	id: string;
	text: string;
}

interface PiEventState {
	requestId: string | null;
	messageItemId: string | null;
	reasoningByIndex: Map<number, ReasoningState>;
	turnId: string | null;
	turnIndex: number;
	toolArgsById: Map<string, unknown>;
	capturePlanReview: boolean;
	planMessageItemId: string | null;
	planText: string;
}

type PiEventStateOptions = {
	capturePlanReview?: boolean;
};

export function createPiEventState(
	requestId: string | null = null,
	options: PiEventStateOptions = {},
): PiEventState {
	return {
		requestId,
		messageItemId: null,
		reasoningByIndex: new Map(),
		turnId: null,
		turnIndex: 0,
		toolArgsById: new Map(),
		capturePlanReview: options.capturePlanReview === true,
		planMessageItemId: null,
		planText: "",
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
			const turnId = piScopedId(state, "turn", turnIndex);
			state.turnId = turnId;
			state.turnIndex = turnIndex;
			state.reasoningByIndex.clear();
			return [{ type: "turn/started", turn: { id: turnId } }];
		}
		case "message_start": {
			const message = asRecord(event.message);
			if (message?.role !== "assistant") return [];
			const id = piMessageId(message, state);
			if (state.capturePlanReview) {
				state.planMessageItemId = id;
				state.planText = assistantText(message);
				state.messageItemId = null;
				return [];
			}
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
			const errorMessage = assistantErrorMessage(message);
			if (errorMessage) {
				if (state.capturePlanReview) {
					clearPlanCaptureState(state);
				}
				return [{ type: "error", message: errorMessage }];
			}
			if (state.capturePlanReview) {
				const id = state.planMessageItemId ?? piMessageId(message, state);
				const finalText = assistantText(message).trim();
				const plan = (finalText || state.planText).trim();
				clearPlanCaptureState(state);
				if (!plan) return [];
				return [
					{
						type: "planCaptured",
						toolUseId: `pi-plan-${id}`,
						plan,
					},
				];
			}
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
		case "tool_execution_start": {
			state.toolArgsById.set(event.toolCallId, event.args);
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
		}
		case "tool_execution_update": {
			const rawEvent = event as AgentSessionEvent & { args?: unknown };
			if (rawEvent.args !== undefined) {
				state.toolArgsById.set(event.toolCallId, rawEvent.args);
			}
			return [
				{
					type: "item/commandExecution/outputDelta",
					itemId: event.toolCallId,
					output: toolResultText(event.partialResult),
				},
			];
		}
		case "tool_execution_end": {
			const rawEvent = event as AgentSessionEvent & { args?: unknown };
			const args = rawEvent.args ?? state.toolArgsById.get(event.toolCallId);
			state.toolArgsById.delete(event.toolCallId);
			return [
				{
					type: "item/completed",
					item: toolItem(
						event.toolCallId,
						event.toolName,
						args,
						event.result,
						event.isError,
					),
				},
			];
		}
		case "turn_end": {
			const turnId = state.turnId ?? piScopedId(state, "turn", state.turnIndex);
			const usage = asRecord(asRecord(event.message)?.usage);
			state.turnId = null;
			state.reasoningByIndex.clear();
			state.turnIndex += 1;
			return [
				{
					type: "turn/completed",
					turn: { id: turnId, status: "completed" },
					usage: normalizeUsage(usage),
				},
			];
		}
		case "agent_start":
		case "agent_end":
		case "queue_update":
		case "compaction_start":
		case "compaction_end":
		case "session_info_changed":
		case "thinking_level_changed":
		case "auto_retry_start":
		case "auto_retry_end":
			return [];
		default:
			return [unknownPiEventCard(event, state)];
	}
}

function clearPlanCaptureState(state: PiEventState): void {
	state.planMessageItemId = null;
	state.planText = "";
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
		if (state.capturePlanReview) {
			state.planText += text;
			return [];
		}
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
		const contentIndex = assistantContentIndex(assistantEvent);
		const id = piReasoningId(state, contentIndex);
		state.reasoningByIndex.set(contentIndex, { id, text: "" });
		return [
			{ type: "item/started", item: { id, type: "reasoning", text: "" } },
		];
	}
	if (eventType === "thinking_delta") {
		const text =
			typeof assistantEvent?.delta === "string" ? assistantEvent.delta : "";
		if (!text) return [];
		const contentIndex = assistantContentIndex(assistantEvent);
		const reasoning = ensureReasoningState(state, contentIndex);
		reasoning.text += text;
		return [
			{
				type: "item/reasoning/textDelta",
				itemId: reasoning.id,
				text,
			},
		];
	}
	if (eventType === "thinking_end") {
		const contentIndex = assistantContentIndex(assistantEvent);
		const reasoning = ensureReasoningState(state, contentIndex);
		const text =
			typeof assistantEvent?.content === "string"
				? assistantEvent.content
				: reasoning.text;
		state.reasoningByIndex.delete(contentIndex);
		return [
			{
				type: "item/completed",
				item: {
					id: reasoning.id,
					type: "reasoning",
					text,
				},
			},
		];
	}
	if (
		eventType === "start" ||
		eventType === "text_start" ||
		eventType === "text_end" ||
		eventType === "toolcall_start" ||
		eventType === "toolcall_delta" ||
		eventType === "toolcall_end" ||
		eventType === "done" ||
		eventType === "error"
	) {
		return [];
	}
	return [unknownPiAssistantEventCard(assistantEvent, state)];
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
			changes: normalizeFileChanges(toolName, args, result),
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
	if (isFileChangeTool(toolName)) return "file_change";
	return "mcp_tool_call";
}

function isFileChangeTool(toolName: string): boolean {
	return ["edit", "write", "delete", "remove", "rm", "unlink"].includes(
		toolName,
	);
}

function normalizeFileChanges(
	toolName: string,
	args: unknown,
	result: unknown,
): Array<Record<string, unknown>> {
	const input = asRecord(args);
	const path = stringField(input, ["path", "file_path"]);
	if (!path) return [];

	const resultDiff = resultDetailsDiff(result);
	if (toolName === "edit") {
		const edits = normalizeEditReplacements(input);
		return [
			withoutUndefined({
				path,
				kind: "modify",
				diff: resultDiff ?? editPreviewDiff(edits),
				edits,
			}),
		];
	}

	if (toolName === "write") {
		const content = typeof input?.content === "string" ? input.content : "";
		return [
			withoutUndefined({
				path,
				kind: "create",
				diff: resultDiff ?? writePreviewDiff(content),
				contentLength: content.length,
			}),
		];
	}

	return [
		withoutUndefined({
			path,
			kind: "delete",
			diff: resultDiff,
		}),
	];
}

function normalizeEditReplacements(
	input: Record<string, unknown> | undefined,
): Array<{ oldText: string; newText: string }> {
	const rawEdits = input?.edits;
	let parsedEdits = rawEdits;
	if (typeof rawEdits === "string") {
		try {
			parsedEdits = JSON.parse(rawEdits);
		} catch {
			parsedEdits = rawEdits;
		}
	}

	const edits = Array.isArray(parsedEdits)
		? parsedEdits
				.map((edit) => asRecord(edit))
				.filter((edit) => edit !== undefined)
				.filter(
					(edit) =>
						typeof edit.oldText === "string" &&
						typeof edit.newText === "string",
				)
				.map((edit) => ({
					oldText: edit.oldText as string,
					newText: edit.newText as string,
				}))
		: [];

	if (
		typeof input?.oldText === "string" &&
		typeof input?.newText === "string"
	) {
		edits.push({ oldText: input.oldText, newText: input.newText });
	}

	return edits;
}

function resultDetailsDiff(result: unknown): string | undefined {
	const details = asRecord(asRecord(result)?.details);
	const diff = details?.diff;
	return typeof diff === "string" && diff.trim() ? diff : undefined;
}

function editPreviewDiff(
	edits: ReadonlyArray<{ oldText: string; newText: string }>,
): string | undefined {
	const lines: string[] = [];
	for (const edit of edits) {
		lines.push(...prefixedLines("-", edit.oldText));
		lines.push(...prefixedLines("+", edit.newText));
	}
	return lines.length > 0 ? lines.join("\n") : undefined;
}

function writePreviewDiff(content: string): string | undefined {
	return prefixedLines("+", content).join("\n");
}

function prefixedLines(prefix: "+" | "-", text: string): string[] {
	if (!text) return [];
	return text.split("\n").map((line) => `${prefix}${line}`);
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

function assistantErrorMessage(
	message: Record<string, unknown> | undefined,
): string | undefined {
	const errorMessage = stringField(message, ["errorMessage"]);
	if (!errorMessage) return undefined;
	const stopReason = stringField(message, ["stopReason"]);
	return stopReason
		? `Pi ${stopReason}: ${errorMessage}`
		: `Pi error: ${errorMessage}`;
}

function piMessageId(
	message: Record<string, unknown> | undefined,
	state: PiEventState,
): string {
	const responseId =
		typeof message?.responseId === "string" ? message.responseId : "";
	return responseId || piScopedId(state, "message", state.turnIndex);
}

function piScopedId(
	state: PiEventState,
	kind: "message" | "reasoning" | "turn",
	turnIndex: number,
): string {
	return state.requestId
		? `pi-${kind}-${state.requestId}-${turnIndex}`
		: `pi-${kind}-${turnIndex}`;
}

function piReasoningId(state: PiEventState, contentIndex: number): string {
	const base = piScopedId(state, "reasoning", state.turnIndex);
	return contentIndex === 0 ? base : `${base}-${contentIndex}`;
}

function ensureReasoningState(
	state: PiEventState,
	contentIndex: number,
): ReasoningState {
	const existing = state.reasoningByIndex.get(contentIndex);
	if (existing) return existing;
	const created = { id: piReasoningId(state, contentIndex), text: "" };
	state.reasoningByIndex.set(contentIndex, created);
	return created;
}

function assistantContentIndex(
	assistantEvent: Record<string, unknown> | undefined,
): number {
	const value = assistantEvent?.contentIndex;
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: 0;
}

function unknownPiEventCard(
	event: AgentSessionEvent,
	state: PiEventState,
): PiNormalizedEvent {
	return unknownPiCard(
		`pi-unknown-${state.requestId ?? "event"}-${state.turnIndex}-${stableEventType(event.type)}`,
		"Pi SDK event not rendered",
		`Unhandled Pi event: ${event.type}`,
		event,
	);
}

function unknownPiAssistantEventCard(
	assistantEvent: Record<string, unknown> | undefined,
	state: PiEventState,
): PiNormalizedEvent {
	const type =
		typeof assistantEvent?.type === "string" ? assistantEvent.type : "unknown";
	return unknownPiCard(
		`pi-unknown-assistant-${state.requestId ?? "event"}-${state.turnIndex}-${stableEventType(type)}`,
		"Pi assistant event not rendered",
		`Unhandled Pi assistant event: ${type}`,
		assistantEvent ?? { type: "unknown" },
	);
}

function unknownPiCard(
	id: string,
	title: string,
	body: string,
	details: unknown,
): PiNormalizedEvent {
	return {
		type: "item/completed",
		item: {
			id,
			type: "generic_card",
			provider: "pi",
			severity: "warning",
			title,
			body,
			details,
		},
	};
}

function stableEventType(type: string): string {
	return type.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "unknown";
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
