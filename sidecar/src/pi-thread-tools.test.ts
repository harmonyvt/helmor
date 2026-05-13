import { describe, expect, test } from "bun:test";
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
});
