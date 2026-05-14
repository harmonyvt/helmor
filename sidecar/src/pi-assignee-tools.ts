/**
 * Pi custom tools for communicating with Goal card assignees.
 *
 * Assignees are represented by the dedicated session in each child workspace.
 * These tools intentionally reuse the Kanban tool round-trip so the frontend
 * can execute Tauri IPC and return the result to Pi.
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { SidecarEmitter } from "./emitter.js";
import { callPiTool } from "./pi-kanban-tools.js";

function toResult(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		details: data,
	};
}

export function createAssigneeTools(
	goalWorkspaceId: string,
	emitter: SidecarEmitter,
	requestId: string,
) {
	const sendAssigneeMessage = defineTool({
		name: "send_assignee_message",
		label: "Message Assignee",
		description:
			"Queue an async supervisor update into a Goal card assignee's dedicated thread. `card_id` is the child workspace id from list_kanban_cards. Messages are queued by default: running assignees receive the update after the current turn; idle assignees can start on it immediately. This never moves the card lane.",
		promptSnippet:
			"send_assignee_message({ card_id, message, priority?, thread_id? }) → { queued, started, sessionId, workspaceId }",
		promptGuidelines: [
			"Use this tool to give assignees extra context, answers, or priority changes.",
			"If a card has multiple threads, pass thread_id or use send_thread_message so the update goes to the intended conversation.",
			"Do not treat moving a card lane as execution; explicitly message the assignee instead.",
			"Queue follow-up context instead of interrupting running work.",
		],
		parameters: Type.Object({
			card_id: Type.String({ description: "Child workspace id / card id" }),
			message: Type.String({ description: "Supervisor update to queue" }),
			priority: Type.Optional(
				Type.String({
					description: "Optional priority label such as normal, high, urgent",
				}),
			),
			thread_id: Type.Optional(
				Type.String({
					description:
						"Optional explicit thread/session id override within the card workspace",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"send_assignee_message",
				goalWorkspaceId,
				{
					goalWorkspaceId,
					cardId: params.card_id,
					message: params.message,
					priority: params.priority,
					threadId: params.thread_id ?? null,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const readAssigneeThread = defineTool({
		name: "read_assignee_thread",
		label: "Read Assignee Thread",
		description:
			"Read the assigned thread for a Goal card. Returns only that card's dedicated assignee session, optionally after `since_message_id`, so progress remains traceable to the real thread.",
		promptSnippet:
			"read_assignee_thread({ card_id, since_message_id? }) → assigned thread messages",
		parameters: Type.Object({
			card_id: Type.String({ description: "Child workspace id / card id" }),
			thread_id: Type.Optional(
				Type.String({
					description:
						"Optional exact thread/session id to read instead of the active assignee thread",
				}),
			),
			since_message_id: Type.Optional(
				Type.String({ description: "Only return messages after this id" }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"read_assignee_thread",
				goalWorkspaceId,
				{
					goalWorkspaceId,
					cardId: params.card_id,
					threadId: params.thread_id ?? null,
					sinceMessageId: params.since_message_id,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const summarizeAssigneeStatus = defineTool({
		name: "summarize_assignee_status",
		label: "Summarize Assignee Status",
		description:
			"Summarize the latest assignee milestone state for a Goal card. Poll/read assignee threads before reporting global status to the user, and highlight blocked reports.",
		promptSnippet:
			"summarize_assignee_status({ card_id }) → compact assignee status summary",
		parameters: Type.Object({
			card_id: Type.String({ description: "Child workspace id / card id" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"summarize_assignee_status",
				goalWorkspaceId,
				{ goalWorkspaceId, cardId: params.card_id },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const setCardAssigneeThread = defineTool({
		name: "set_card_assignee_thread",
		label: "Set Card Assignee Thread",
		description:
			"Set a specific thread as the active assignee thread for a Goal card. Use this after creating or choosing a replacement thread so future implicit assignee tools route to the right session.",
		promptSnippet:
			"set_card_assignee_thread({ card_id, thread_id, reason?, supersedes_thread_id? }) → { activeThreadId, supersededThreadId }",
		promptGuidelines: [
			"Use this when the original assignee thread is stale, blocked by provider/model failure, or superseded by a clean retry.",
			"Record a concise reason so future summaries can explain the stale thread.",
		],
		parameters: Type.Object({
			card_id: Type.String({ description: "Child workspace id / card id" }),
			thread_id: Type.String({
				description: "Thread/session id to make active",
			}),
			reason: Type.Optional(
				Type.String({ description: "Why this thread is now active" }),
			),
			supersedes_thread_id: Type.Optional(
				Type.String({ description: "Old thread/session id being superseded" }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"set_card_assignee_thread",
				goalWorkspaceId,
				{
					goalWorkspaceId,
					cardId: params.card_id,
					threadId: params.thread_id,
					reason: params.reason ?? null,
					supersedesThreadId: params.supersedes_thread_id ?? null,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const listAssignees = defineTool({
		name: "list_assignees",
		label: "List Assignees",
		description:
			"List Goal card assignees and their dedicated session ids, workspace ids, runtime status, and latest report marker. Optionally filter by status.",
		promptSnippet: "list_assignees({ status? }) → assignee summaries",
		parameters: Type.Object({
			status: Type.Optional(
				Type.String({
					description:
						"Optional filter: running | idle | blocked | completed | progress | handoff",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"list_assignees",
				goalWorkspaceId,
				{ goalWorkspaceId, status: params.status },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	return [
		sendAssigneeMessage,
		readAssigneeThread,
		summarizeAssigneeStatus,
		setCardAssigneeThread,
		listAssignees,
	];
}
