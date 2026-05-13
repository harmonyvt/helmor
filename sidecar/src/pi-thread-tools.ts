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
 *  - delete_thread  — delete a thread
 *  - send_thread_message — send a supervisor prompt to a specific thread
 *  - get_thread_runtime_status — inspect active runtime telemetry
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
			"List all conversation threads (sessions) in a goal board child workspace. Returns id, title, status, model, and unread count for each thread. Use a card `id` from list_kanban_cards as `workspace_id`.",
		promptSnippet:
			"list_threads({ workspace_id }) → array of session summaries",
		parameters: Type.Object({
			workspace_id: Type.String({
				description: "The child workspace UUID (card.id)",
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
				description: "The child workspace UUID (card.id)",
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

	const getThreadRuntimeStatus = defineTool({
		name: "get_thread_runtime_status",
		label: "Get Thread Runtime Status",
		description:
			"Inspect runtime telemetry for a specific thread, especially when a thread is marked streaming but has no visible assistant output.",
		promptSnippet:
			"get_thread_runtime_status({ workspace_id, thread_id }) → runtime telemetry including model, process state, last event, and stall seconds",
		parameters: Type.Object({
			workspace_id: Type.String({
				description: "The child workspace UUID (card.id)",
			}),
			thread_id: Type.String({
				description: "The session UUID to inspect",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"get_thread_runtime_status",
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
				description: "The child workspace UUID (card.id)",
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

	const sendThreadMessage = defineTool({
		name: "send_thread_message",
		label: "Send Thread Message",
		description:
			"Queue an async supervisor update into a specific thread in a Goal card child workspace. Use this for stale-thread recovery or when a card has multiple sessions and you must target an exact conversation.",
		promptSnippet:
			"send_thread_message({ workspace_id, thread_id, message, priority?, model_id?, permission_mode? }) → { queued, started, sessionId, workspaceId }",
		promptGuidelines: [
			"Prefer this over send_assignee_message when recovering from a stale or failed assignee thread.",
			"Use list_threads first if you are unsure which thread should receive the update.",
		],
		parameters: Type.Object({
			workspace_id: Type.String({
				description: "The child workspace UUID (card.id)",
			}),
			thread_id: Type.String({ description: "The session UUID to message" }),
			message: Type.String({ description: "Supervisor update to queue" }),
			priority: Type.Optional(
				Type.String({
					description: "Optional priority label such as normal, high, urgent",
				}),
			),
			model_id: Type.Optional(
				Type.String({ description: "Optional model override for this send" }),
			),
			permission_mode: Type.Optional(
				Type.String({ description: "Optional permission mode override" }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"send_thread_message",
				goalWorkspaceId,
				{
					workspaceId: params.workspace_id,
					threadId: params.thread_id,
					message: params.message,
					priority: params.priority ?? null,
					modelId: params.model_id ?? null,
					permissionMode: params.permission_mode ?? null,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const deleteThread = defineTool({
		name: "delete_thread",
		label: "Delete Thread",
		description:
			"Delete a specific conversation thread from a Goal card child workspace. Use sparingly; prefer set_card_assignee_thread to supersede stale threads when history should be preserved.",
		promptSnippet:
			"delete_thread({ workspace_id, thread_id }) → { threadId, workspaceId, deleted }",
		promptGuidelines: [
			"Do not delete the active assignee thread unless you have already selected a replacement thread.",
			"Use this only for scratch/accidental threads or explicit cleanup requests.",
		],
		parameters: Type.Object({
			workspace_id: Type.String({
				description: "The child workspace UUID (card.id)",
			}),
			thread_id: Type.String({ description: "The session UUID to delete" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"delete_thread",
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

	return [
		listThreads,
		createThread,
		getThread,
		getThreadRuntimeStatus,
		updateThread,
		deleteThread,
		sendThreadMessage,
	];
}
