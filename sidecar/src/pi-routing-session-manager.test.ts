import { describe, expect, it, mock } from "bun:test";
import { PiRoutingSessionManager } from "./pi-routing-session-manager";
import type { SendMessageParams } from "./session-manager";

const baseParams: SendMessageParams = {
	sessionId: "session-1",
	prompt: "hello",
	model: "pi:anthropic/claude-sonnet-4-6",
	cwd: "/tmp/project",
	resume: undefined,
	permissionMode: undefined,
	effortLevel: undefined,
	fastMode: undefined,
	images: [],
};

describe("PiRoutingSessionManager", () => {
	it("routes normal Pi sends to the regular Pi manager", async () => {
		const manager = new PiRoutingSessionManager();
		const regularSend = mock(async () => {});
		const goalSend = mock(async () => {});
		(
			manager.regular as unknown as { sendMessage: typeof regularSend }
		).sendMessage = regularSend;
		(manager.goals as unknown as { sendMessage: typeof goalSend }).sendMessage =
			goalSend;

		await manager.sendMessage("request-1", baseParams, {} as never);

		expect(regularSend).toHaveBeenCalledTimes(1);
		expect(goalSend).not.toHaveBeenCalled();
	});

	it("routes Goal Pi sends to the SDK supervisor manager", async () => {
		const manager = new PiRoutingSessionManager();
		const regularSend = mock(async () => {});
		const goalSend = mock(async () => {});
		(
			manager.regular as unknown as { sendMessage: typeof regularSend }
		).sendMessage = regularSend;
		(manager.goals as unknown as { sendMessage: typeof goalSend }).sendMessage =
			goalSend;

		await manager.sendMessage(
			"request-1",
			{ ...baseParams, kanbanWorkspaceId: "goal-1" },
			{} as never,
		);

		expect(goalSend).toHaveBeenCalledTimes(1);
		expect(regularSend).not.toHaveBeenCalled();
	});

	it("resolves Goal supervisor tool calls before falling back to regular Pi", () => {
		const manager = new PiRoutingSessionManager();
		const goalResolve = mock(() => true);
		const regularResolve = mock(() => {});
		(
			manager.goals as unknown as {
				resolveKanbanToolCall: typeof goalResolve;
			}
		).resolveKanbanToolCall = goalResolve;
		(
			manager.regular as unknown as {
				resolveKanbanToolCall: typeof regularResolve;
			}
		).resolveKanbanToolCall = regularResolve;

		manager.resolveKanbanToolCall("tool-1", { ok: true }, false);

		expect(goalResolve).toHaveBeenCalledWith("tool-1", { ok: true }, false);
		expect(regularResolve).not.toHaveBeenCalled();
	});
});
