import { describe, expect, test } from "bun:test";
import { resolvePendingKanbanCall } from "./pi-kanban-tools.js";
import { createWorkspaceOperationTools } from "./pi-workspace-tools.js";

describe("createWorkspaceOperationTools", () => {
	test("emits project workspace inventory, merge, and landing operations through the goal bridge", async () => {
		const calls: Array<{
			toolCallId: string;
			toolName: string;
			workspaceId: string;
			args: Record<string, unknown>;
		}> = [];
		const tools = createWorkspaceOperationTools(
			"goal-workspace-1",
			{
				kanbanToolCall(
					_requestId: string,
					toolCallId: string,
					toolName: string,
					workspaceId: string,
					args: Record<string, unknown>,
				) {
					calls.push({ toolCallId, toolName, workspaceId, args });
					queueMicrotask(() =>
						resolvePendingKanbanCall(toolCallId, { ok: true }, false),
					);
				},
			} as never,
			"request-1",
		);

		const mergeTool = tools.find(
			(tool) => tool.name === "merge_change_request",
		);
		const listProjectWorkspacesTool = tools.find(
			(tool) => tool.name === "list_project_workspaces",
		);
		const markLandedTool = tools.find(
			(tool) => tool.name === "mark_workspace_landed",
		);
		expect(listProjectWorkspacesTool).toBeDefined();
		expect(mergeTool).toBeDefined();
		expect(markLandedTool).toBeDefined();

		await listProjectWorkspacesTool?.execute(
			"sdk-tool-call-0",
			{ include_archived: true } as never,
			new AbortController().signal,
			() => {},
			{} as never,
		);
		await mergeTool?.execute(
			"sdk-tool-call-1",
			{ card_id: "child-workspace-1" } as never,
			new AbortController().signal,
			() => {},
			{} as never,
		);
		await markLandedTool?.execute(
			"sdk-tool-call-2",
			{ card_id: "child-workspace-1" } as never,
			new AbortController().signal,
			() => {},
			{} as never,
		);

		expect(calls).toEqual([
			expect.objectContaining({
				toolName: "list_project_workspaces",
				workspaceId: "goal-workspace-1",
				args: {
					goalWorkspaceId: "goal-workspace-1",
					includeArchived: true,
				},
			}),
			expect.objectContaining({
				toolName: "merge_change_request",
				workspaceId: "goal-workspace-1",
				args: {
					goalWorkspaceId: "goal-workspace-1",
					cardId: "child-workspace-1",
				},
			}),
			expect.objectContaining({
				toolName: "mark_workspace_landed",
				workspaceId: "goal-workspace-1",
				args: {
					goalWorkspaceId: "goal-workspace-1",
					cardId: "child-workspace-1",
				},
			}),
		]);
	});
});
