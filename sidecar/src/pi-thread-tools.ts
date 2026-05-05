/**
 * Pi custom tool definitions for thread (session) management within
 * child workspaces that are linked to Kanban cards.
 *
 * These tools use the same `kanban_tool_call` / `kanbanToolResult` round-trip
 * protocol as the Kanban tools — the Pi agent emits an event, the Helmor
 * frontend executes the corresponding Tauri IPC call, then sends the result
 * back via stdin so the pending promise resolves.
 *
 * Tool set:
 *  - list_threads   — list all sessions in a child workspace
 *  - create_thread  — create a new session in a child workspace
 *  - get_thread     — fetch messages for a specific thread
 *  - update_thread  — rename a thread
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { SidecarEmitter } from "./emitter.js";
import { callPiTool } from "./pi-kanban-tools.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function toResult(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		details: data,
	};
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function createThreadTools(
	goalWorkspaceId: string,
	emitter: SidecarEmitter,
	requestId: string,
) {
	const listThreads = defineTool({
		name: "list_threads",
		label: "List Threads",
		description:
			"List all conversation threads (sessions) in a child workspace that is linked to a Kanban card. Returns id, title, status, model, and unread count for each thread. Use the `workspace_id` from a card's childWorkspaceId field (visible in list_kanban_cards output).",
		promptSnippet:
			"list_threads({ workspace_id }) → array of session summaries",
		parameters: Type.Object({
			workspace_id: Type.String({
				description: "The child workspace UUID (card.childWorkspaceId)",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"list_threads",
				goalWorkspaceId,
				{ workspaceId: params.workspace_id },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const createThread = defineTool({
		name: "create_thread",
		label: "Create Thread",
		description:
			"Create a new conversation thread (session) in a child workspace. Optionally give it a title. Returns the new session id.",
		promptSnippet:
			"create_thread({ workspace_id, title? }) → { sessionId, workspaceId }",
		parameters: Type.Object({
			workspace_id: Type.String({
				description: "The child workspace UUID (card.childWorkspaceId)",
			}),
			title: Type.Optional(
				Type.String({ description: "Optional initial title for the thread" }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"create_thread",
				goalWorkspaceId,
				{
					workspaceId: params.workspace_id,
					title: params.title ?? null,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const getThread = defineTool({
		name: "get_thread",
		label: "Get Thread",
		description:
			"Retrieve the messages in a specific thread. Returns the full message history so you can check up on what happened in that conversation.",
		promptSnippet:
			"get_thread({ workspace_id, thread_id }) → array of messages",
		parameters: Type.Object({
			workspace_id: Type.String({
				description:
					"The child workspace UUID (for context; not used for lookup)",
			}),
			thread_id: Type.String({
				description: "The session UUID to inspect",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"get_thread",
				goalWorkspaceId,
				{
					workspaceId: params.workspace_id,
					threadId: params.thread_id,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const updateThread = defineTool({
		name: "update_thread",
		label: "Update Thread",
		description:
			"Rename an existing thread (session) in a child workspace. Useful for giving a meaningful title after reviewing what the thread is about.",
		promptSnippet:
			"update_thread({ workspace_id, thread_id, title }) → { threadId, title }",
		parameters: Type.Object({
			workspace_id: Type.String({
				description: "The child workspace UUID (card.childWorkspaceId)",
			}),
			thread_id: Type.String({
				description: "The session UUID to rename",
			}),
			title: Type.String({
				description: "New title for the thread",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"update_thread",
				goalWorkspaceId,
				{
					workspaceId: params.workspace_id,
					threadId: params.thread_id,
					title: params.title,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	return [listThreads, createThread, getThread, updateThread];
}
