import { describe, expect, test } from "bun:test";
import { createAssigneeTools } from "./pi-assignee-tools.js";

describe("createAssigneeTools", () => {
	test("exposes Pi-facing assignee communication tools", () => {
		const tools = createAssigneeTools(
			"goal-workspace-1",
			{ kanbanToolCall() {} } as never,
			"request-1",
		);

		expect(tools.map((tool) => tool.name)).toEqual([
			"send_assignee_message",
			"read_assignee_thread",
			"summarize_assignee_status",
			"set_card_assignee_thread",
			"list_assignees",
		]);
	});
});
