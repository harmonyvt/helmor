import { describe, expect, test } from "bun:test";
import {
	createKanbanTools,
	resolvePendingKanbanCall,
} from "./pi-kanban-tools.js";

describe("createKanbanTools", () => {
	test("exposes assignee model listing before board creation tools", () => {
		const tools = createKanbanTools(
			"goal-workspace-1",
			{ kanbanToolCall() {} } as never,
			"request-1",
		);

		expect(tools.map((tool) => tool.name)).toEqual([
			"list_assignee_models",
			"list_kanban_cards",
			"create_kanban_card",
			"move_kanban_card",
			"update_kanban_card",
		]);
		expect(tools[0]?.description).toContain("show the choices to the user");
	});

	test("forwards the user-selected assignee model for create-card handoffs", async () => {
		const calls: Array<{ toolCallId: string; args: Record<string, unknown> }> =
			[];
		const tools = createKanbanTools(
			"goal-workspace-1",
			{
				kanbanToolCall(
					_requestId: string,
					toolCallId: string,
					_toolName: string,
					_workspaceId: string,
					args: Record<string, unknown>,
				) {
					calls.push({ toolCallId, args });
					queueMicrotask(() =>
						resolvePendingKanbanCall(toolCallId, { ok: true }, false),
					);
				},
			} as never,
			"request-1",
			{
				assignedProvider: "pi",
			},
		);
		const createCard = tools.find((tool) => tool.name === "create_kanban_card");
		expect(createCard).toBeDefined();
		expect(createCard?.parameters.properties.assigned_provider).toBeUndefined();
		expect(createCard?.parameters.properties.assigned_model_id).toBeDefined();

		await createCard?.execute(
			"sdk-tool-call-1",
			{
				title: "Child",
				lane: "backlog",
				assigned_provider: "claude",
				assigned_model_id: "pi:anthropic/claude-sonnet-4-6",
			} as never,
			new AbortController().signal,
			() => {},
			{} as never,
		);

		expect(calls[0]?.args).toMatchObject({
			assignedProvider: "pi",
			assignedModelId: "pi:anthropic/claude-sonnet-4-6",
		});
	});
});
