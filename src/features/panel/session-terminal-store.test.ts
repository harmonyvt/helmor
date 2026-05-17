import { beforeEach, describe, expect, test, vi } from "vitest";
import { spawnSessionTerminal } from "@/lib/api";
import {
	_resetSessionTerminalStoreForTesting,
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
});
