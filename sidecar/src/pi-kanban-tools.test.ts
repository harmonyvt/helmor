import { describe, expect, test } from "bun:test";
import {
	createKanbanTools,
	resolvePendingKanbanCall,
} from "./pi-kanban-tools.js";

describe("createKanbanTools", () => {
	test("locks create-card handoffs to the current supervisor Pi model", async () => {
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
				assignedModelId: "pi:azure-openai-responses/gpt-5.5",
			},
		);
		const createCard = tools.find((tool) => tool.name === "create_kanban_card");
		expect(createCard).toBeDefined();
		expect(createCard?.parameters.properties.assigned_provider).toBeUndefined();
		expect(createCard?.parameters.properties.assigned_model_id).toBeUndefined();

		await createCard?.execute(
			"sdk-tool-call-1",
			{
				title: "Child",
				lane: "backlog",
				assigned_provider: "claude",
				assigned_model_id: "claude-sonnet-4-6",
			} as never,
			new AbortController().signal,
			() => {},
			{} as never,
		);

		expect(calls[0]?.args).toMatchObject({
			assignedProvider: "pi",
			assignedModelId: "pi:azure-openai-responses/gpt-5.5",
		});
	});
});
