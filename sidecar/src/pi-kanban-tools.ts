/**
 * Custom Pi tool definitions for Goals board control.
 *
 * These tools are registered with the Pi agent via `customTools` in
 * `createAgentSession`. When the AI calls one, `execute()` emits a
 * `kanban_tool_call` passthrough event to the frontend, then suspends until
 * the frontend responds with `{ method: "kanbanToolResult" }` over stdin.
 * The sidecar index resolves the waiting promise via `resolvePendingKanbanCall`.
 *
 * The board is child-workspace canonical: tool names keep the historical
 * `*_kanban_card` shape, but every card id is a child workspace id. There is
 * no standalone card database contract in the sidecar.
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
	defaults?: {
		assignedProvider?: string | null;
		assignedModelId?: string | null;
		assignedEffortLevel?: string | null;
	},
) {
	const goalWorkspaceId = workspaceId;
	const listCards = defineTool({
		name: "list_kanban_cards",
		label: "List Goal Board Workspaces",
		description:
			"Return all child workspaces on the current goal board. Each returned card is a real workspace: `id` is the child workspace id, `lane` is the board lane (backlog/in-progress/review/done/canceled, or merged when Helmor detects the child workspace has landed in the goal branch), and optional fields may include branch, PR URL, PR state, landing state, session count, and description.",
		promptSnippet:
			"list_kanban_cards() → returns child workspace board state as JSON",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const result = await callKanbanTool(
				"list_kanban_cards",
				goalWorkspaceId,
				{ workspaceId: goalWorkspaceId, goalWorkspaceId },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const createCard = defineTool({
		name: "create_kanban_card",
		label: "Create Goal Board Workspace",
		description:
			"Create a new child workspace on the current goal board. The tool name says card for compatibility, but the result is a real workspace. `lane` is the desired workspace status and should be one of: backlog, in-progress, review, done, canceled. Do not use merged, Helmor derives that lane from whether the child workspace has landed in the goal branch. Helmor selects the assignee model from available Claude/Codex-backed Pi models unless the user enabled all Goal assignee Pi providers. Include `prompt` when the child workspace should immediately start an agent thread in the background.",
		promptSnippet:
			"create_kanban_card({ title, lane, description?, assigned_effort_level?, prompt? }) → new child workspace card and optional background-started thread using Helmor's selected assignee model",
		promptGuidelines: [
			"Use create_kanban_card when the user asks to add, create, or track a new goal task workspace.",
			"Default lane is 'backlog' when unspecified.",
			"Treat the returned id/workspaceId as the child workspace id for future move, update, and thread tools.",
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
			assigned_effort_level: Type.Optional(
				Type.String({
					description: "Optional effort/thinking level for the first thread",
				}),
			),
			target_branch: Type.Optional(
				Type.String({
					description:
						"Optional branch to start/target instead of the goal branch",
				}),
			),
			prompt: Type.Optional(
				Type.String({
					description:
						"Optional prompt to immediately start in the child workspace's initial thread",
				}),
			),
			permission_mode: Type.Optional(
				Type.String({
					description:
						"Optional permission mode for the prompt, e.g. plan, auto, acceptEdits, bypassPermissions",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callKanbanTool(
				"create_kanban_card",
				goalWorkspaceId,
				{
					workspaceId: goalWorkspaceId,
					goalWorkspaceId,
					title: params.title,
					lane: params.lane || "backlog",
					description: params.description,
					assignedProvider: defaults?.assignedProvider ?? null,
					assignedModelId: defaults?.assignedModelId ?? null,
					assignedEffortLevel:
						params.assigned_effort_level ??
						defaults?.assignedEffortLevel ??
						null,
					targetBranch: params.target_branch,
					prompt: params.prompt,
					permissionMode: params.permission_mode,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const moveCard = defineTool({
		name: "move_kanban_card",
		label: "Move Goal Board Workspace",
		description:
			"Move an existing goal board child workspace to a different lane/status. `card_id` is the child workspace id from list_kanban_cards. `lane` must be one of: backlog, in-progress, review, done, canceled. Do not move cards into merged, Helmor sets that lane when the child workspace has landed in the goal branch.",
		promptSnippet: "move_kanban_card({ card_id, lane }) → updated card",
		parameters: Type.Object({
			card_id: Type.String({ description: "The child workspace id" }),
			lane: Type.String({
				description:
					"Target lane: backlog | in-progress | review | done | canceled",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callKanbanTool(
				"move_kanban_card",
				goalWorkspaceId,
				{
					goalWorkspaceId,
					workspaceId: params.card_id,
					cardId: params.card_id,
					childWorkspaceId: params.card_id,
					lane: params.lane,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const updateCard = defineTool({
		name: "update_kanban_card",
		label: "Update Goal Board Workspace",
		description:
			"Update the title or description metadata for an existing goal board child workspace. `card_id` is the child workspace id from list_kanban_cards. At least one of `title` or `description` must be provided.",
		promptSnippet:
			"update_kanban_card({ card_id, title?, description? }) → updated card",
		parameters: Type.Object({
			card_id: Type.String({ description: "The child workspace id" }),
			title: Type.Optional(Type.String({ description: "New title" })),
			description: Type.Optional(
				Type.String({ description: "New description" }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callKanbanTool(
				"update_kanban_card",
				goalWorkspaceId,
				{
					goalWorkspaceId,
					workspaceId: params.card_id,
					cardId: params.card_id,
					childWorkspaceId: params.card_id,
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
