import { randomUUID } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { GoalSupervisorToolBridge } from "./types.js";

type ToolParams = Record<string, unknown>;

type ToolSpec = {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: ReturnType<typeof Type.Object>;
	readonly mapArgs?: (params: ToolParams) => ToolParams;
};

const optionalString = (description: string) =>
	Type.Optional(Type.String({ description }));

const cardId = optionalString("Child workspace id / card id");

export function createGoalSupervisorTools(
	goalWorkspaceId: string,
	bridge: GoalSupervisorToolBridge,
	defaults?: {
		readonly assignedProvider?: string | null;
		readonly assignedEffortLevel?: string | null;
	},
) {
	return toolSpecs(defaults).map((spec) =>
		defineTool({
			name: spec.name,
			label: spec.label,
			description: spec.description,
			parameters: spec.parameters,
			async execute(_toolCallId, params) {
				const toolCallId = randomUUID();
				const args = {
					workspaceId: goalWorkspaceId,
					goalWorkspaceId,
					...(spec.mapArgs?.(params as ToolParams) ?? (params as ToolParams)),
				};
				const result = await bridge.callTool({
					toolCallId,
					tool: spec.name,
					workspaceId: goalWorkspaceId,
					args,
				});
				return {
					content: [
						{ type: "text" as const, text: JSON.stringify(result, null, 2) },
					],
					details: result,
				};
			},
		}),
	);
}

