import { describe, expect, test } from "bun:test";
import { resolvePendingKanbanCall } from "./pi-kanban-tools.js";
import { createKnowledgeTools } from "./pi-knowledge-tools.js";

describe("createKnowledgeTools", () => {
	test("exposes project and goal knowledge tools", () => {
		const tools = createKnowledgeTools(
			"goal-workspace-1",
			{ kanbanToolCall() {} } as never,
			"request-1",
		);

		expect(tools.map((tool) => tool.name)).toEqual([
			"search_knowledge",
			"get_knowledge_status",
			"reindex_knowledge",
			"query_project_knowledge",
			"query_goal_knowledge",
			"record_goal_knowledge_note",
		]);
		expect(
			tools.find((tool) => tool.name === "query_goal_knowledge")?.description,
		).toContain("goal's overlay knowledge");
	});

	test("forwards scoped knowledge search and reindex through the Pi tool bridge", async () => {
		const calls: Array<{
			toolName: string;
			args: Record<string, unknown>;
		}> = [];
		const tools = createKnowledgeTools(
			"goal-workspace-1",
			{
				kanbanToolCall(
					_requestId: string,
					toolCallId: string,
					toolName: string,
					_workspaceId: string,
					args: Record<string, unknown>,
				) {
					calls.push({ toolName, args });
					queueMicrotask(() =>
						resolvePendingKanbanCall(toolCallId, { ok: true }, false),
					);
				},
			} as never,
			"request-1",
		);

		await tools
			.find((tool) => tool.name === "search_knowledge")
			?.execute(
				"sdk-tool-call-1",
				{ query: "status reporting", scope: "all", limit: 5 } as never,
				new AbortController().signal,
				() => {},
				{} as never,
			);
		await tools
			.find((tool) => tool.name === "reindex_knowledge")
			?.execute(
				"sdk-tool-call-2",
				{ scope: "goal" } as never,
				new AbortController().signal,
				() => {},
				{} as never,
			);

		expect(calls).toEqual([
			{
				toolName: "search_knowledge",
				args: {
					goalWorkspaceId: "goal-workspace-1",
					query: "status reporting",
					scope: "all",
					limit: 5,
				},
			},
			{
				toolName: "reindex_knowledge",
				args: {
					goalWorkspaceId: "goal-workspace-1",
					scope: "goal",
				},
			},
		]);
	});

	test("forwards goal knowledge note records through the Pi tool bridge", async () => {
		const calls: Array<{
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
		}> = [];
		const tools = createKnowledgeTools(
			"goal-workspace-1",
			{
				kanbanToolCall(
					_requestId: string,
					toolCallId: string,
					toolName: string,
					_workspaceId: string,
					args: Record<string, unknown>,
				) {
					calls.push({ toolCallId, toolName, args });
					queueMicrotask(() =>
						resolvePendingKanbanCall(toolCallId, { recorded: true }, false),
					);
				},
			} as never,
			"request-1",
		);
		const recordNote = tools.find(
			(tool) => tool.name === "record_goal_knowledge_note",
		);

		await recordNote?.execute(
			"sdk-tool-call-1",
			{
				title: "Decision",
				text: "No-code cards still allocate a child workspace.",
			} as never,
			new AbortController().signal,
			() => {},
			{} as never,
		);

		expect(calls[0]).toMatchObject({
			toolName: "record_goal_knowledge_note",
			args: {
				goalWorkspaceId: "goal-workspace-1",
				title: "Decision",
				text: "No-code cards still allocate a child workspace.",
			},
		});
	});
});
