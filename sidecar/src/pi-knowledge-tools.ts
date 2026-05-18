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

export function createKnowledgeTools(
	goalWorkspaceId: string,
	emitter: SidecarEmitter,
	requestId: string,
) {
	const queryProjectKnowledge = defineTool({
		name: "query_project_knowledge",
		label: "Query Project Knowledge",
		description:
			"Search the long-lived project knowledge base for repository code, docs, and project-level context. Use this before answering questions that depend on current project conventions or prior merged work.",
		promptSnippet:
			"query_project_knowledge({ query, limit? }) → relevant project knowledge snippets",
		parameters: Type.Object({
			query: Type.String({ description: "Natural-language search query" }),
			limit: Type.Optional(Type.Number({ description: "Maximum matches" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"query_project_knowledge",
				goalWorkspaceId,
				{ goalWorkspaceId, query: params.query, limit: params.limit },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const queryGoalKnowledge = defineTool({
		name: "query_goal_knowledge",
		label: "Query Goal Knowledge",
		description:
			"Search this goal's overlay knowledge, including the goal brief, card metadata, Pi notes, and assignee reports. Use this before reporting status or coordinating no-code/research cards.",
		promptSnippet:
			"query_goal_knowledge({ query, limit? }) → relevant goal lifecycle snippets",
		parameters: Type.Object({
			query: Type.String({ description: "Natural-language search query" }),
			limit: Type.Optional(Type.Number({ description: "Maximum matches" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"query_goal_knowledge",
				goalWorkspaceId,
				{ goalWorkspaceId, query: params.query, limit: params.limit },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const recordGoalKnowledgeNote = defineTool({
		name: "record_goal_knowledge_note",
		label: "Record Goal Knowledge Note",
		description:
			"Persist a concise Pi decision, no-code result, or lifecycle note into this goal's knowledge overlay so child workspaces can retrieve it later.",
		promptSnippet:
			"record_goal_knowledge_note({ title?, text, metadata? }) → persisted note id",
		parameters: Type.Object({
			title: Type.Optional(Type.String({ description: "Short note title" })),
			text: Type.String({ description: "Knowledge note body" }),
			metadata: Type.Optional(
				Type.Record(Type.String(), Type.Unknown(), {
					description: "Optional structured metadata",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"record_goal_knowledge_note",
				goalWorkspaceId,
				{
					goalWorkspaceId,
					title: params.title,
					text: params.text,
					metadata: params.metadata,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	return [queryProjectKnowledge, queryGoalKnowledge, recordGoalKnowledgeNote];
}
