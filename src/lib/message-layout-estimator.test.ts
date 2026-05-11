import { describe, expect, it } from "vitest";
import type { ThreadMessageLike, ToolCallPart } from "./api";
import { estimateThreadRowHeights } from "./message-layout-estimator";

function makeTool(index: number): ToolCallPart {
	return {
		type: "tool-call",
		toolCallId: `tool-${index}`,
		toolName: "Bash",
		args: { command: `sed -n '${index},${index + 8}p' src/file.ts` },
		argsText: "",
		result: index % 2 === 0 ? "line 1\nline 2\nline 3" : undefined,
		streamingStatus: index === 3 ? "running" : "done",
	};
}

describe("estimateThreadRowHeights", () => {
	it("reserves expanded height for collapsed tool groups", () => {
		const messages: ThreadMessageLike[] = [
			{
				id: "assistant-streaming",
				role: "assistant",
				streaming: true,
				content: [
					{ type: "text", id: "text-1", text: "Streaming response" },
					{
						type: "collapsed-group",
						id: "group-1",
						category: "shell",
						active: true,
						summary: "Running 4 read-only commands...",
						tools: Array.from({ length: 4 }, (_, index) => makeTool(index)),
					},
				],
			},
		];

		const [height] = estimateThreadRowHeights(messages, {
			fontSize: 14,
			paneWidth: 960,
		});

		expect(height).toBeGreaterThan(150);
	});

	it("uses a safe upper-bound estimate for delegation previews", () => {
		const messages: ThreadMessageLike[] = [
			{
				id: "assistant-delegation",
				role: "assistant",
				streaming: true,
				content: [
					{
						type: "delegation-anchor",
						id: "delegation-1",
						delegationId: "delegation-1",
						parentSessionId: "parent-session",
						childSessionId: "child-session",
						title: "Working on the delegated task",
						provider: "pi",
						status: "running",
						outputSchema: null,
					},
				],
			},
		];

		const [height] = estimateThreadRowHeights(messages, {
			fontSize: 14,
			paneWidth: 960,
		});

		expect(height).toBeGreaterThanOrEqual(600);
	});
});
