import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalHandle } from "@/components/terminal-output";
import type { WorkspaceDetail, WorkspaceSessionSummary } from "@/lib/api";
import { createHelmorQueryClient } from "@/lib/query-client";
import type { SessionTerminalState } from "./session-terminal-store";

function createAttachedTerminalState(
	overrides: Partial<SessionTerminalState> = {},
): SessionTerminalState {
	return {
		bufferedBytes: 0,
		chunks: [],
		exitCode: null,
		started: false,
		status: "new",
		truncated: false,
		...overrides,
	};
}

const terminalOutputMock = vi.hoisted(() => ({
	onReady: null as (() => void) | null,
	onResize: null as ((cols: number, rows: number) => void) | null,
}));

const storeMocks = vi.hoisted(() => ({
	attachSessionTerminal: vi.fn(() => createAttachedTerminalState()),
	detachSessionTerminal: vi.fn(),
	resizeSessionTerminalProcess: vi.fn(),
	startSessionTerminal: vi.fn(),
	stopSessionTerminalProcess: vi.fn(),
	writeSessionTerminal: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
	getSessionTerminalStatus: vi.fn(() =>
		Promise.resolve({
			available: false,
			exists: false,
			dead: false,
			currentCommand: null,
			clientCount: 0,
		}),
	),
	captureSessionTerminal: vi.fn(() => Promise.resolve("")),
	renameSession: vi.fn(() => Promise.resolve()),
	updateSessionControl: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/components/terminal-output", () => ({
	TerminalOutput: ({
		terminalRef,
		onReady,
		onResize,
	}: {
		terminalRef?: MutableRefObject<TerminalHandle | null>;
		onReady?: () => void;
		onResize?: (cols: number, rows: number) => void;
	}) => {
		terminalOutputMock.onReady = onReady ?? null;
		terminalOutputMock.onResize = onResize ?? null;
		if (terminalRef) {
			terminalRef.current = {
				clear: vi.fn(),
				dispose: vi.fn(),
				focus: vi.fn(),
				refit: vi.fn(),
				write: vi.fn(),
			};
		}
		return <div data-testid="terminal-output" />;
	},
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		captureSessionTerminal: apiMocks.captureSessionTerminal,
		getSessionTerminalStatus: apiMocks.getSessionTerminalStatus,
		renameSession: apiMocks.renameSession,
		updateSessionControl: apiMocks.updateSessionControl,
	};
});

vi.mock("./session-terminal-store", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./session-terminal-store")>();
	return {
		...actual,
		attachSessionTerminal: storeMocks.attachSessionTerminal,
		detachSessionTerminal: storeMocks.detachSessionTerminal,
		resizeSessionTerminalProcess: storeMocks.resizeSessionTerminalProcess,
		startSessionTerminal: storeMocks.startSessionTerminal,
		stopSessionTerminalProcess: storeMocks.stopSessionTerminalProcess,
		writeSessionTerminal: storeMocks.writeSessionTerminal,
	};
});

import { SessionTerminalSurface } from "./session-terminal-surface";

const workspace: WorkspaceDetail = {
	id: "workspace-1",
	title: "Workspace 1",
	repoId: "repo-1",
	repoName: "helmor",
	directoryName: "helmor",
	state: "ready",
	hasUnread: false,
	workspaceUnread: 0,
	unreadSessionCount: 0,
	status: "in-progress",
	activeSessionId: "session-1",
	activeSessionTitle: "Session 1",
	activeSessionAgentType: "claude",
	activeSessionStatus: "idle",
	branch: "main",
	initializationParentBranch: "main",
	intendedTargetBranch: "main",
	pinnedAt: null,
	prTitle: null,
	archiveCommit: null,
	sessionCount: 1,
	messageCount: 0,
	rootPath: "/tmp/helmor",
};

const session: WorkspaceSessionSummary = {
	id: "session-1",
	workspaceId: "workspace-1",
	title: "Shell",
	agentType: "codex",
	status: "idle",
	model: null,
	permissionMode: "default",
	providerSessionId: null,
	effortLevel: null,
	unreadCount: 0,
	fastMode: false,
	createdAt: "2026-05-17T00:00:00Z",
	updatedAt: "2026-05-17T00:00:00Z",
	lastUserMessageAt: null,
	isHidden: false,
	actionKind: null,
	active: true,
	terminalRuntime: "codex",
	terminalCwd: "/tmp/helmor",
	terminalStoppedAt: null,
	controlOwner: "user",
	inputPolicy: "writable",
};

function renderSurface(initialSession = session) {
	const queryClient = createHelmorQueryClient();
	const renderWithSession = (nextSession: WorkspaceSessionSummary) => (
		<QueryClientProvider client={queryClient}>
			<SessionTerminalSurface workspace={workspace} session={nextSession} />
		</QueryClientProvider>
	);
	const result = render(renderWithSession(initialSession));
	return {
		...result,
		rerenderWithSession: (nextSession: WorkspaceSessionSummary) =>
			result.rerender(renderWithSession(nextSession)),
	};
}

describe("SessionTerminalSurface", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		terminalOutputMock.onReady = null;
		terminalOutputMock.onResize = null;
		for (const mock of Object.values(storeMocks)) mock.mockClear();
		for (const mock of Object.values(apiMocks)) mock.mockClear();
		storeMocks.attachSessionTerminal.mockReturnValue(
			createAttachedTerminalState(),
		);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("does not start the backend fallback timer until the renderer is ready", () => {
		renderSurface();

		act(() => {
			vi.advanceTimersByTime(300);
		});
		expect(storeMocks.startSessionTerminal).not.toHaveBeenCalled();

		act(() => {
			terminalOutputMock.onReady?.();
		});
		act(() => {
			vi.advanceTimersByTime(250);
		});

		expect(storeMocks.startSessionTerminal).toHaveBeenCalledWith(
			"repo-1",
			"workspace-1",
			"session-1",
			"codex",
			null,
		);
	});

	it("starts with the first measured size and cancels fallback startup", () => {
		renderSurface();

		act(() => {
			terminalOutputMock.onReady?.();
			terminalOutputMock.onResize?.(101, 37);
			vi.advanceTimersByTime(300);
		});

		expect(storeMocks.startSessionTerminal).toHaveBeenCalledTimes(1);
		expect(storeMocks.startSessionTerminal).toHaveBeenCalledWith(
			"repo-1",
			"workspace-1",
			"session-1",
			"codex",
			{ cols: 101, rows: 37 },
		);
	});

	it("starts a new session after the renderer is already ready without waiting for resize", () => {
		const { rerenderWithSession } = renderSurface();

		act(() => {
			terminalOutputMock.onReady?.();
		});
		storeMocks.startSessionTerminal.mockClear();

		rerenderWithSession({
			...session,
			id: "session-2",
			title: "Shell 2",
		});
		act(() => {
			vi.advanceTimersByTime(250);
		});

		expect(storeMocks.startSessionTerminal).toHaveBeenCalledTimes(1);
		expect(storeMocks.startSessionTerminal).toHaveBeenCalledWith(
			"repo-1",
			"workspace-1",
			"session-2",
			"codex",
			null,
		);
	});

	it("shows an already-running attached terminal as running", () => {
		storeMocks.attachSessionTerminal.mockReturnValue(
			createAttachedTerminalState({
				chunks: ["ready"],
				started: true,
				status: "running",
			}),
		);

		const { getByText } = renderSurface();

		expect(getByText("running")).toBeInTheDocument();
	});
});