function toolSpecs(defaults?: {
	readonly assignedProvider?: string | null;
	readonly assignedEffortLevel?: string | null;
}): readonly ToolSpec[] {
	return [
		{
			name: "list_assignee_models",
			label: "List Assignee Models",
			description:
				"List the latest currently available Goal assignee models before starting child workspace assignees.",
			parameters: Type.Object({}),
		},
		{
			name: "list_kanban_cards",
			label: "List Goal Board Workspaces",
			description: "Return all child workspaces on the current goal board.",
			parameters: Type.Object({}),
		},
		{
			name: "create_kanban_card",
			label: "Create Goal Board Workspace",
			description:
				"Create a child workspace on the current goal board and optionally start an assignee thread.",
			parameters: Type.Object({
				title: Type.String({ description: "Card title" }),
				lane: Type.Optional(Type.String({ description: "Target lane" })),
				description: optionalString("Optional card details"),
				assigned_model_id: optionalString("Selected assignee model id"),
				assigned_effort_level: optionalString("Assignee effort level"),
				target_branch: optionalString("Optional target branch"),
				prompt: optionalString("Optional prompt to start an assignee"),
				permission_mode: optionalString("Optional permission mode"),
			}),
			mapArgs: (params) => ({
				title: params.title,
				lane: params.lane ?? "backlog",
				description: params.description,
				assignedProvider: defaults?.assignedProvider ?? "pi",
				assignedModelId: params.assigned_model_id ?? null,
				assignedEffortLevel:
					params.assigned_effort_level ?? defaults?.assignedEffortLevel ?? null,
				targetBranch: params.target_branch,
				prompt: params.prompt,
				permissionMode: params.permission_mode,
				finalize: true,
			}),
		},
		{
			name: "move_kanban_card",
			label: "Move Goal Board Workspace",
			description: "Move an existing goal board child workspace to a lane.",
			parameters: Type.Object({
				card_id: Type.String({ description: "Child workspace id" }),
				lane: Type.String({ description: "Target lane" }),
			}),
			mapArgs: (params) => ({ cardId: params.card_id, lane: params.lane }),
		},
		{
			name: "update_kanban_card",
			label: "Update Goal Board Workspace",
			description: "Update metadata for a goal board child workspace.",
			parameters: Type.Object({
				card_id: Type.String({ description: "Child workspace id" }),
				title: optionalString("New title"),
			}),
			mapArgs: (params) => ({ cardId: params.card_id, title: params.title }),
		},
		{
			name: "list_threads",
			label: "List Threads",
			description: "List sessions for a child workspace.",
			parameters: Type.Object({
				workspace_id: Type.String({ description: "Workspace id" }),
			}),
			mapArgs: (params) => ({ workspaceId: params.workspace_id }),
		},
		{
			name: "create_thread",
			label: "Create Thread",
			description: "Create a new thread in a child workspace.",
			parameters: Type.Object({
				workspace_id: Type.String({ description: "Workspace id" }),
				title: optionalString("Thread title"),
				model_id: optionalString("Model id"),
				permission_mode: optionalString("Permission mode"),
			}),
			mapArgs: (params) => ({
				workspaceId: params.workspace_id,
				title: params.title,
				modelId: params.model_id,
				permissionMode: params.permission_mode,
			}),
		},
		threadTool("get_thread", "Get Thread", "Read a specific thread."),
		threadTool("update_thread", "Update Thread", "Rename a specific thread."),
		threadTool("delete_thread", "Delete Thread", "Delete a specific thread."),
		{
			name: "send_thread_message",
			label: "Message Thread",
			description: "Queue a supervisor update into a specific thread.",
			parameters: Type.Object({
				workspace_id: Type.String({ description: "Workspace id" }),
				thread_id: Type.String({ description: "Thread/session id" }),
				message: Type.String({ description: "Message to queue" }),
				priority: optionalString("Priority"),
				model_id: optionalString("Model id"),
				permission_mode: optionalString("Permission mode"),
			}),
			mapArgs: (params) => ({
				workspaceId: params.workspace_id,
				threadId: params.thread_id,
				message: params.message,
				priority: params.priority,
				modelId: params.model_id,
				permissionMode: params.permission_mode,
			}),
		},
		{
			name: "send_assignee_message",
			label: "Message Assignee",
			description:
				"Queue a supervisor update into a Goal card assignee thread.",
			parameters: Type.Object({
				card_id: Type.String({ description: "Child workspace id" }),
				message: Type.String({ description: "Message to queue" }),
				priority: optionalString("Priority"),
				thread_id: optionalString("Thread/session id override"),
			}),
			mapArgs: (params) => ({
				cardId: params.card_id,
				message: params.message,
				priority: params.priority,
				threadId: params.thread_id,
			}),
		},
		{
			name: "set_card_assignee_thread",
			label: "Set Card Assignee Thread",
			description: "Set the active assignee thread for a Goal card.",
			parameters: Type.Object({
				card_id: Type.String({ description: "Child workspace id" }),
				thread_id: Type.String({ description: "Thread/session id" }),
				reason: optionalString("Reason"),
				supersedes_thread_id: optionalString("Superseded thread id"),
			}),
			mapArgs: (params) => ({
				cardId: params.card_id,
				threadId: params.thread_id,
				reason: params.reason,
				supersedesThreadId: params.supersedes_thread_id,
			}),
		},
		{
			name: "read_assignee_thread",
			label: "Read Assignee Thread",
			description: "Read the assigned thread for a Goal card.",
			parameters: Type.Object({
				card_id: Type.String({ description: "Child workspace id" }),
				thread_id: optionalString("Thread/session id override"),
				since_message_id: optionalString("Only return messages after this id"),
			}),
			mapArgs: (params) => ({
				cardId: params.card_id,
				threadId: params.thread_id,
				sinceMessageId: params.since_message_id,
			}),
		},
		{
			name: "summarize_assignee_status",
			label: "Summarize Assignee",
			description: "Summarize latest milestone state for a Goal card.",
			parameters: Type.Object({
				card_id: Type.String({ description: "Child workspace id" }),
			}),
			mapArgs: (params) => ({ cardId: params.card_id }),
		},
		{
			name: "list_assignees",
			label: "List Assignees",
			description: "List Goal card assignees and runtime status.",
			parameters: Type.Object({
				status: optionalString("Optional status filter"),
			}),
		},
		knowledgeTool("query_goal_knowledge", "Query Goal Knowledge"),
		knowledgeTool("query_project_knowledge", "Query Project Knowledge"),
		knowledgeTool("search_knowledge", "Search Knowledge"),
		{
			name: "record_goal_knowledge_note",
			label: "Record Goal Note",
			description: "Persist a supervisor note into the goal knowledge overlay.",
			parameters: Type.Object({
				title: optionalString("Note title"),
				text: Type.String({ description: "Note text" }),
			}),
		},
		{
			name: "reindex_knowledge",
			label: "Reindex Knowledge",
			description: "Reindex goal or project knowledge.",
			parameters: Type.Object({ scope: optionalString("goal or project") }),
		},
		{
			name: "get_knowledge_status",
			label: "Knowledge Status",
			description: "Return knowledge index status.",
			parameters: Type.Object({}),
		},
		workspaceTool("list_project_workspaces", "List Project Workspaces"),
		workspaceTool("inspect_workspace_merge_state", "Inspect Merge State"),
		workspaceTool("refresh_change_request", "Refresh Change Request"),
		workspaceTool("sync_workspace_target_branch", "Sync Target Branch"),
		workspaceTool("push_workspace_branch", "Push Workspace Branch"),
		workspaceTool("merge_change_request", "Merge Change Request"),
		workspaceTool("check_workspace_landed", "Check Workspace Landed"),
		workspaceTool("mark_workspace_landed", "Mark Workspace Landed"),
	];
}

function threadTool(
	name: string,
	label: string,
	description: string,
): ToolSpec {
	return {
		name,
		label,
		description,
		parameters: Type.Object({
			workspace_id: Type.String({ description: "Workspace id" }),
			thread_id: Type.String({ description: "Thread/session id" }),
			title: optionalString("Thread title"),
			since_message_id: optionalString("Only return messages after this id"),
		}),
		mapArgs: (params) => ({
			workspaceId: params.workspace_id,
			threadId: params.thread_id,
			title: params.title,
			sinceMessageId: params.since_message_id,
		}),
	};
}

function knowledgeTool(name: string, label: string): ToolSpec {
	return {
		name,
		label,
		description: `${label} for the current goal.`,
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			limit: Type.Optional(Type.Number({ description: "Result limit" })),
			scope: optionalString("goal, project, or all"),
		}),
	};
}

function workspaceTool(name: string, label: string): ToolSpec {
	return {
		name,
		label,
		description: `${label} for a Goal child workspace.`,
		parameters: Type.Object({
			card_id: cardId,
			workspace_id: optionalString("Workspace id"),
		}),
		mapArgs: (params) => ({
			cardId: params.card_id ?? params.workspace_id,
			workspaceId: params.workspace_id ?? params.card_id,
		}),
	};
}
