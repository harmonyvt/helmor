import { invoke } from "@tauri-apps/api/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
	loadGithubCliStatus: vi.fn(),
	openForgeCliAuthTerminal: vi.fn(),
	loadWorkspaceGroups: vi.fn(),
	loadArchivedWorkspaces: vi.fn(),
	loadAgentModelSections: vi.fn(),
	listRepositories: vi.fn(),
	loadWorkspaceDetail: vi.fn(),
	loadWorkspaceSessions: vi.fn(),
	loadSessionMessages: vi.fn(),
	loadSessionThreadMessages: vi.fn(),
}));

vi.mock("./App.css", () => ({}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: vi.fn(),
}));

vi.mock("./lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./lib/api")>();

	return {
		...actual,
		loadGithubCliStatus: apiMocks.loadGithubCliStatus,
		openForgeCliAuthTerminal: apiMocks.openForgeCliAuthTerminal,
		loadWorkspaceGroups: apiMocks.loadWorkspaceGroups,
		loadArchivedWorkspaces: apiMocks.loadArchivedWorkspaces,
		loadAgentModelSections: apiMocks.loadAgentModelSections,
		listRepositories: apiMocks.listRepositories,
		loadWorkspaceDetail: apiMocks.loadWorkspaceDetail,
		loadWorkspaceSessions: apiMocks.loadWorkspaceSessions,
		loadSessionMessages: apiMocks.loadSessionThreadMessages,
		loadSessionThreadMessages: apiMocks.loadSessionThreadMessages,
	};
});

import App from "./App";

const GITHUB_READY = {
	status: "ready" as const,
	host: "github.com",
	login: "octocat",
	version: "2.88.1",
	message: "GitHub CLI ready as octocat.",
};

const GITHUB_UNAUTH = {
	status: "unauthenticated" as const,
	host: "github.com",
	version: "2.88.1",
	message: "Run `gh auth login` to connect GitHub CLI.",
};

function installTauriRuntime() {
	Object.defineProperty(window, "__TAURI_INTERNALS__", {
		value: {},
		configurable: true,
	});
}

function removeTauriRuntime() {
	Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
}

function mockWorkspaceData() {
	apiMocks.loadWorkspaceGroups.mockResolvedValue([
		{
			id: "progress",
			label: "In progress",
			tone: "progress",
			rows: [
				{
					id: "workspace-1",
					title: "Authenticated workspace",
					repoName: "helmor-core",
					state: "ready",
				},
			],
		},
	]);
	apiMocks.loadArchivedWorkspaces.mockResolvedValue([]);
	apiMocks.loadAgentModelSections.mockResolvedValue([]);
	apiMocks.listRepositories.mockResolvedValue([]);
	apiMocks.loadWorkspaceDetail.mockResolvedValue({
		id: "workspace-1",
		title: "Authenticated workspace",
		repoId: "repo-1",
		repoName: "helmor-core",
		directoryName: "authenticated-workspace",
		state: "ready",
		hasUnread: false,
		workspaceUnread: 0,
		unreadSessionCount: 0,
		status: "in-progress",
		activeSessionId: "session-1",
		activeSessionTitle: "Untitled",
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
	});
	apiMocks.loadWorkspaceSessions.mockResolvedValue([
		{
			id: "session-1",
			workspaceId: "workspace-1",
			title: "Untitled",
			agentType: "claude",
			status: "idle",
			model: "opus",
			permissionMode: "default",
			providerSessionId: null,
			unreadCount: 0,
			codexThinkingLevel: null,
			fastMode: false,
			createdAt: "2026-04-04T00:00:00Z",
			updatedAt: "2026-04-04T00:00:00Z",
			lastUserMessageAt: null,
			isHidden: false,
			active: true,
		},
	]);
	apiMocks.loadSessionMessages.mockResolvedValue([]);
	apiMocks.loadSessionThreadMessages.mockResolvedValue([]);
}

