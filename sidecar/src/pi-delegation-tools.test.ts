import { describe, expect, test } from "bun:test";
import type { SidecarEmitter } from "./emitter.js";
import { createDelegationTools } from "./pi-delegation-tools.js";

function fakeEmitter(): SidecarEmitter {
	return {
		kanbanToolCall() {},
	} as unknown as SidecarEmitter;
}

describe("Pi delegation tools", () => {
	test("exposes delegate_agent with structured schema parameters", () => {
		const tools = createDelegationTools(
			"parent-session",
			fakeEmitter(),
			"request-1",
		);
		expect(tools).toHaveLength(1);
		const tool = tools[0];
		expect(tool).toBeDefined();
		expect(tool!.name).toBe("delegate_agent");
		expect(tool!.promptSnippet).toContain("outputSchema");
		expect(JSON.stringify(tool!.parameters)).toContain("outputSchema");
	});
});
