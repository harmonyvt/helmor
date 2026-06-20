import { describe, expect, test } from "bun:test";
import type { Run, SDKAgent } from "@cursor/sdk";
import { CursorSessionManager } from "./cursor-session-manager.js";

interface InjectedCursorSession {
	readonly agent: Pick<SDKAgent, "close">;
	readonly run: Pick<Run, "cancel">;
}

function injectedSessions(
	manager: CursorSessionManager,
): Map<string, InjectedCursorSession> {
	// biome-ignore lint/suspicious/noExplicitAny: reach into private sessions map for focused cleanup regression coverage
	return (manager as any).sessions as Map<string, InjectedCursorSession>;
}

describe("CursorSessionManager.stopSession", () => {
	test("closes agent and deletes session when cancel rejects", async () => {
		const manager = new CursorSessionManager();
		const cancelError = new Error("cancel failed");
		let cancelCalls = 0;
		let closeCalls = 0;

		injectedSessions(manager).set("s1", {
			agent: {
				close: () => {
					closeCalls += 1;
				},
			},
			run: {
				cancel: async () => {
					cancelCalls += 1;
					throw cancelError;
				},
			},
		});

		let thrown: unknown;
		try {
			await manager.stopSession("s1");
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBe(cancelError);
		expect(cancelCalls).toBe(1);
		expect(closeCalls).toBe(1);
		expect(injectedSessions(manager).has("s1")).toBe(false);
	});
});
