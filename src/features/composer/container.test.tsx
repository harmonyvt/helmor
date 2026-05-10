import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createHelmorQueryClient, helmorQueryKeys } from "@/lib/query-client";
import { sessionThreadCacheKey } from "@/lib/session-thread-cache";
import { DEFAULT_SETTINGS, SettingsContext } from "@/lib/settings";

const apiMockState = vi.hoisted(() => ({
	createSession: vi.fn(),
	loadSessionThreadMessages: vi.fn(),
	listSlashCommands: vi.fn(),
	listWorkspaceLinkedDirectories: vi.fn(),
	setWorkspaceLinkedDirectories: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
	return {
		...actual,
		createSession: apiMockState.createSession,
		loadSessionThreadMessages: apiMockState.loadSessionThreadMessages,
		listSlashCommands: apiMockState.listSlashCommands,
		listWorkspaceLinkedDirectories: apiMockState.listWorkspaceLinkedDirectories,
		setWorkspaceLinkedDirectories: apiMockState.setWorkspaceLinkedDirectories,
	};
});

vi.mock("./provider-swap-dialog", () => ({
	ProviderSwapDialog: ({
		onChoose,
		onCancel,
	}: {
		onChoose: (choice: "bring-history" | "start-fresh") => void;
		onCancel: () => void;
	}) => (
		<div data-testid="provider-swap-dialog">
			<button type="button" onClick={() => onChoose("bring-history")}>
				Bring history
			</button>
			<button type="button" onClick={() => onChoose("start-fresh")}>
				Start fresh
			</button>
			<button type="button" onClick={onCancel}>
				Cancel
			</button>
		</div>
	),
}));

type PickHandler = (entry: unknown) => void;
type RemoveHandler = (path: string) => void;

const composerMockState = vi.hoisted(() => ({
	renders: [] as string[],
	mounts: 0,
	unmounts: 0,
	lastSlashCommands: [] as Array<{
		name: string;
		description: string;
		source: string;
		providers?: readonly string[] | null;
	}>,
	lastLinkedDirectories: [] as readonly string[],
	lastOnRemoveLinkedDirectory: null as RemoveHandler | null,
	lastAddDirCandidates: [] as readonly unknown[],
	lastOnPickAddDir: null as PickHandler | null,
	lastOnSelectModel: null as ((modelId: string) => void) | null,
	lastPlanReview: null as unknown,
	lastOnImplementPlanInCleanThread: null as ((plan: unknown) => void) | null,
	lastAgentType: null as "claude" | "codex" | "pi" | null,
}));

vi.mock("./index", async () => {
	const React = await import("react");

	return {
		WorkspaceComposer: (props: {
			contextKey: string;
			selectedModelId: string | null;
			onSelectModel: (modelId: string) => void;
			fastMode?: boolean;
			disabled?: boolean;
			submitDisabled?: boolean;
			slashCommands?: readonly {
				name: string;
				description: string;
				source: string;
				providers?: readonly string[] | null;
			}[];
			linkedDirectories?: readonly string[];
			onRemoveLinkedDirectory?: RemoveHandler;
			addDirCandidates?: readonly unknown[];
			onPickAddDir?: PickHandler;
			planReview?: unknown;
			onImplementPlanInCleanThread?: (
				plan: unknown,
				modelId?: string | null,
			) => void;
			agentType?: "claude" | "codex" | "pi" | null;
		}) => {
			composerMockState.renders.push(props.contextKey);
			composerMockState.lastSlashCommands = [...(props.slashCommands ?? [])];
			composerMockState.lastLinkedDirectories = props.linkedDirectories ?? [];
			composerMockState.lastOnRemoveLinkedDirectory =
				props.onRemoveLinkedDirectory ?? null;
			composerMockState.lastAddDirCandidates = [
				...(props.addDirCandidates ?? []),
			];
			composerMockState.lastOnPickAddDir = props.onPickAddDir ?? null;
			composerMockState.lastOnSelectModel = props.onSelectModel;
			composerMockState.lastPlanReview = props.planReview ?? null;
			composerMockState.lastOnImplementPlanInCleanThread =
				props.onImplementPlanInCleanThread ?? null;
			composerMockState.lastAgentType = props.agentType ?? null;
			React.useEffect(() => {
				composerMockState.mounts += 1;
				return () => {
					composerMockState.unmounts += 1;
				};
			}, []);

			return (
				<div
					data-testid="workspace-composer-mock"
					data-fast-mode={props.fastMode ? "on" : "off"}
					data-disabled={props.disabled ? "true" : "false"}
					data-submit-disabled={props.submitDisabled ? "true" : "false"}
					data-agent-type={props.agentType ?? "none"}
				>
					{props.contextKey}:{props.selectedModelId ?? "none"}
				</div>
			);
		},
	};
});

import { WorkspaceComposerContainer } from "./container";

const MODEL_SECTIONS = [
	{
		id: "claude",
		label: "Claude",
		options: [
			{
				id: "opus-1m",
				provider: "claude",
				label: "Opus 4.7 1M",
				cliModel: "opus-1m",
				effortLevels: ["low", "medium", "high"],
			},
		],
	},
	{
		id: "codex",
		label: "Codex",
		options: [
			{
				id: "gpt-5.4",
				provider: "codex",
				label: "GPT-5.4",
				cliModel: "gpt-5.4",
				effortLevels: ["low", "medium", "high"],
				supportsFastMode: true,
			},
		],
	},
	{
		id: "pi",
		label: "Pi",
		options: [
			{
				id: "pi-gpt-5.4",
				provider: "pi",
				label: "Pi · GPT-5.4",
				cliModel: "azure-openai-responses/gpt-5.4",
				effortLevels: ["low", "medium", "high"],
			},
		],
	},
] as const;

const WORKSPACE_DETAIL = {
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
	sessionCount: 2,
	messageCount: 2,
	rootPath: "/tmp/helmor",
};

const WORKSPACE_SESSIONS = [
	{
		id: "session-1",
		workspaceId: "workspace-1",
		title: "Session 1",
		agentType: "claude",
		status: "idle",
		model: "opus-1m",
		permissionMode: "default",
		providerSessionId: null,
		unreadCount: 0,
		codexThinkingLevel: null,
		fastMode: false,
		createdAt: "2026-04-05T00:00:00Z",
		updatedAt: "2026-04-05T00:00:00Z",
		lastUserMessageAt: null,
		isHidden: false,
		active: true,
	},
	{
		id: "session-2",
		workspaceId: "workspace-1",
		title: "Session 2",
		agentType: "codex",
		status: "idle",
		model: "gpt-5.4",
		permissionMode: "default",
		providerSessionId: null,
		unreadCount: 0,
		codexThinkingLevel: "high",
		fastMode: false,
		createdAt: "2026-04-05T00:00:00Z",
		updatedAt: "2026-04-05T00:00:00Z",
		lastUserMessageAt: null,
		isHidden: false,
		active: false,
	},
];

describe("WorkspaceComposerContainer", () => {
	beforeEach(() => {
		composerMockState.renders = [];
		composerMockState.mounts = 0;
		composerMockState.unmounts = 0;
		composerMockState.lastOnSelectModel = null;
		composerMockState.lastPlanReview = null;
		composerMockState.lastOnImplementPlanInCleanThread = null;
		composerMockState.lastAgentType = null;
		apiMockState.createSession.mockReset();
		apiMockState.createSession.mockResolvedValue({ sessionId: "session-new" });
		apiMockState.loadSessionThreadMessages.mockReset();
		apiMockState.loadSessionThreadMessages.mockResolvedValue([]);
		apiMockState.listSlashCommands.mockReset();
		apiMockState.listSlashCommands.mockResolvedValue({
			commands: [],
		});
		apiMockState.listWorkspaceLinkedDirectories.mockReset();
		apiMockState.listWorkspaceLinkedDirectories.mockResolvedValue([]);
		apiMockState.setWorkspaceLinkedDirectories.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("does not remount the composer when switching displayed sessions", () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			MODEL_SECTIONS,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceDetail("workspace-1"),
			WORKSPACE_DETAIL,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceSessions("workspace-1"),
			WORKSPACE_SESSIONS,
		);

		const renderComposer = (displayedSessionId: string) => (
			<QueryClientProvider client={queryClient}>
				<WorkspaceComposerContainer
					displayedWorkspaceId="workspace-1"
					displayedSessionId={displayedSessionId}
					disabled={false}
					sending={false}
					sendError={null}
					restoreDraft={null}
					restoreImages={[]}
					restoreFiles={[]}
					restoreNonce={0}
					modelSelections={{}}
					effortLevels={{}}
					permissionModes={{}}
					fastModes={{}}
					onSelectModel={vi.fn()}
					onSelectEffort={vi.fn()}
					onChangePermissionMode={vi.fn()}
					onChangeFastMode={vi.fn()}
					onSubmit={vi.fn()}
				/>
			</QueryClientProvider>
		);
		const { rerender } = render(renderComposer("session-1"));

		expect(screen.getByTestId("workspace-composer-mock")).toHaveTextContent(
			"session:session-1:opus-1m",
		);
		expect(composerMockState.mounts).toBe(1);
		expect(composerMockState.unmounts).toBe(0);

		rerender(renderComposer("session-2"));

		expect(screen.getByTestId("workspace-composer-mock")).toHaveTextContent(
			"session:session-2:gpt-5.4",
		);
		expect(composerMockState.mounts).toBe(1);
		expect(composerMockState.unmounts).toBe(0);
		expect(composerMockState.renders).toEqual([
			"session:session-1",
			"session:session-2",
		]);
	});

	it("passes the Pi provider through to the composer for Pi sessions", () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			MODEL_SECTIONS,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceDetail("workspace-1"),
			WORKSPACE_DETAIL,
		);
		queryClient.setQueryData(helmorQueryKeys.workspaceSessions("workspace-1"), [
			...WORKSPACE_SESSIONS,
			{
				...WORKSPACE_SESSIONS[0],
				id: "session-pi",
				title: "Pi session",
				agentType: "pi",
				model: "pi-gpt-5.4",
				active: false,
			},
		]);

		render(
			<QueryClientProvider client={queryClient}>
				<WorkspaceComposerContainer
					displayedWorkspaceId="workspace-1"
					displayedSessionId="session-pi"
					disabled={false}
					sending={false}
					sendError={null}
					restoreDraft={null}
					restoreImages={[]}
					restoreFiles={[]}
					restoreNonce={0}
					modelSelections={{}}
					effortLevels={{}}
					permissionModes={{}}
					fastModes={{}}
					onSelectModel={vi.fn()}
					onSelectEffort={vi.fn()}
					onChangePermissionMode={vi.fn()}
					onChangeFastMode={vi.fn()}
					onSubmit={vi.fn()}
				/>
			</QueryClientProvider>,
		);

		const composer = screen.getByTestId("workspace-composer-mock");
		expect(composer).toHaveTextContent("session:session-pi:pi-gpt-5.4");
		expect(composer).toHaveAttribute("data-agent-type", "pi");
		expect(composerMockState.lastAgentType).toBe("pi");
	});

	it("filters available models for specialized chat surfaces", () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			MODEL_SECTIONS,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceDetail("workspace-1"),
			WORKSPACE_DETAIL,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceSessions("workspace-1"),
			WORKSPACE_SESSIONS,
		);

		render(
			<QueryClientProvider client={queryClient}>
				<WorkspaceComposerContainer
					displayedWorkspaceId="workspace-1"
					displayedSessionId="session-1"
					disabled={false}
					sending={false}
					sendError={null}
					restoreDraft={null}
					restoreImages={[]}
					restoreFiles={[]}
					restoreNonce={0}
					modelSelections={{}}
					effortLevels={{}}
					permissionModes={{}}
					fastModes={{}}
					onSelectModel={vi.fn()}
					onSelectEffort={vi.fn()}
					onChangePermissionMode={vi.fn()}
					onChangeFastMode={vi.fn()}
					onSubmit={vi.fn()}
					modelFilter={(model) => model.provider === "pi"}
				/>
			</QueryClientProvider>,
		);

		const composer = screen.getByTestId("workspace-composer-mock");
		expect(composer).toHaveTextContent("session:session-1:pi-gpt-5.4");
		expect(composer).toHaveAttribute("data-agent-type", "pi");
	});

	it("auto-submits queued CLI prompts with queued model and permission mode", async () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			MODEL_SECTIONS,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceDetail("workspace-1"),
			WORKSPACE_DETAIL,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceSessions("workspace-1"),
			WORKSPACE_SESSIONS,
		);

		const onSubmit = vi.fn();
		const onPendingPromptConsumed = vi.fn();

		render(
			<QueryClientProvider client={queryClient}>
				<WorkspaceComposerContainer
					displayedWorkspaceId="workspace-1"
					displayedSessionId="session-1"
					disabled={false}
					sending={false}
					sendError={null}
					restoreDraft={null}
					restoreImages={[]}
					restoreFiles={[]}
					restoreNonce={0}
					modelSelections={{}}
					effortLevels={{}}
					permissionModes={{}}
					fastModes={{}}
					onSelectModel={vi.fn()}
					onSelectEffort={vi.fn()}
					onChangePermissionMode={vi.fn()}
					onChangeFastMode={vi.fn()}
					onSubmit={onSubmit}
					pendingPromptForSession={{
						sessionId: "session-1",
						prompt: "Plan the fix",
						modelId: "gpt-5.4",
						permissionMode: "plan",
					}}
					onPendingPromptConsumed={onPendingPromptConsumed}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "Plan the fix",
				model: expect.objectContaining({
					id: "gpt-5.4",
					provider: "codex",
				}),
				permissionMode: "plan",
			}),
		);
		expect(onPendingPromptConsumed).toHaveBeenCalledTimes(1);
	});

	it("seeds the new session and empty thread cache before selecting a switched provider model", async () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			MODEL_SECTIONS,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceDetail("workspace-1"),
			WORKSPACE_DETAIL,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceSessions("workspace-1"),
			WORKSPACE_SESSIONS,
		);
		apiMockState.loadSessionThreadMessages.mockResolvedValue([
			{
				id: "m1",
				role: "user",
				content: [{ type: "text", id: "m1:t", text: "hello" }],
				createdAt: "2026-04-05T00:00:00Z",
			},
		]);

		const onSelectModel = vi.fn();
		const onSwitchSession = vi.fn();

		render(
			<QueryClientProvider client={queryClient}>
				<WorkspaceComposerContainer
					displayedWorkspaceId="workspace-1"
					displayedSessionId="session-1"
					disabled={false}
					sending={false}
					sendError={null}
					restoreDraft={null}
					restoreImages={[]}
					restoreFiles={[]}
					restoreNonce={0}
					modelSelections={{}}
					effortLevels={{}}
					permissionModes={{}}
					fastModes={{}}
					onSelectModel={onSelectModel}
					onSelectEffort={vi.fn()}
					onChangePermissionMode={vi.fn()}
					onChangeFastMode={vi.fn()}
					onSwitchSession={onSwitchSession}
					onSubmit={vi.fn()}
				/>
			</QueryClientProvider>,
		);

		expect(composerMockState.lastOnSelectModel).not.toBeNull();
		composerMockState.lastOnSelectModel?.("gpt-5.4");
		fireEvent.click(await screen.findByText("Bring history"));

		await waitFor(() => {
			expect(onSelectModel).toHaveBeenCalledWith(
				"session:session-new",
				"gpt-5.4",
			);
		});
		expect(onSwitchSession).toHaveBeenCalledWith("session-new");
		expect(apiMockState.createSession).toHaveBeenCalledWith("workspace-1");
		expect(apiMockState.loadSessionThreadMessages).toHaveBeenCalledWith(
			"session-1",
		);
		expect(
			queryClient
				.getQueryData<typeof WORKSPACE_SESSIONS>(
					helmorQueryKeys.workspaceSessions("workspace-1"),
				)
				?.some((session) => session.id === "session-new"),
		).toBe(true);
		expect(
			queryClient.getQueryData(sessionThreadCacheKey("session-new")),
		).toEqual([]);
	});

	it("passes through pending prompt permission mode without a model override", async () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			MODEL_SECTIONS,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceDetail("workspace-1"),
			WORKSPACE_DETAIL,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceSessions("workspace-1"),
			WORKSPACE_SESSIONS,
		);

		const onSubmit = vi.fn();

		render(
			<QueryClientProvider client={queryClient}>
				<WorkspaceComposerContainer
					displayedWorkspaceId="workspace-1"
					displayedSessionId="session-1"
					disabled={false}
					sending={false}
					sendError={null}
					restoreDraft={null}
					restoreImages={[]}
					restoreFiles={[]}
					restoreNonce={0}
					modelSelections={{}}
					effortLevels={{}}
					permissionModes={{}}
					fastModes={{}}
					onSelectModel={vi.fn()}
					onSelectEffort={vi.fn()}
					onChangePermissionMode={vi.fn()}
					onChangeFastMode={vi.fn()}
					onSubmit={onSubmit}
					pendingPromptForSession={{
						sessionId: "session-1",
						prompt: "Implement this plan",
						permissionMode: "bypassPermissions",
					}}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "Implement this plan",
				permissionMode: "bypassPermissions",
			}),
		);
	});

	it("creates a clean implementation prompt for plan review actions", async () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			MODEL_SECTIONS,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceDetail("workspace-1"),
			WORKSPACE_DETAIL,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceSessions("workspace-1"),
			WORKSPACE_SESSIONS,
		);

		const onImplementPlanInCleanThread = vi.fn();
		const planReview = {
			type: "plan-review" as const,
			toolUseId: "tool-plan-1",
			toolName: "ExitPlanMode",
			plan: "1. Do the thing",
			planFilePath: "/tmp/plan.md",
			allowedPrompts: [],
		};

		render(
			<QueryClientProvider client={queryClient}>
				<WorkspaceComposerContainer
					displayedWorkspaceId="workspace-1"
					displayedSessionId="session-1"
					disabled={false}
					sending={false}
					sendError={null}
					restoreDraft={null}
					restoreImages={[]}
					restoreFiles={[]}
					restoreNonce={0}
					modelSelections={{}}
					effortLevels={{}}
					permissionModes={{}}
					fastModes={{}}
					onSelectModel={vi.fn()}
					onSelectEffort={vi.fn()}
					onChangePermissionMode={vi.fn()}
					onChangeFastMode={vi.fn()}
					onSubmit={vi.fn()}
					planReview={planReview}
					onImplementPlanInCleanThread={onImplementPlanInCleanThread}
				/>
			</QueryClientProvider>,
		);

		expect(composerMockState.lastPlanReview).toBe(planReview);
		composerMockState.lastOnImplementPlanInCleanThread?.(planReview);

		expect(onImplementPlanInCleanThread).toHaveBeenCalledWith(planReview);
	});

	it("loads slash commands when the composer mounts", async () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			MODEL_SECTIONS,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceDetail("workspace-1"),
			WORKSPACE_DETAIL,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceSessions("workspace-1"),
			WORKSPACE_SESSIONS,
		);

		render(
			<QueryClientProvider client={queryClient}>
				<WorkspaceComposerContainer
					displayedWorkspaceId="workspace-1"
					displayedSessionId="session-1"
					disabled={false}
					sending={false}
					sendError={null}
					restoreDraft={null}
					restoreImages={[]}
					restoreFiles={[]}
					restoreNonce={0}
					modelSelections={{}}
					effortLevels={{}}
					permissionModes={{}}
					fastModes={{}}
					onSelectModel={vi.fn()}
					onSelectEffort={vi.fn()}
					onChangePermissionMode={vi.fn()}
					onChangeFastMode={vi.fn()}
					onSubmit={vi.fn()}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() =>
			expect(apiMockState.listSlashCommands).toHaveBeenCalledWith({
				provider: "claude",
				workingDirectory: "/tmp/helmor",
				repoId: "repo-1",
				workspaceId: "workspace-1",
			}),
		);
	});

	it("uses the default fast mode setting for new sessions", () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			MODEL_SECTIONS,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceDetail("workspace-1"),
			WORKSPACE_DETAIL,
		);
		queryClient.setQueryData(helmorQueryKeys.workspaceSessions("workspace-1"), [
			...WORKSPACE_SESSIONS,
			{
				id: "session-new",
				workspaceId: "workspace-1",
				title: "Untitled",
				agentType: null,
				status: "idle",
				model: null,
				permissionMode: "default",
				providerSessionId: null,
				unreadCount: 0,
				codexThinkingLevel: null,
				fastMode: false,
				createdAt: "2026-04-05T00:00:00Z",
				updatedAt: "2026-04-05T00:00:00Z",
				lastUserMessageAt: null,
				isHidden: false,
				active: false,
			},
		]);

		render(
			<SettingsContext.Provider
				value={{
					settings: {
						...DEFAULT_SETTINGS,
						defaultModelId: "gpt-5.4",
						defaultFastMode: true,
					},
					isLoaded: true,
					updateSettings: vi.fn(),
				}}
			>
				<QueryClientProvider client={queryClient}>
					<WorkspaceComposerContainer
						displayedWorkspaceId="workspace-1"
						displayedSessionId="session-new"
						disabled={false}
						sending={false}
						sendError={null}
						restoreDraft={null}
						restoreImages={[]}
						restoreFiles={[]}
						restoreNonce={0}
						modelSelections={{}}
						effortLevels={{}}
						permissionModes={{}}
						fastModes={{}}
						onSelectModel={vi.fn()}
						onSelectEffort={vi.fn()}
						onChangePermissionMode={vi.fn()}
						onChangeFastMode={vi.fn()}
						onSubmit={vi.fn()}
					/>
				</QueryClientProvider>
			</SettingsContext.Provider>,
		);

		expect(screen.getByTestId("workspace-composer-mock")).toHaveAttribute(
			"data-fast-mode",
			"on",
		);
	});

	// `composerUnavailable` vs `composerAwaitingFinalize`: the composer
	// container must ONLY dim the whole UI when the workspace is genuinely
	// unusable (archived / no selection). During the Phase 2 initializing
	// window the editor + toolbar stay fully live and only the send action
	// is blocked, so users can type-ahead without a visible 60% dim.
	const renderContainerForState = (workspaceState: string) => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			MODEL_SECTIONS,
		);
		queryClient.setQueryData(helmorQueryKeys.workspaceDetail("workspace-1"), {
			...WORKSPACE_DETAIL,
			state: workspaceState,
		});
		queryClient.setQueryData(
			helmorQueryKeys.workspaceSessions("workspace-1"),
			WORKSPACE_SESSIONS,
		);

		render(
			<QueryClientProvider client={queryClient}>
				<WorkspaceComposerContainer
					displayedWorkspaceId="workspace-1"
					displayedSessionId="session-1"
					disabled={false}
					sending={false}
					sendError={null}
					restoreDraft={null}
					restoreImages={[]}
					restoreFiles={[]}
					restoreNonce={0}
					modelSelections={{}}
					effortLevels={{}}
					permissionModes={{}}
					fastModes={{}}
					onSelectModel={vi.fn()}
					onSelectEffort={vi.fn()}
					onChangePermissionMode={vi.fn()}
					onChangeFastMode={vi.fn()}
					onSubmit={vi.fn()}
				/>
			</QueryClientProvider>,
		);
	};

	it("stays fully enabled while the workspace is initializing, blocking only the send action", () => {
		renderContainerForState("initializing");

		const composer = screen.getByTestId("workspace-composer-mock");
		// Editor + toolbar must NOT be dimmed — the user can type and pick
		// model/effort while Phase 2 finishes.
		expect(composer).toHaveAttribute("data-disabled", "false");
		// Send is gated so messages can't race with finalize.
		expect(composer).toHaveAttribute("data-submit-disabled", "true");
	});

	it("fully disables the composer for archived workspaces", () => {
		renderContainerForState("archived");

		const composer = screen.getByTestId("workspace-composer-mock");
		expect(composer).toHaveAttribute("data-disabled", "true");
	});

	it("is fully interactive for ready workspaces", () => {
		renderContainerForState("ready");

		const composer = screen.getByTestId("workspace-composer-mock");
		expect(composer).toHaveAttribute("data-disabled", "false");
		expect(composer).toHaveAttribute("data-submit-disabled", "false");
	});

	it("renders queued follow-ups as an overlay above the composer", () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			MODEL_SECTIONS,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceDetail("workspace-1"),
			WORKSPACE_DETAIL,
		);
		queryClient.setQueryData(
			helmorQueryKeys.workspaceSessions("workspace-1"),
			WORKSPACE_SESSIONS,
		);

		render(
			<TooltipProvider>
				<QueryClientProvider client={queryClient}>
					<WorkspaceComposerContainer
						displayedWorkspaceId="workspace-1"
						displayedSessionId="session-1"
						disabled={false}
						sending={false}
						sendError={null}
						restoreDraft={null}
						restoreImages={[]}
						restoreFiles={[]}
						restoreNonce={0}
						modelSelections={{}}
						effortLevels={{}}
						permissionModes={{}}
						fastModes={{}}
						onSelectModel={vi.fn()}
						onSelectEffort={vi.fn()}
						onChangePermissionMode={vi.fn()}
						onChangeFastMode={vi.fn()}
						onSubmit={vi.fn()}
						queueItems={[
							{
								id: "queued-1",
								context: {
									sessionId: "session-1",
									workspaceId: "workspace-1",
									contextKey: "session:session-1",
								},
								payload: {
									prompt: "Continue",
									imagePaths: [],
									filePaths: [],
									customTags: [],
									model: {
										...MODEL_SECTIONS[0].options[0],
										effortLevels: [
											...MODEL_SECTIONS[0].options[0].effortLevels,
										],
									},
									workingDirectory: "/tmp/helmor",
									effortLevel: "medium",
									permissionMode: "default",
									fastMode: false,
								},
								enqueuedAt: Date.now(),
							},
						]}
						onSteerQueued={vi.fn()}
						onRemoveQueued={vi.fn()}
					/>
				</QueryClientProvider>
			</TooltipProvider>,
		);

		const queueList = screen.getByTestId("submit-queue-list");
		expect(queueList).toHaveClass("pointer-events-auto");
		expect(queueList.parentElement).toHaveClass("absolute");
		expect(queueList.parentElement).toHaveClass("bottom-[calc(100%-1px)]");
	});

	describe("/add-dir integration", () => {
		function renderWithLinkedDirs(
			linked: string[],
			displayedSessionId = "session-1",
		) {
			// Returning the list from the API mock — not setQueryData —
			// so the background refetch (`staleTime: 0`) doesn't overwrite
			// the seeded value with the default setup.ts mock.
			apiMockState.listWorkspaceLinkedDirectories.mockResolvedValue(linked);
			const queryClient = createHelmorQueryClient();
			queryClient.setQueryData(
				helmorQueryKeys.agentModelSections,
				MODEL_SECTIONS,
			);
			queryClient.setQueryData(
				helmorQueryKeys.workspaceDetail("workspace-1"),
				WORKSPACE_DETAIL,
			);
			queryClient.setQueryData(
				helmorQueryKeys.workspaceSessions("workspace-1"),
				WORKSPACE_SESSIONS,
			);
			return render(
				<QueryClientProvider client={queryClient}>
					<WorkspaceComposerContainer
						displayedWorkspaceId="workspace-1"
						displayedSessionId={displayedSessionId}
						disabled={false}
						sending={false}
						sendError={null}
						restoreDraft={null}
						restoreImages={[]}
						restoreFiles={[]}
						restoreNonce={0}
						modelSelections={{}}
						effortLevels={{}}
						permissionModes={{}}
						fastModes={{}}
						onSelectModel={vi.fn()}
						onSelectEffort={vi.fn()}
						onChangePermissionMode={vi.fn()}
						onChangeFastMode={vi.fn()}
						onSubmit={vi.fn()}
					/>
				</QueryClientProvider>,
			);
		}

		it("always prepends /add-dir as the first slash command with client-action source", async () => {
			// Have the agent return some regular commands — /add-dir must land
			// ahead of them.
			apiMockState.listSlashCommands.mockResolvedValue({
				commands: [
					{
						name: "compact",
						description: "Compact the context",
						source: "builtin",
					},
					{
						name: "clear",
						description: "Clear history",
						source: "builtin",
					},
				],
				isComplete: true,
			});

			renderWithLinkedDirs([]);

			// Wait until the agent commands merge in behind /add-dir.
			await waitFor(() => {
				expect(composerMockState.lastSlashCommands.map((c) => c.name)).toEqual([
					"add-dir",
					"compact",
					"clear",
				]);
			});
			expect(composerMockState.lastSlashCommands[0]).toEqual({
				name: "add-dir",
				description: "Link extra directories to this workspace",
				source: "client-action",
			});
		});

		it("adds a built-in /compact command for Codex sessions", async () => {
			apiMockState.listSlashCommands.mockResolvedValue({
				commands: [],
				isComplete: true,
			});

			renderWithLinkedDirs([], "session-2");

			await waitFor(() => {
				expect(composerMockState.lastSlashCommands.map((c) => c.name)).toEqual([
					"add-dir",
					"compact",
				]);
			});
			expect(composerMockState.lastSlashCommands[1]).toEqual({
				name: "compact",
				description: "Compact this Codex thread's context",
				source: "builtin",
				providers: ["codex"],
			});
		});

		it("exposes the workspace's linked directories to the composer so the ContextBar + pill-driven popup stay in sync", async () => {
			renderWithLinkedDirs(["/home/me/alpha", "/home/me/beta"]);
			await waitFor(() => {
				expect(composerMockState.lastLinkedDirectories).toEqual([
					"/home/me/alpha",
					"/home/me/beta",
				]);
			});
			// The composer always receives an onPickAddDir callback — the
			// AddDirTypeaheadPlugin dispatches through it when the user
			// picks a candidate from the inline popup.
			expect(composerMockState.lastOnPickAddDir).not.toBeNull();
		});
	});
});
