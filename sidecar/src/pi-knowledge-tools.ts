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
	const searchKnowledge = defineTool({
		name: "search_knowledge",
		label: "Search Knowledge",
		description:
			"Search Helmor knowledge with an explicit scope. Use scope='all' for the current project plus this goal overlay, scope='project' for repository/project knowledge only, and scope='goal' for the current goal's lifecycle knowledge only.",
		promptSnippet:
			"search_knowledge({ query, scope?, limit? }) → scoped project/goal knowledge snippets",
		parameters: Type.Object({
			query: Type.String({ description: "Natural-language search query" }),
			scope: Type.Optional(
				Type.String({
					description: "Search scope: all | project | goal. Defaults to all.",
				}),
			),
			limit: Type.Optional(Type.Number({ description: "Maximum matches" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"search_knowledge",
				goalWorkspaceId,
				{
					goalWorkspaceId,
					query: params.query,
					scope: params.scope ?? "all",
					limit: params.limit,
				},
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const getKnowledgeStatus = defineTool({
		name: "get_knowledge_status",
		label: "Get Knowledge Status",
		description:
			"Inspect whether Helmor's knowledge sidecar is available and how many knowledge documents are indexed. Use before reindexing or when search returns no useful results.",
		promptSnippet: "get_knowledge_status() → sidecar/index status",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"get_knowledge_status",
				goalWorkspaceId,
				{ goalWorkspaceId },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const reindexKnowledge = defineTool({
		name: "reindex_knowledge",
		label: "Reindex Knowledge",
		description:
			"Refresh Helmor knowledge for the current project, current goal, or both. Use when indexed knowledge is missing, stale, or after major workspace changes; this may take a little time on large repositories.",
		promptSnippet:
			"reindex_knowledge({ scope? }) → indexed project/goal document counts",
		parameters: Type.Object({
			scope: Type.Optional(
				Type.String({
					description: "Index scope: all | project | goal. Defaults to all.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"reindex_knowledge",
				goalWorkspaceId,
				{ goalWorkspaceId, scope: params.scope ?? "all" },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

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

	return [
		searchKnowledge,
		getKnowledgeStatus,
		reindexKnowledge,
		queryProjectKnowledge,
		queryGoalKnowledge,
		recordGoalKnowledgeNote,
	];
}
