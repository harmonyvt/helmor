import { describe, expect, test } from "vitest";
import {
	formatLiveTerminalTitle,
	shouldAutoUpdateTerminalTitle,
	terminalDefaultTitle,
	terminalRuntimeLabel,
} from "./session-terminal-labels";

describe("session terminal labels", () => {
	test("formats known terminal runtimes", () => {
		expect(terminalRuntimeLabel("claude")).toBe("Claude");
		expect(terminalRuntimeLabel("codex")).toBe("Codex");
		expect(terminalRuntimeLabel("open-code")).toBe("OpenCode");
		expect(terminalRuntimeLabel("pi")).toBe("Pi");
		expect(terminalRuntimeLabel(null)).toBe("Shell");
	});

	test("builds provider-aware fallback titles", () => {
		expect(
			terminalDefaultTitle({
				surfaceMode: "terminal",
				terminalRuntime: "codex",
				agentType: "codex",
			}),
		).toBe("Codex Terminal");
	});

	test("allows generated titles to track live terminal activity", () => {
		expect(shouldAutoUpdateTerminalTitle("Terminal")).toBe(true);
		expect(shouldAutoUpdateTerminalTitle("Codex Terminal")).toBe(true);
		expect(shouldAutoUpdateTerminalTitle("Codex · Create PR")).toBe(true);
		expect(shouldAutoUpdateTerminalTitle("My manual title")).toBe(false);
	});

	test("formats sanitized live terminal titles", () => {
		expect(
			formatLiveTerminalTitle(
				{
					surfaceMode: "terminal",
					terminalRuntime: "claude",
					agentType: "claude",
				},
				"\u0007Implement Helmor Thread agents",
			),
		).toBe("Claude · Implement Helmor Thread agents");

		expect(
			formatLiveTerminalTitle(
				{
					surfaceMode: "terminal",
					terminalRuntime: "shell",
					agentType: "shell",
				},
				"π - shaula",
			),
		).toBe("π - shaula");
	});
});
