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
			"query_project_knowledge",
			"query_goal_knowledge",
			"record_goal_knowledge_note",
		]);
		expect(tools[1]?.description).toContain("goal's overlay knowledge");
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
