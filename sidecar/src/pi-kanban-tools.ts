/**
 * Custom Pi tool definitions for Kanban board control.
 *
 * These tools are registered with the Pi agent via `customTools` in
 * `createAgentSession`. When the AI calls one, `execute()` emits a
 * `kanban_tool_call` passthrough event to the frontend, then suspends until
 * the frontend responds with `{ method: "kanbanToolResult" }` over stdin.
 * The sidecar index resolves the waiting promise via `resolvePendingKanbanCall`.
 */

import { randomUUID } from "node:crypto";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { SidecarEmitter } from "./emitter.js";

// ---------------------------------------------------------------------------
// Pending-call registry — toolCallId → { resolve, reject }
// ---------------------------------------------------------------------------

interface PendingKanbanCall {
	resolve: (result: unknown) => void;
	reject: (err: Error) => void;
}

const pendingKanbanCalls = new Map<string, PendingKanbanCall>();

/** Called by the sidecar stdin handler when `kanbanToolResult` arrives. */
export function resolvePendingKanbanCall(
	toolCallId: string,
	result: unknown,
	isError: boolean,
): void {
	const pending = pendingKanbanCalls.get(toolCallId);
	if (!pending) return;
	pendingKanbanCalls.delete(toolCallId);
	if (isError) {
		pending.reject(
			new Error(typeof result === "string" ? result : JSON.stringify(result)),
		);
	} else {
		pending.resolve(result);
	}
}

// ---------------------------------------------------------------------------
// Helper — emit + await round-trip
// ---------------------------------------------------------------------------

function callKanbanTool(
	toolName: string,
	workspaceId: string,
	args: Record<string, unknown>,
	emitter: SidecarEmitter,
	requestId: string,
): Promise<unknown> {
	const toolCallId = randomUUID();
	const promise = new Promise<unknown>((resolve, reject) => {
		pendingKanbanCalls.set(toolCallId, { resolve, reject });
	});
	emitter.kanbanToolCall(requestId, toolCallId, toolName, workspaceId, args);
	return promise;
}

/**
 * Shared passthrough helper for all Pi custom tools (kanban + thread).
 * Thread tools import this to reuse the same pending-call registry and
 * the same `kanban_tool_call` / `kanbanToolResult` round-trip protocol.
 */
export function callPiTool(
	toolName: string,
	goalWorkspaceId: string,
	args: Record<string, unknown>,
	emitter: SidecarEmitter,
	requestId: string,
): Promise<unknown> {
	return callKanbanTool(toolName, goalWorkspaceId, args, emitter, requestId);
}

function toResult(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		details: data,
	};
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function createKanbanTools(
	workspaceId: string,
	emitter: SidecarEmitter,
	requestId: string,
) {
	const listCards = defineTool({
		name: "list_kanban_cards",
		label: "List Kanban Cards",
		description:
			"Return all cards on the Kanban board for the current goal workspace, including their id, title, lane (backlog/in-progress/review/done/canceled), description, and assigned provider.",
		promptSnippet: "list_kanban_cards() → returns current board state as JSON",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const result = await callKanbanTool(
				"list_kanban_cards",
				workspaceId,
				{ workspaceId },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const createCard = defineTool({
		name: "create_kanban_card",
		label: "Create Kanban Card",
		description:
			"Create a new card on the Kanban board. The `lane` must be one of: backlog, in-progress, review, done, canceled. `assigned_provider` is optional and must be one of: claude, codex, pi.",
		promptSnippet:
			"create_kanban_card({ title, lane, description?, assigned_provider? }) → new card",
		promptGuidelines: [
			"Use create_kanban_card when the user asks to add, create, or track a new task.",
			"Default lane is 'backlog' when unspecified.",
		],
		parameters: Type.Object({
			title: Type.String({ description: "Card title (required)" }),
			lane: Type.String({
				description:
					"Lane: backlog | in-progress | review | done | canceled (default: backlog)",
			}),
			description: Type.Optional(
				Type.String({ description: "Optional card description / details" }),
			),
			assigned_provider: Type.Optional(
				Type.String({
					description: "Optional agent provider: claude | codex | pi",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callKanbanTool(
				"create_kanban_card",
				workspaceId,
				{
					workspaceId,
					title: params.title,
					lane: params.lane || "backlog",
					description: params.description,
					assignedProvider: params.assigned_provider,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const moveCard = defineTool({
		name: "move_kanban_card",
		label: "Move Kanban Card",
		description:
			"Move an existing Kanban card to a different lane. `card_id` is the card's unique id (from list_kanban_cards). `lane` must be one of: backlog, in-progress, review, done, canceled.",
		promptSnippet: "move_kanban_card({ card_id, lane }) → updated card",
		parameters: Type.Object({
			card_id: Type.String({ description: "The card's unique id" }),
			lane: Type.String({
				description:
					"Target lane: backlog | in-progress | review | done | canceled",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callKanbanTool(
				"move_kanban_card",
				workspaceId,
				{ workspaceId, cardId: params.card_id, lane: params.lane },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const updateCard = defineTool({
		name: "update_kanban_card",
		label: "Update Kanban Card",
		description:
			"Update the title or description of an existing Kanban card. At least one of `title` or `description` must be provided.",
		promptSnippet:
			"update_kanban_card({ card_id, title?, description? }) → updated card",
		parameters: Type.Object({
			card_id: Type.String({ description: "The card's unique id" }),
			title: Type.Optional(Type.String({ description: "New title" })),
			description: Type.Optional(
				Type.String({ description: "New description" }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callKanbanTool(
				"update_kanban_card",
				workspaceId,
				{
					workspaceId,
					cardId: params.card_id,
					title: params.title,
					description: params.description,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	return [listCards, createCard, moveCard, updateCard];
}