describe("App GitHub identity states", () => {
	beforeEach(() => {
		window.localStorage.clear();
		installTauriRuntime();
		vi.mocked(invoke).mockClear();
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: vi.fn(async () => undefined),
			},
		});

		apiMocks.loadGithubCliStatus.mockReset();
		apiMocks.openForgeCliAuthTerminal.mockReset();
		apiMocks.loadWorkspaceGroups.mockReset();
		apiMocks.loadArchivedWorkspaces.mockReset();
		apiMocks.loadAgentModelSections.mockReset();
		apiMocks.listRepositories.mockReset();
		apiMocks.loadWorkspaceDetail.mockReset();
		apiMocks.loadWorkspaceSessions.mockReset();
		apiMocks.loadSessionMessages.mockReset();
		apiMocks.loadSessionThreadMessages.mockReset();
		apiMocks.loadGithubCliStatus.mockResolvedValue(GITHUB_UNAUTH);
		apiMocks.openForgeCliAuthTerminal.mockResolvedValue(undefined);

		mockWorkspaceData();
	});

	afterEach(() => {
		removeTauriRuntime();
		cleanup();
	});

	it("shows app onboarding once before checking GitHub identity", async () => {
		const invokeMock = vi.mocked(invoke);
		invokeMock.mockImplementationOnce(async (command) => {
			if (command === "get_app_settings") {
				return {
					"app.onboarding_completed": "false",
				};
			}
			return undefined;
		});

		const user = userEvent.setup();
		render(<App />);

		expect(
			await screen.findByRole("main", { name: "Helmor onboarding" }),
		).toBeInTheDocument();
		expect(
			screen.getByLabelText("Helmor workspace preview"),
		).toBeInTheDocument();
		expect(screen.getByText("Auth feature plan")).toBeInTheDocument();
		expect(screen.getByText("Actions")).toBeInTheDocument();
		expect(apiMocks.loadGithubCliStatus).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("main", { name: "GitHub identity gate" }),
		).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Explore" }));

		expect(
			await screen.findByRole("main", { name: "Helmor onboarding" }),
		).toBeInTheDocument();
		expect(apiMocks.loadGithubCliStatus).not.toHaveBeenCalled();
		expect(invokeMock).not.toHaveBeenCalledWith("update_app_settings", {
			settingsMap: {
				"app.onboarding_completed": "true",
			},
		});
	});

	it("renders the shell while GitHub account is disconnected", async () => {
		render(<App />);

		expect(
			await screen.findByRole("main", { name: "GitHub identity gate" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("main", { name: "Application shell" }),
		).not.toBeInTheDocument();
		expect(
			await screen.findByRole("button", { name: "Connect GitHub CLI" }),
		).toBeInTheDocument();
	});

	it("renders GitHub CLI errors in the gate", async () => {
		apiMocks.loadGithubCliStatus.mockResolvedValue({
			status: "error",
			host: "github.com",
			version: "2.88.1",
			message: "GitHub CLI auth check failed.",
		});

		render(<App />);
		expect(
			await screen.findByRole("main", { name: "GitHub identity gate" }),
		).toBeInTheDocument();
		expect(
			await screen.findByText("GitHub CLI auth check failed."),
		).toBeInTheDocument();
		expect(
			await screen.findByRole("button", { name: "Retry GitHub CLI" }),
		).toBeInTheDocument();
	});

	it("opens the GitHub CLI auth terminal from the gate", async () => {
		const user = userEvent.setup();
		render(<App />);

		await user.click(
			await screen.findByRole("button", { name: "Connect GitHub CLI" }),
		);

		expect(apiMocks.openForgeCliAuthTerminal).toHaveBeenCalledWith(
			"github",
			"github.com",
		);
	});

	it("uses a compact GitHub trigger in the toolbar", async () => {
		apiMocks.loadGithubCliStatus.mockResolvedValue(GITHUB_READY);

		render(<App />);

		await screen.findByRole("main", { name: "Application shell" });
		expect(
			screen.getByRole("button", { name: "GitHub account menu" }),
		).toHaveTextContent("octocat");
	});
});
