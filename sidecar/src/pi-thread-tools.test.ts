import { describe, expect, test } from "bun:test";
import { resolvePendingKanbanCall } from "./pi-kanban-tools.js";
import { createThreadTools } from "./pi-thread-tools.js";

describe("createThreadTools", () => {
	test("exposes Pi-facing thread management tools", () => {
		const tools = createThreadTools(
			"goal-workspace-1",
			{ kanbanToolCall() {} } as never,
			"request-1",
		);

		expect(tools.map((tool) => tool.name)).toEqual([
			"list_threads",
			"create_thread",
			"get_thread",
			"get_thread_runtime_status",
			"update_thread",
			"delete_thread",
			"send_thread_message",
		]);
	});

	test("does not expose or forward model overrides for thread sends", async () => {
		const calls: Array<{ toolCallId: string; args: Record<string, unknown> }> =
			[];
		const tools = createThreadTools(
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
		);
		const sendThreadMessage = tools.find(
			(tool) => tool.name === "send_thread_message",
		);
		expect(sendThreadMessage).toBeDefined();
		expect(sendThreadMessage?.parameters.properties.model_id).toBeUndefined();

		await sendThreadMessage?.execute(
			"sdk-tool-call-1",
			{
				workspace_id: "child-1",
				thread_id: "thread-1",
				message: "Continue",
				model_id: "claude-sonnet-4-6",
			} as never,
			new AbortController().signal,
			() => {},
			{} as never,
		);

		expect(calls[0]?.args).toMatchObject({
			workspaceId: "child-1",
			threadId: "thread-1",
			message: "Continue",
			modelId: null,
		});
	});
});
