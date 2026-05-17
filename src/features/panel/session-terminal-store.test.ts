import { beforeEach, describe, expect, test, vi } from "vitest";
import { spawnSessionTerminal } from "@/lib/api";
import {
	_resetSessionTerminalStoreForTesting,
	attachSessionTerminal,
	startSessionTerminal,
} from "./session-terminal-store";

vi.mock("@/lib/api", () => ({
	spawnSessionTerminal: vi.fn(() => Promise.resolve()),
	stopSessionTerminal: vi.fn(),
	writeSessionTerminalStdin: vi.fn(),
	resizeSessionTerminal: vi.fn(),
}));

describe("session terminal store", () => {
	beforeEach(() => {
		_resetSessionTerminalStoreForTesting();
		vi.mocked(spawnSessionTerminal).mockClear();
	});

	test("passes the first measured terminal size into spawn", () => {
		startSessionTerminal("repo-1", "workspace-1", "session-1", "codex", {
			cols: 101,
			rows: 37,
		});

		expect(spawnSessionTerminal).toHaveBeenCalledWith(
			"repo-1",
			"workspace-1",
			"session-1",
			"codex",
			expect.any(Function),
			{ cols: 101, rows: 37 },
		);
	});

	test("notifies listeners that startup is running immediately", () => {
		const onStatusChange = vi.fn();
		attachSessionTerminal("session-1", {
			onChunk: vi.fn(),
			onStatusChange,
		});

		startSessionTerminal("repo-1", "workspace-1", "session-1", "codex", {
			cols: 101,
			rows: 37,
		});

		expect(onStatusChange).toHaveBeenCalledWith("running", null);
	});
});
