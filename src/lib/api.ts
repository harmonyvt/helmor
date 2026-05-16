import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { InspectorFileItem } from "./editor-session";
import { type ErrorCode, extractError } from "./errors";

export type GroupTone =
	| "pinned"
	| "done"
	| "review"
	| "progress"
	| "backlog"
	| "canceled";

/**
 * Mirror of the Rust `WorkspaceState` enum (`src-tauri/src/workspace/state.rs`).
 * Kept as a string literal union so existing `ws.state === "archived"` checks
 * keep working without runtime changes.
 */
export type WorkspaceKind = "code" | "goal";

export type WorkspaceState =
	| "initializing"
	| "setup_pending"
	| "ready"
	| "archived";

/**
 * Mirror of the Rust `WorkspaceStatus` enum
 * (`src-tauri/src/workspace/status.rs`). Drives the sidebar kanban
 * lanes and PR-driven auto-status transitions.
 */
export type WorkspaceStatus =
	| "in-progress"
	| "done"
	| "review"
	| "backlog"
	| "canceled";

/**
 * Mirror of the Rust `PrSyncState` enum
 * (`src-tauri/src/workspace/pr_sync.rs`). Cached on the workspace row so the
 * inspector can render the PR badge optimistically before the live forge
 * query returns.
 */
export type PrSyncState = "none" | "open" | "closed" | "merged";

export type LandingState = "unlanded" | "landed" | "unknown";

export type LandingSource =
	| "pull-request"
	| "branch-ancestry"
	| "manual-repair";

/**
 * Mirror of the Rust `ActionKind` enum
 * (`src-tauri/src/agents/action_kind.rs`). Non-null when the session was
 * created as a one-off "action" dispatch from the inspector commit button.
 */
export type ActionKind =
	| "create-pr"
	| "commit-and-push"
	| "push"
	| "fix"
	| "resolve-conflicts"
	| "merge"
	| "open-pr"
	| "merged"
	| "closed";

export type WorkspaceRow = {
	id: string;
	title: string;
	avatar?: string;
	directoryName?: string;
	workspaceKind?: WorkspaceKind;
	goalWorkspaceId?: string | null;
	repoName?: string;
	repoIconSrc?: string | null;
	repoInitials?: string | null;
	state?: WorkspaceState;
	hasUnread?: boolean;
	workspaceUnread?: number;
	unreadSessionCount?: number;
	status?: WorkspaceStatus;
	branch?: string | null;
	activeSessionId?: string | null;
	activeSessionTitle?: string | null;
	activeSessionAgentType?: string | null;
	activeSessionStatus?: string | null;
	/** "Primary" conversation = the non-hidden, non-action session in this
	 * workspace with the most messages (ties broken by recency). The
	 * meaningful long-running chat — distinct from `activeSession*` which
	 * may be a transient one-off action like create-pr. */
	primarySessionId?: string | null;
	primarySessionTitle?: string | null;
	primarySessionAgentType?: string | null;
	prTitle?: string | null;
	prSyncState?: PrSyncState;
	prUrl?: string | null;
	landingState?: LandingState;
	landingSource?: LandingSource | null;
	landedAt?: string | null;
	landedTargetBranch?: string | null;
	landedSourceRef?: string | null;
	landedCommitSha?: string | null;
	lastKnownHeadSha?: string | null;
	intendedTargetBranch?: string | null;
	pinnedAt?: string | null;
	sessionCount?: number;
	messageCount?: number;
	/** ISO-8601 timestamp — present for rows coming from the backend; absent
	 * for ad-hoc optimistic rows that haven't been given one. */
	createdAt?: string;
	/** ISO-8601 timestamp — last DB-recorded change to the workspace. */
	updatedAt?: string;
	/** ISO-8601 timestamp — most recent user message across all sessions
	 * in this workspace. Null when the workspace has no user messages yet. */
	lastUserMessageAt?: string | null;
};

export type WorkspaceGroup = {
	id: string;
	label: string;
	tone: GroupTone;
	rows: WorkspaceRow[];
};

export type DataDirPreference = "automatic" | "production" | "development";

export type DataInfo = {
	dataMode: string;
	defaultDataMode: "production" | "development";
	dataDir: string;
	dbPath: string;
	dataDirPreference: DataDirPreference;
	dataDirPreferencePath: string;
	dataDirLockedByEnv: boolean;
};

export type FrontendLogEntry = {
	ts: string;
	level: string;
	message: string;
	args: unknown[];
	url?: string;
};

export type LogExportResult = {
	exportDir: string;
	files: string[];
};

export type WebDaemonStatus = {
	state: "running" | "stopped";
	pid: number | null;
	url: string;
	openUrl: string;
	reachableUrls: string[];
	host: string;
	listenHost: string;
	port: number;
	dataDir: string;
	frontendDir: string;
	frontendExists: boolean;
	identity: string;
	command: string;
	startedAtMs: number | null;
	lastError: string | null;
};

export type WebDaemonStartConfig = {
	host?: string | null;
	port?: number | null;
	frontendDir?: string | null;
};

export type DebugIngestPublicForwardConfig = {
	enabled: boolean;
	ngrokDomain?: string | null;
};

export type DebugIngestStatus = {
	workspaceId: string;
	running: boolean;
	url: string | null;
	ingestUrl: string | null;
	publicUrl: string | null;
	publicIngestUrl: string | null;
	tunnelProvider: "ngrok" | string | null;
	tunnelError: string | null;
	host: string | null;
	port: number | null;
	entryCount: number;
};

export type NgrokAgentStatus = {
	connected: boolean;
	sessionId: string | null;
	activeTunnelCount: number;
	lastError: string | null;
};

export type DebugIngestOverview = {
	ngrokAgent: NgrokAgentStatus;
	instances: DebugIngestStatus[];
};

export type DebugIngestEntry = {
	id: string;
	workspaceId: string;
	receivedAt: string;
	payload: Record<string, unknown>;
};

export type DebugIngestEvent =
	| { type: "entry"; entry: DebugIngestEntry }
	| { type: "cleared" };

export type AgentProvider = "claude" | "codex" | "pi";

export type AgentModelOption = {
	id: string;
	provider: AgentProvider;
	label: string;
	cliModel: string;
	providerKey?: string | null;
	effortLevels?: string[];
	supportsFastMode?: boolean;
	supportsContextUsage?: boolean;
};

export type AgentModelSectionStatus = "ready" | "unavailable" | "error";

export type AgentModelSection = {
	id: string;
	label: string;
	status?: AgentModelSectionStatus;
	options: AgentModelOption[];
};

export type PiModelProviderSummary = {
	key: string;
	label: string;
	modelCount: number;
};

export type PiModelCheckResponse = {
	status: AgentModelSectionStatus;
	providers: PiModelProviderSummary[];
	models: AgentModelOption[];
	error?: string | null;
};

export type AgentSendRequest = {
	provider: AgentProvider;
	modelId: string;
	prompt: string;
	/** Hidden preamble prepended to `prompt` only on the wire to the agent
	 *  (e.g. the user's "general preferences"). Persisted user-prompt
	 *  content keeps `prompt` only — the prefix never enters the DB or
	 *  the chat bubble. */
	promptPrefix?: string | null;
	resumeOnly?: boolean | null;
	sessionId?: string | null;
	helmorSessionId?: string | null;
	workingDirectory?: string | null;
	effortLevel?: string | null;
	permissionMode?: string | null;
	fastMode?: boolean | null;
	userMessageId?: string | null;
	/** Workspace-relative paths from the @-mention picker. */
	files?: string[] | null;
	/** Image attachment paths from the composer (drag-and-drop or
	 *  paste). Travels alongside `prompt` so the sidecar can lift the
	 *  matching `@<path>` substrings out as image attachments without
	 *  re-parsing the text — paths may contain whitespace. */
	images?: string[] | null;
	/**
	 * When set, the Pi agent registers Kanban custom tools so it can
	 * create, move, and update cards. Must be the goal workspace id.
	 */
	kanbanWorkspaceId?: string | null;
	/**
	 * JSON-serialised current `GoalCard[]` snapshot. Written to
	 * `.pi/context/kanban.json` before the agent starts so the
	 * `helmor-kanban` Pi extension can inject board state into the
	 * system prompt.
	 */
	kanbanSnapshot?: string | null;
	/** Goal workspace title — injected into the Pi extension system prompt. */
	goalTitle?: string | null;
	/** Goal workspace description — injected into the Pi extension system prompt. */
	goalDescription?: string | null;
};

export type WorkspaceSummary = {
	id: string;
	title: string;
	directoryName: string;
	workspaceKind?: WorkspaceKind;
	goalWorkspaceId?: string | null;
	repoName: string;
	repoIconSrc?: string | null;
	repoInitials?: string | null;
	state: WorkspaceState;
	hasUnread: boolean;
	workspaceUnread: number;
	unreadSessionCount: number;
	status: WorkspaceStatus;
	branch?: string | null;
	activeSessionId?: string | null;
	activeSessionTitle?: string | null;
	activeSessionAgentType?: string | null;
	activeSessionStatus?: string | null;
	primarySessionId?: string | null;
	primarySessionTitle?: string | null;
	primarySessionAgentType?: string | null;
	prTitle?: string | null;
	prSyncState?: PrSyncState;
	prUrl?: string | null;
	pinnedAt?: string | null;
	sessionCount?: number;
	messageCount?: number;
	createdAt: string;
	updatedAt?: string;
	lastUserMessageAt?: string | null;
};

export type RepositoryCreateOption = {
	id: string;
	name: string;
	remote?: string | null;
	remoteUrl?: string | null;
	defaultBranch?: string | null;
	branchPrefixCustom?: string | null;
	forgeProvider?: ForgeProvider | null;
	repoIconSrc?: string | null;
	repoInitials?: string | null;
};

export type AddRepositoryDefaults = {
	lastCloneDirectory?: string | null;
};

export type GithubCliStatus =
	| {
			status: "ready";
			host: string;
			login: string;
			version: string;
			message: string;
	  }
	| {
			status: "unauthenticated";
			host: string;
			version?: string | null;
			message: string;
	  }
	| { status: "unavailable"; host: string; message: string }
	| {
			status: "error";
			host: string;
			version?: string | null;
			message: string;
	  };

export type GithubCliUser = {
	login: string;
	id: number;
	name?: string | null;
	avatarUrl?: string | null;
	email?: string | null;
};

export type GithubRepositorySummary = {
	id: number;
	name: string;
	fullName: string;
	ownerLogin: string;
	private: boolean;
	defaultBranch?: string | null;
	htmlUrl: string;
	updatedAt?: string | null;
	pushedAt?: string | null;
};

export type GithubPullRequestSummary = {
	number: number;
	title: string;
	body: string;
	url: string;
	state: string;
	isMerged: boolean;
	headBranch: string;
	baseBranch: string;
	additions: number;
	deletions: number;
};

export type ForgeProvider = "github" | "gitlab" | "unknown";

export type ForgeLabels = {
	providerName: string;
	cliName: string;
	changeRequestName: string;
	changeRequestFullName: string;
	connectAction: string;
};

export type ForgeCliStatus =
	| {
			status: "ready";
			provider: ForgeProvider;
			host: string;
			cliName: string;
			login: string;
			version: string;
			message: string;
	  }
	| {
			status: "unauthenticated";
			provider: ForgeProvider;
			host: string;
			cliName: string;
			version?: string | null;
			message: string;
			loginCommand: string;
	  }
	| {
			status: "error";
			provider: ForgeProvider;
			host: string;
			cliName: string;
			version?: string | null;
			message: string;
	  };

export type ForgeDetectionSignal = {
	/** Layer that produced this signal (wellKnownHost, hostPattern, urlPath, repoFile, httpProbe, cliProbe). */
	layer: string;
	/** Short human-readable explanation shown in the UI tooltip. */
	detail: string;
};

export type ForgeDetection = {
	provider: ForgeProvider;
	host?: string | null;
	namespace?: string | null;
	repo?: string | null;
	remoteUrl?: string | null;
	labels: ForgeLabels;
	cli?: ForgeCliStatus | null;
	/**
	 * Signals that caused the current provider classification. Empty when
	 * the provider is `unknown` or when the result came from the cached
	 * `forge_provider` column (stored at repo-creation time).
	 */
	detectionSignals: ForgeDetectionSignal[];
};

export type AddRepositoryResponse = {
	repositoryId: string;
	createdRepository: boolean;
	selectedWorkspaceId: string;
	createdWorkspaceId?: string | null;
	createdWorkspaceState: WorkspaceState;
};

export type WorkspaceDetail = {
	id: string;
	title: string;
	repoId: string;
	repoName: string;
	repoIconSrc?: string | null;
	repoInitials?: string | null;
	remote?: string | null;
	remoteUrl?: string | null;
	defaultBranch?: string | null;
	rootPath?: string | null;
	directoryName: string;
	workspaceKind?: WorkspaceKind;
	goalWorkspaceId?: string | null;
	state: WorkspaceState;
	hasUnread: boolean;
	workspaceUnread: number;
	unreadSessionCount: number;
	status: WorkspaceStatus;
	activeSessionId?: string | null;
	activeSessionTitle?: string | null;
	activeSessionAgentType?: string | null;
	activeSessionStatus?: string | null;
	branch?: string | null;
	initializationParentBranch?: string | null;
	intendedTargetBranch?: string | null;
	pinnedAt?: string | null;
	prTitle?: string | null;
	prSyncState?: PrSyncState;
	prUrl?: string | null;
	landingState?: LandingState;
	landingSource?: LandingSource | null;
	landedAt?: string | null;
	landedTargetBranch?: string | null;
	landedSourceRef?: string | null;
	landedCommitSha?: string | null;
	lastKnownHeadSha?: string | null;
	archiveCommit?: string | null;
	sessionCount: number;
	messageCount: number;
	/** User-editable title for goal workspaces. Null if never set. */
	goalTitle?: string | null;
	/** User-editable description for goal workspaces. Null if never set. */
	goalDescription?: string | null;
};

export type WorkspaceSessionSummary = {
	id: string;
	workspaceId: string;
	title: string;
	agentType?: string | null;
	status: string;
	model?: string | null;
	permissionMode: string;
	providerSessionId?: string | null;
	effortLevel?: string | null;
	unreadCount: number;
	fastMode: boolean;
	createdAt: string;
	updatedAt: string;
	lastUserMessageAt?: string | null;
	isHidden: boolean;
	/** Set when the session was created as a one-off dispatch from the
	 * inspector commit button (e.g. "create-pr", "commit-and-push"). Drives
	 * post-stream verifiers and auto-close behavior. */
	actionKind?: ActionKind | null;
	threadRole?: string | null;
	threadStatus?: string | null;
	supersedesThreadId?: string | null;
	staleReason?: string | null;
	lastSupervisorMessageId?: string | null;
	lastMilestoneReportId?: string | null;
	surfaceKind?: "chat" | "terminal";
	surfaceMode?: "thread" | "task_monitor" | "terminal" | "agent_terminal";
	controlOwner?: "user" | "agent" | "system";
	inputPolicy?:
		| "writable"
		| "read_only"
		| "request_control"
		| "blocked_for_approval";
	createdBy?: "user" | "goal" | "pi" | "system";
	terminalRuntime?: string | null;
	terminalCwd?: string | null;
	terminalStartedAt?: string | null;
	terminalStoppedAt?: string | null;
	terminalExitCode?: number | null;
	parentSessionId?: string | null;
	parentMessageId?: string | null;
	delegationStatus?: string | null;
	childCount?: number;
	active: boolean;
};

export type RestoreWorkspaceResponse = {
	restoredWorkspaceId: string;
	restoredState: WorkspaceState;
	selectedWorkspaceId: string;
	/** Set when the originally archived branch was already taken at restore
	 * time and the workspace was checked out on a `-vN`-suffixed branch
	 * instead. The frontend uses this to surface an informational toast so
	 * the rename never happens silently. */
	branchRename: { original: string; actual: string } | null;
	restoredFromTargetBranch: string | null;
};

export type ArchiveWorkspaceResponse = {
	archivedWorkspaceId: string;
	archivedState: WorkspaceState;
};

export type PrepareArchiveWorkspaceResponse = {
	workspaceId: string;
};

export type ArchiveExecutionFailedPayload = {
	workspaceId: string;
	code: ErrorCode;
	message: string;
};

export type ArchiveExecutionSucceededPayload = {
	workspaceId: string;
};

export type CreateWorkspaceResponse = {
	createdWorkspaceId: string;
	selectedWorkspaceId: string;
	initialSessionId: string;
	createdState: WorkspaceState;
	directoryName: string;
	branch: string;
};

export type PrepareWorkspaceResponse = {
	workspaceId: string;
	initialSessionId: string;
	repoId: string;
	repoName: string;
	directoryName: string;
	branch: string;
	defaultBranch: string;
	intendedTargetBranch: string;
	status: WorkspaceStatus;
	sourceStartBranch?: string | null;
	prNumber?: number | null;
	prTitle?: string | null;
	prSyncState: PrSyncState;
	prUrl?: string | null;
	state: WorkspaceState;
	repoScripts: RepoScripts;
};

export type FinalizeWorkspaceResponse = {
	workspaceId: string;
	finalState: WorkspaceState;
};

export type PrepareGoalWorkspaceRequest = {
	repoId: string;
	title: string;
	description: string;
	targetBranch?: string | null;
	sourceBranch?: string | null;
};

export type PrepareGoalWorkspaceResponse = {
	workspaceId: string;
	initialSessionId: string;
	repoId: string;
	repoName: string;
	directoryName: string;
	branch: string;
	defaultBranch: string;
	intendedTargetBranch: string;
	sourceStartBranch?: string | null;
	title: string;
	description: string;
	state: WorkspaceState;
	repoScripts: RepoScripts;
};

export type FinalizeGoalWorkspaceResponse = {
	workspaceId: string;
	finalState: WorkspaceState;
	prTitle: string;
	prUrl?: string | null;
	prSyncState: PrSyncState;
};

export type ConvertWorkspaceToGoalResponse = {
	workspaceId: string;
	prTitle: string;
	prUrl?: string | null;
	prSyncState: PrSyncState;
};

export type GoalCard = {
	id: string;
	goalWorkspaceId: string;
	title: string;
	description?: string | null;
	lane: WorkspaceStatus;
	sortOrder: number;
	assignedProvider?: AgentProvider | string | null;
	assignedModelId?: string | null;
	assignedEffortLevel?: string | null;
	childWorkspaceId?: string | null;
	createdAt: string;
	updatedAt: string;
};

export type GoalOrchestratorIssueState =
	| "backlog"
	| "ready"
	| "in-progress"
	| "review"
	| "done"
	| "canceled"
	| "blocked";

export type GoalOrchestratorIssue = {
	id: string;
	tracker: "local" | "linear" | "github" | "jira";
	goalWorkspaceId: string;
	identifier?: string | null;
	title: string;
	description?: string | null;
	state: GoalOrchestratorIssueState;
	labels: string[];
	blockers: string[];
	priority: number;
	childWorkspaceId?: string | null;
	assignedProvider?: string | null;
	assignedModelId?: string | null;
	assignedEffortLevel?: string | null;
	updatedAt?: string | null;
};

export type GoalOrchestratorRunPhase =
	| "claimed"
	| "running"
	| "succeeded"
	| "failed"
	| "released"
	| "skipped";

export type GoalOrchestratorRunAttempt = {
	attemptId: string;
	issueId: string;
	workspaceId?: string | null;
	sessionId?: string | null;
	phase: GoalOrchestratorRunPhase;
	startedAt: string;
	finishedAt?: string | null;
	error?: string | null;
	provider?: string | null;
	model?: string | null;
	pendingSendId?: string | null;
};

export type GoalOrchestratorRuntimeState = {
	goalWorkspaceId: string;
	running: GoalOrchestratorRunAttempt[];
	claimed: string[];
	retries: Array<{
		issueId: string;
		attempts: number;
		nextRetryAt: string;
		lastError?: string | null;
	}>;
	completedIssueIds: string[];
	liveSessions: Array<{
		workspaceId: string;
		sessionId: string;
		status: string;
		pendingSendId?: string | null;
		lastEventAt?: string | null;
	}>;
	tokenSnapshot?: {
		provider: string;
		remainingTokens?: number | null;
		resetAt?: string | null;
	} | null;
	configErrors: string[];
	updatedAt: string;
};

export type GoalOrchestratorStatus = {
	goalWorkspaceId: string;
	workflowLoaded: boolean;
	workflowPath?: string | null;
	trackerType: string;
	pollingEnabled: boolean;
	maxConcurrent: number;
	issueCount: number;
	dispatchableCount: number;
	runningCount: number;
	retryCount: number;
	completedCount: number;
	issues: GoalOrchestratorIssue[];
	runtime: GoalOrchestratorRuntimeState;
	errors: string[];
};

export type GoalOrchestratorTickSummary = {
	goalWorkspaceId: string;
	dispatched: number;
	skipped: number;
	errors: string[];
	status: GoalOrchestratorStatus;
};

export type UpsertGoalCardInput = {
	id?: string | null;
	goalWorkspaceId: string;
	title: string;
	description?: string | null;
	lane?: WorkspaceStatus | null;
	sortOrder?: number | null;
	assignedProvider?: string | null;
	assignedModelId?: string | null;
	assignedEffortLevel?: string | null;
	childWorkspaceId?: string | null;
};

export type GoalChildWorkspaceRequest = {
	goalWorkspaceId: string;
	goalCardId?: string | null;
	title?: string | null;
	description?: string | null;
	lane?: WorkspaceStatus | null;
	targetBranch?: string | null;
	assignedProvider?: string | null;
	assignedModelId?: string | null;
	assignedEffortLevel?: string | null;
};

export type GoalChildWorkspaceCreateRequest = {
	goalWorkspace: string;
	title: string;
	description?: string | null;
	lane?: WorkspaceStatus | null;
	targetBranch?: string | null;
	assignedProvider?: string | null;
	assignedModelId?: string | null;
	assignedEffortLevel?: string | null;
	prompt?: string | null;
	permissionMode?: string | null;
	finalize?: boolean | null;
};

export type GoalChildWorkspaceCreateResult = {
	workspaceId: string;
	directoryName: string;
	directory?: string | null;
	branch: string;
	sessionId: string;
	state: WorkspaceState;
	status: WorkspaceStatus;
	intendedTargetBranch: string;
	promptQueued: boolean;
	agentStarted: boolean;
	pendingSendId?: string | null;
	backgroundSendId?: string | null;
	assigneePrompt?: string | null;
	provider?: string | null;
	model?: string | null;
};

export type AssigneeReportMarker = {
	reportType: "progress" | "blocked" | "completed" | "handoff" | string;
	messageId?: string | null;
	createdAt?: string | null;
	excerpt: string;
	fullText?: string | null;
};

export type SendAssigneeMessageRequest = {
	goalWorkspaceId: string;
	cardId: string;
	message: string;
	priority?: string | null;
	threadId?: string | null;
};

export type SendThreadMessageRequest = {
	goalWorkspaceId: string;
	workspaceId: string;
	threadId: string;
	message: string;
	priority?: string | null;
	modelId?: string | null;
	permissionMode?: string | null;
};

export type ThreadRuntimeStatusRequest = {
	goalWorkspaceId: string;
	workspaceId: string;
	threadId: string;
};

export type SendAssigneeMessageResult = {
	queued: boolean;
	started: boolean;
	executionState?:
		| "queued"
		| "spawned"
		| "session_streaming"
		| "first_assistant_event_seen"
		| "completed"
		| "failed"
		| string;
	sessionId: string;
	workspaceId: string;
	pendingSendId: string;
	message?: string | null;
	supervisorMessageId?: string | null;
};

export type ReadAssigneeThreadRequest = {
	goalWorkspaceId: string;
	cardId: string;
	threadId?: string | null;
	sinceMessageId?: string | null;
};

export type AssigneeThreadResult = {
	cardId: string;
	workspaceId: string;
	sessionId: string;
	messages: ThreadMessageLike[];
	latestReport?: AssigneeReportMarker | null;
};

export type ThreadRuntimeStatus = {
	threadId: string;
	workspaceId: string;
	status: string;
	model?: string | null;
	permissionMode: string;
	pendingSendId?: string | null;
	providerSessionId?: string | null;
	providerSessionPath?: string | null;
	processState: string;
	lastSidecarEventAt?: string | null;
	lastPersistedMessageAt?: string | null;
	persistedMessageCount: number;
	persistenceState: string;
	lastError?: string | null;
	firstEventReceived: boolean;
	terminalEventSeen: boolean;
	stalledSeconds?: number | null;
};

export type AssigneeStatusSummary = {
	cardId: string;
	workspaceId: string;
	sessionId: string;
	activeThreadId: string;
	threadCount: number;
	assigneeName: string;
	sessionStatus: string;
	effectiveStatus: string;
	latestReport?: AssigneeReportMarker | null;
	staleThreads: StaleThreadSummary[];
	recommendedAction: string;
	summary: string;
};

export type StaleThreadSummary = {
	threadId: string;
	reason: string;
	lastMessageAt?: string | null;
};

export type SetCardAssigneeThreadRequest = {
	goalWorkspaceId: string;
	cardId: string;
	threadId: string;
	reason?: string | null;
	supersedesThreadId?: string | null;
};

export type SetCardAssigneeThreadResult = {
	cardId: string;
	workspaceId: string;
	activeThreadId: string;
	supersededThreadId?: string | null;
	reason?: string | null;
};

export type AssigneeSummary = {
	cardId: string;
	workspaceId: string;
	sessionId: string;
	title: string;
	assigneeName: string;
	sessionStatus: string;
	latestReport?: AssigneeReportMarker | null;
};

export type WorkspaceCreationSource =
	| { type: "defaultBranch" }
	| { type: "remoteBranch"; branch: string }
	| { type: "githubPullRequest"; number: number };

export type MarkWorkspaceReadResponse = undefined;

export type EditorFileReadResponse = {
	path: string;
	content: string;
	mtimeMs: number;
};

export type EditorFileWriteResponse = {
	path: string;
	mtimeMs: number;
};

export type EditorFileStatResponse = {
	path: string;
	exists: boolean;
	isFile: boolean;
	mtimeMs: number | null;
	size: number | null;
};

export type EditorFilePrefetchItem = {
	absolutePath: string;
	content: string;
};

export type EditorFilesWithContentResponse = {
	items: InspectorFileItem[];
	prefetched: EditorFilePrefetchItem[];
};

const DEFAULT_WORKSPACE_GROUPS: WorkspaceGroup[] = [
	{ id: "done", label: "Done", tone: "done", rows: [] },
	{ id: "review", label: "In review", tone: "review", rows: [] },
	{ id: "progress", label: "In progress", tone: "progress", rows: [] },
	{ id: "backlog", label: "Backlog", tone: "backlog", rows: [] },
	{ id: "canceled", label: "Canceled", tone: "canceled", rows: [] },
];

export async function loadWorkspaceGroups(): Promise<WorkspaceGroup[]> {
	try {
		return await invoke<WorkspaceGroup[]>("list_workspace_groups");
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load workspace groups."),
		);
	}
}

export async function loadGithubCliStatus(): Promise<GithubCliStatus> {
	try {
		return await invoke<GithubCliStatus>("get_github_cli_status");
	} catch (error) {
		return {
			status: "error",
			host: "github.com",
			message: describeInvokeError(error, "Unable to load GitHub CLI state."),
		};
	}
}

export async function loadGithubCliUser(): Promise<GithubCliUser | null> {
	try {
		return await invoke<GithubCliUser | null>("get_github_cli_user");
	} catch {
		return null;
	}
}

export async function listGithubAccessibleRepositories(): Promise<
	GithubRepositorySummary[]
> {
	try {
		return await invoke<GithubRepositorySummary[]>(
			"list_github_accessible_repositories",
		);
	} catch {
		return [];
	}
}

export async function listGithubPullRequestsForRepo(
	repoId: string,
): Promise<GithubPullRequestSummary[]> {
	try {
		return await invoke<GithubPullRequestSummary[]>(
			"list_github_pull_requests_for_repo",
			{ repoId },
		);
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load GitHub pull requests."),
		);
	}
}

export async function resolveGithubPullRequestForRepo(
	repoId: string,
	input: string,
): Promise<GithubPullRequestSummary> {
	try {
		return await invoke<GithubPullRequestSummary>(
			"resolve_github_pull_request_for_repo",
			{ repoId, input },
		);
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to resolve GitHub pull request."),
		);
	}
}

export async function getWorkspaceForge(
	workspaceId: string,
): Promise<ForgeDetection> {
	try {
		return await invoke<ForgeDetection>("get_workspace_forge", { workspaceId });
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load workspace forge."),
		);
	}
}

export async function getForgeCliStatus(
	provider: ForgeProvider,
	host?: string | null,
): Promise<ForgeCliStatus> {
	try {
		return await invoke<ForgeCliStatus>("get_forge_cli_status", {
			provider,
			host,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load forge CLI state."),
		);
	}
}

export async function openForgeCliAuthTerminal(
	provider: ForgeProvider,
	host?: string | null,
): Promise<void> {
	try {
		return await invoke<void>("open_forge_cli_auth_terminal", {
			provider,
			host,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to open forge CLI auth terminal."),
		);
	}
}

export async function spawnForgeCliAuthTerminal(
	provider: ForgeProvider,
	host: string | null,
	instanceId: string,
	onEvent: (event: ScriptEvent) => void,
): Promise<void> {
	const channel = new Channel<ScriptEvent>();
	channel.onmessage = onEvent;
	await invoke("spawn_forge_cli_auth_terminal", {
		provider,
		host,
		instanceId,
		channel,
	});
}

export async function stopForgeCliAuthTerminal(
	provider: ForgeProvider,
	host: string | null,
	instanceId: string,
): Promise<boolean> {
	return invoke<boolean>("stop_forge_cli_auth_terminal", {
		provider,
		host,
		instanceId,
	});
}

export async function writeForgeCliAuthTerminalStdin(
	provider: ForgeProvider,
	host: string | null,
	instanceId: string,
	data: string,
): Promise<boolean> {
	return invoke<boolean>("write_forge_cli_auth_terminal_stdin", {
		provider,
		host,
		instanceId,
		data,
	});
}

export async function resizeForgeCliAuthTerminal(
	provider: ForgeProvider,
	host: string | null,
	instanceId: string,
	cols: number,
	rows: number,
): Promise<boolean> {
	return invoke<boolean>("resize_forge_cli_auth_terminal", {
		provider,
		host,
		instanceId,
		cols,
		rows,
	});
}

export async function loadDataInfo(): Promise<DataInfo | null> {
	try {
		return await invoke<DataInfo>("get_data_info");
	} catch {
		return null;
	}
}

export async function exportVerboseLogs(
	frontendLogs: FrontendLogEntry[],
): Promise<LogExportResult> {
	return await invoke<LogExportResult>("export_verbose_logs", {
		frontendLogs,
	});
}

export async function setDataDirPreference(
	preference: DataDirPreference,
): Promise<void> {
	await invoke("set_data_dir_preference", { preference });
}

export async function getWebDaemonStatus(): Promise<WebDaemonStatus> {
	return invoke<WebDaemonStatus>("get_web_daemon_status");
}

export async function startWebDaemon(
	config?: WebDaemonStartConfig,
): Promise<WebDaemonStatus> {
	return invoke<WebDaemonStatus>("start_web_daemon", {
		config: config ?? null,
	});
}

export async function stopWebDaemon(): Promise<WebDaemonStatus> {
	return invoke<WebDaemonStatus>("stop_web_daemon");
}

export async function deleteWebDaemon(): Promise<WebDaemonStatus> {
	return invoke<WebDaemonStatus>("delete_web_daemon");
}

export async function cleanupWebDaemon(): Promise<WebDaemonStatus> {
	return invoke<WebDaemonStatus>("cleanup_web_daemon");
}

export async function ensureDebugIngestServer(
	workspaceId: string,
	options: { publicForward?: DebugIngestPublicForwardConfig } = {},
): Promise<DebugIngestStatus> {
	const args: {
		workspaceId: string;
		publicForward?: DebugIngestPublicForwardConfig;
	} = { workspaceId };
	if (options.publicForward !== undefined) {
		args.publicForward = options.publicForward;
	}
	return invoke<DebugIngestStatus>("ensure_debug_ingest_server", args);
}

export async function getDebugIngestOverview(): Promise<DebugIngestOverview> {
	return invoke<DebugIngestOverview>("get_debug_ingest_overview");
}

export async function stopDebugIngestServer(
	workspaceId: string,
): Promise<void> {
	await invoke<void>("stop_debug_ingest_server", { workspaceId });
}

export async function readDebugIngestEntries(
	workspaceId: string,
): Promise<DebugIngestEntry[]> {
	return invoke<DebugIngestEntry[]>("read_debug_ingest_entries", {
		workspaceId,
	});
}

export async function clearDebugIngestEntries(
	workspaceId: string,
): Promise<void> {
	await invoke<void>("clear_debug_ingest_entries", { workspaceId });
}

export async function subscribeDebugIngest(
	workspaceId: string,
	channel: Channel<DebugIngestEvent>,
): Promise<DebugIngestStatus> {
	return invoke<DebugIngestStatus>("subscribe_debug_ingest", {
		workspaceId,
		channel,
	});
}

export async function restartApp(force = false): Promise<void> {
	await invoke("restart_app", { force });
}

export type HelmorAppInstallResult = {
	repoRoot: string;
	installedAppPath: string;
	restartRequired: boolean;
	pullStdout: string;
	pullStderr: string;
	stdout: string;
	stderr: string;
	version: string | null;
	bundleId: string | null;
	size: string | null;
	signingWarning: string | null;
};

export type HelmorAppUpdateStatus = {
	repoRoot: string | null;
	installedAppPath: string;
	updateAvailable: boolean;
	behindCount: number;
	upstream: string | null;
	head: string | null;
	checkedAt: number;
	error: string | null;
};

export type AppInstallStepStatus = "ok" | "warning" | "skipped";
export type AppInstallOutputStream = "stdout" | "stderr";

export type AppInstallEvent =
	| { type: "started"; repoRoot: string; installedAppPath: string }
	| { type: "stepStarted"; stepId: string; label: string }
	| {
			type: "output";
			stepId: string;
			stream: AppInstallOutputStream;
			data: string;
	  }
	| {
			type: "stepFinished";
			stepId: string;
			status: AppInstallStepStatus;
			message: string | null;
	  }
	| { type: "completed"; result: HelmorAppInstallResult }
	| { type: "error"; stepId: string | null; message: string };

export async function runHelmorAppInstall(
	onEvent: (event: AppInstallEvent) => void,
): Promise<HelmorAppInstallResult> {
	const channel = new Channel<AppInstallEvent>();
	channel.onmessage = onEvent;
	try {
		return await invoke<HelmorAppInstallResult>("run_helmor_app_install", {
			channel,
		});
	} catch (error) {
		throw new Error(describeInvokeError(error, "Unable to install Helmor."));
	}
}

export async function getHelmorAppUpdateStatus(): Promise<HelmorAppUpdateStatus> {
	try {
		return await invoke<HelmorAppUpdateStatus>("get_helmor_app_update_status");
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to check for Helmor updates."),
		);
	}
}

export async function cancelHelmorAppInstall(): Promise<boolean> {
	try {
		return await invoke<boolean>("cancel_helmor_app_install");
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to cancel Helmor update."),
		);
	}
}

export type CliStatus = {
	installed: boolean;
	installPath: string | null;
	buildMode: string;
	installState: "missing" | "managed" | "stale";
};

export async function getCliStatus(): Promise<CliStatus> {
	return await invoke<CliStatus>("get_cli_status");
}

export type HelmorSkillsStatus = {
	installed: boolean;
	claude: boolean;
	codex: boolean;
	command: string;
};

export async function getHelmorSkillsStatus(): Promise<HelmorSkillsStatus> {
	try {
		return await invoke<HelmorSkillsStatus>("get_helmor_skills_status");
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load Helmor skills status."),
		);
	}
}

export async function syncGlobalHotkey(hotkey: string | null): Promise<void> {
	try {
		await invoke<void>("sync_global_hotkey", { hotkey });
	} catch (error) {
		throw new Error(describeInvokeError(error, "Unable to set global hotkey."));
	}
}

export async function installCli(): Promise<CliStatus> {
	return await invoke<CliStatus>("install_cli");
}

export async function installHelmorSkills(): Promise<HelmorSkillsStatus> {
	try {
		return await invoke<HelmorSkillsStatus>("install_helmor_skills");
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to install Helmor skills."),
		);
	}
}

export async function enterOnboardingWindowMode(): Promise<void> {
	await invoke("enter_onboarding_window_mode");
}

export async function exitOnboardingWindowMode(): Promise<void> {
	await invoke("exit_onboarding_window_mode");
}

export type AgentLoginProvider = "claude" | "codex" | "pi";

export type AgentLoginStatusResult = {
	claude: boolean;
	codex: boolean;
	pi: boolean;
	codexProvider?: string | null;
	codexAuthMethod?: "login" | "apiKey" | string | null;
};

export async function getAgentLoginStatus(): Promise<AgentLoginStatusResult> {
	return await invoke<AgentLoginStatusResult>("get_agent_login_status");
}

export async function openAgentLoginTerminal(
	provider: AgentLoginProvider,
): Promise<void> {
	await invoke("open_agent_login_terminal", { provider });
}

export async function spawnAgentLoginTerminal(
	provider: AgentLoginProvider,
	instanceId: string,
	onEvent: (event: ScriptEvent) => void,
): Promise<void> {
	const channel = new Channel<ScriptEvent>();
	channel.onmessage = onEvent;
	await invoke("spawn_agent_login_terminal", {
		provider,
		instanceId,
		channel,
	});
}

export async function stopAgentLoginTerminal(
	provider: AgentLoginProvider,
	instanceId: string,
): Promise<boolean> {
	return invoke<boolean>("stop_agent_login_terminal", {
		provider,
		instanceId,
	});
}

export async function writeAgentLoginTerminalStdin(
	provider: AgentLoginProvider,
	instanceId: string,
	data: string,
): Promise<boolean> {
	return invoke<boolean>("write_agent_login_terminal_stdin", {
		provider,
		instanceId,
		data,
	});
}

export async function resizeAgentLoginTerminal(
	provider: AgentLoginProvider,
	instanceId: string,
	cols: number,
	rows: number,
): Promise<boolean> {
	return invoke<boolean>("resize_agent_login_terminal", {
		provider,
		instanceId,
		cols,
		rows,
	});
}

export type DevResetResult = {
	reposDeleted: number;
	workspacesDeleted: number;
	sessionsDeleted: number;
	messagesDeleted: number;
	directoriesRemoved: string[];
};

export async function requestQuit(force: boolean): Promise<void> {
	return await invoke("request_quit", { force });
}

export async function devResetAllData(): Promise<DevResetResult> {
	return await invoke<DevResetResult>("dev_reset_all_data");
}

export async function loadArchivedWorkspaces(): Promise<WorkspaceSummary[]> {
	try {
		return await invoke<WorkspaceSummary[]>("list_archived_workspaces");
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load archived workspaces."),
		);
	}
}

export async function listRepositories(): Promise<RepositoryCreateOption[]> {
	try {
		return await invoke<RepositoryCreateOption[]>("list_repositories");
	} catch (error) {
		throw new Error(describeInvokeError(error, "Unable to load repositories."));
	}
}

export async function deleteRepository(repoId: string): Promise<void> {
	await invoke<void>("delete_repository", { repoId });
}

export type UpdateRepositoryRemoteResponse = {
	orphanedWorkspaceCount: number;
};

export async function updateRepositoryRemote(
	repoId: string,
	remote: string,
): Promise<UpdateRepositoryRemoteResponse> {
	return invoke<UpdateRepositoryRemoteResponse>("update_repository_remote", {
		repoId,
		remote,
	});
}

export async function listRepoRemotes(repoId: string): Promise<string[]> {
	try {
		return await invoke<string[]>("list_repo_remotes", { repoId });
	} catch {
		return [];
	}
}

export async function updateRepositoryDefaultBranch(
	repoId: string,
	defaultBranch: string,
): Promise<void> {
	await invoke<void>("update_repository_default_branch", {
		repoId,
		defaultBranch,
	});
}

export async function updateRepositoryBranchPrefix(
	repoId: string,
	branchPrefixCustom?: string | null,
): Promise<void> {
	await invoke<void>("update_repository_branch_prefix", {
		repoId,
		branchPrefixCustom,
	});
}

export async function loadAddRepositoryDefaults(): Promise<AddRepositoryDefaults> {
	try {
		return await invoke<AddRepositoryDefaults>("get_add_repository_defaults");
	} catch {
		return { lastCloneDirectory: null };
	}
}

export async function loadAgentModelSections(): Promise<AgentModelSection[]> {
	try {
		console.info("[api-debug] invoking list_agent_model_sections");
		const sections = await invoke<AgentModelSection[]>(
			"list_agent_model_sections",
		);
		console.info("[api-debug] list_agent_model_sections resolved", {
			sectionCount: sections.length,
			sections: sections.map((section) => ({
				id: section.id,
				label: section.label,
				status: section.status ?? "ready",
				optionCount: section.options.length,
			})),
		});
		return sections;
	} catch (error) {
		console.warn("[api-debug] list_agent_model_sections failed", error);
		throw new Error(describeInvokeError(error, "Unable to load agent models."));
	}
}

export async function checkPiModels(): Promise<PiModelCheckResponse> {
	try {
		console.info("[api-debug] invoking check_pi_models");
		const result = await invoke<PiModelCheckResponse>("check_pi_models");
		console.info("[api-debug] check_pi_models resolved", {
			status: result.status,
			modelCount: result.models.length,
			providerCount: result.providers.length,
			error: result.error ?? null,
		});
		return result;
	} catch (error) {
		console.warn("[api-debug] check_pi_models failed", error);
		throw new Error(describeInvokeError(error, "Unable to check Pi models."));
	}
}

export type SlashCommandEntry = {
	name: string;
	description: string;
	argumentHint?: string | null;
	providers?: AgentProvider[] | null;
	/**
	 * - `builtin` / `skill`: command is forwarded to the agent SDK as text.
	 * - `client-action`: selecting the entry runs a host-app handler instead
	 *   of inserting `/<name>` into the prompt (e.g. `/add-dir` opens the
	 *   link-directories dialog).
	 */
	source: "builtin" | "extension" | "prompt" | "skill" | "client-action";
	sourceInfo?: Record<string, unknown> | null;
};

export type SlashCommandsResponse = {
	commands: SlashCommandEntry[];
};

/**
 * Fetch the slash commands the composer popup should display for the given
 * provider + workspace.
 *
 * The Rust backend returns local skills instantly from a disk scan and
 * refreshes the backend cache from the sidecar in the background.
 */
export async function listSlashCommands(input: {
	provider: AgentProvider;
	workingDirectory?: string | null;
	repoId?: string | null;
	workspaceId?: string | null;
}): Promise<SlashCommandsResponse> {
	try {
		return await invoke<SlashCommandsResponse>("list_slash_commands", {
			request: {
				provider: input.provider,
				workingDirectory: input.workingDirectory ?? null,
				repoId: input.repoId ?? null,
				workspaceId: input.workspaceId ?? null,
			},
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load slash commands."),
		);
	}
}

/** Fire-and-forget: prewarm the backend slash-command cache for a workspace. */
export async function prewarmSlashCommandsForWorkspace(
	workspaceId: string,
): Promise<void> {
	try {
		await invoke<void>("prewarm_slash_commands_for_workspace", {
			workspaceId,
		});
	} catch {
		// Best-effort; cache will still be populated lazily on first /.
	}
}

export async function loadWorkspaceDetail(
	workspaceId: string,
): Promise<WorkspaceDetail | null> {
	try {
		return await invoke<WorkspaceDetail>("get_workspace", { workspaceId });
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load workspace detail."),
		);
	}
}

/**
 * Update the user-editable goal title and/or description for a goal workspace.
 * The backend broadcasts a `WorkspaceChanged` event so the frontend cache
 * is automatically invalidated.
 */
export async function updateGoalWorkspaceMeta(
	workspaceId: string,
	goalTitle: string | null,
	goalDescription: string | null,
): Promise<void> {
	try {
		await invoke("update_goal_workspace_meta", {
			workspaceId,
			goalTitle,
			goalDescription,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to update goal workspace metadata."),
		);
	}
}

export async function listRemoteBranches(opts: {
	workspaceId?: string;
	repoId?: string;
}): Promise<string[]> {
	try {
		return await invoke<string[]>("list_remote_branches", opts);
	} catch {
		return [];
	}
}

export type UpdateIntendedTargetBranchResponse = {
	/** True if the workspace's local branch was hard-reset to origin/<target>. */
	reset: boolean;
	targetBranch: string;
};

export async function updateIntendedTargetBranch(
	workspaceId: string,
	targetBranch: string,
): Promise<UpdateIntendedTargetBranchResponse> {
	return invoke<UpdateIntendedTargetBranchResponse>(
		"update_intended_target_branch",
		{
			workspaceId,
			targetBranch,
		},
	);
}

// --- Linked directories (/add-dir) ---

/**
 * Read the workspace's `/add-dir` list. Empty array when the user hasn't
 * linked anything yet.
 */
export async function listWorkspaceLinkedDirectories(
	workspaceId: string,
): Promise<string[]> {
	try {
		return await invoke<string[]>("list_workspace_linked_directories", {
			workspaceId,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load linked directories."),
		);
	}
}

/**
 * Persist the workspace's linked directories. The backend trims + dedupes
 * and returns the canonical list that was actually written — callers
 * should prefer the returned list over their local state.
 */
export async function setWorkspaceLinkedDirectories(
	workspaceId: string,
	directories: string[],
): Promise<string[]> {
	try {
		return await invoke<string[]>("set_workspace_linked_directories", {
			workspaceId,
			directories,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to save linked directories."),
		);
	}
}

/** Candidate entry shown in the `/add-dir` popup's quick-pick list. */
export type CandidateDirectory = {
	workspaceId: string;
	/** Human-readable workspace title, matches the sidebar row's label. */
	title: string;
	repoName: string;
	/** URL to the repo's icon (same source the sidebar avatar uses). */
	repoIconSrc: string | null;
	/** 2-char repo initials fallback when no icon is available. */
	repoInitials: string;
	branch: string | null;
	absolutePath: string;
};

/**
 * Every ready workspace (all repos, minus the currently-active one) as
 * suggestions for `/add-dir`. Empty array is valid — the picker still
 * offers Browse... as an escape hatch.
 */
export async function listWorkspaceCandidateDirectories(input: {
	excludeWorkspaceId?: string | null;
}): Promise<CandidateDirectory[]> {
	try {
		return await invoke<CandidateDirectory[]>(
			"list_workspace_candidate_directories",
			{ excludeWorkspaceId: input.excludeWorkspaceId ?? null },
		);
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load workspace suggestions."),
		);
	}
}

// -- Git watcher events --

export type GitBranchChangedPayload = {
	workspaceId: string;
	oldBranch: string | null;
	newBranch: string | null;
};

export type GitRefsChangedPayload = {
	workspaceId: string;
};

export type UiMutationEvent =
	| { type: "workspaceListChanged" }
	| { type: "workspaceChanged"; workspaceId: string }
	| { type: "sessionListChanged"; workspaceId: string }
	| { type: "sessionModeChanged"; workspaceId: string }
	| { type: "sessionMessagesChanged"; workspaceId: string; sessionId: string }
	| {
			type: "sessionStreamEvent";
			workspaceId: string;
			sessionId: string;
			event: AgentStreamEvent;
	  }
	| { type: "contextUsageChanged"; sessionId: string }
	| { type: "workspaceFilesChanged"; workspaceId: string }
	| { type: "workspaceGitStateChanged"; workspaceId: string }
	| { type: "workspaceForgeChanged"; workspaceId: string }
	| { type: "workspaceChangeRequestChanged"; workspaceId: string }
	| { type: "workspaceLandingChanged"; workspaceId: string }
	| { type: "workspaceBrowserTabsChanged"; workspaceId: string }
	| { type: "repositoryListChanged" }
	| { type: "repositoryChanged"; repoId: string }
	| { type: "settingsChanged"; key: string | null }
	| { type: "goalOrchestratorStateChanged"; goalWorkspaceId: string }
	| {
			type: "pendingCliSendQueued";
			pendingSendId: string;
			workspaceId: string;
			sessionId: string;
			prompt: string;
			modelId: string | null;
			permissionMode: string | null;
	  };

export async function listenGitBranchChanged(
	callback: (payload: GitBranchChangedPayload) => void,
): Promise<UnlistenFn> {
	return listen<GitBranchChangedPayload>("git-branch-changed", (event) =>
		callback(event.payload),
	);
}

export async function listenGitRefsChanged(
	callback: (payload: GitRefsChangedPayload) => void,
): Promise<UnlistenFn> {
	return listen<GitRefsChangedPayload>("git-refs-changed", (event) =>
		callback(event.payload),
	);
}

export async function subscribeUiMutations(
	callback: (event: UiMutationEvent) => void,
): Promise<void> {
	const { Channel } = await import("@tauri-apps/api/core");
	const onEvent = new Channel<UiMutationEvent>();
	onEvent.onmessage = callback;
	await invoke("subscribe_ui_mutations", { onEvent });
}

export type PrefetchRemoteRefsResponse = {
	/** True if a fetch was performed; false if the call was rate-limited. */
	fetched: boolean;
};

export async function prefetchRemoteRefs(opts: {
	workspaceId?: string;
	repoId?: string;
}): Promise<PrefetchRemoteRefsResponse> {
	return invoke<PrefetchRemoteRefsResponse>("prefetch_remote_refs", opts);
}

export async function loadWorkspaceSessions(
	workspaceId: string,
): Promise<WorkspaceSessionSummary[]> {
	try {
		return await invoke<WorkspaceSessionSummary[]>("list_workspace_sessions", {
			workspaceId,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load workspace sessions."),
		);
	}
}

/**
 * Lightweight result for the Command+K session search. Contains only the
 * fields needed to render a palette item and navigate to the session.
 */
export type SessionSearchResult = {
	id: string;
	workspaceId: string;
	sessionTitle: string;
	/** Raw directory name (e.g. "feat-auth-flow"). Humanise with
	 * `humanizeBranch` or equivalent before display. */
	workspaceDirectoryName: string;
	workspaceBranch?: string | null;
	workspaceRepoName?: string | null;
};

/** Cross-workspace fuzzy session search used by the Command+K palette. */
export async function searchSessions(
	query: string,
): Promise<SessionSearchResult[]> {
	return invoke<SessionSearchResult[]>("search_sessions", { query });
}

/**
 * Load session messages as pipeline-rendered ThreadMessageLike[].
 * The frontend can render these directly without any conversion.
 */
export async function loadSessionThreadMessages(
	sessionId: string,
): Promise<ThreadMessageLike[]> {
	try {
		return await invoke<ThreadMessageLike[]>("list_session_thread_messages", {
			sessionId,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load session thread messages."),
		);
	}
}

export async function restoreWorkspace(
	workspaceId: string,
	targetBranchOverride?: string,
): Promise<RestoreWorkspaceResponse> {
	return invoke<RestoreWorkspaceResponse>("restore_workspace", {
		workspaceId,
		targetBranchOverride,
	});
}

export type TargetBranchConflict = {
	currentBranch: string;
	suggestedBranch: string;
	remote: string;
};

export type ValidateRestoreResponse = {
	targetBranchConflict?: TargetBranchConflict | null;
};

export async function validateRestoreWorkspace(
	workspaceId: string,
): Promise<ValidateRestoreResponse> {
	return invoke<ValidateRestoreResponse>("validate_restore_workspace", {
		workspaceId,
	});
}

export async function prepareArchiveWorkspace(
	workspaceId: string,
): Promise<PrepareArchiveWorkspaceResponse> {
	return invoke<PrepareArchiveWorkspaceResponse>("prepare_archive_workspace", {
		workspaceId,
	});
}

export async function startArchiveWorkspace(
	workspaceId: string,
): Promise<void> {
	await invoke<void>("start_archive_workspace", { workspaceId });
}

export async function validateArchiveWorkspace(
	workspaceId: string,
): Promise<PrepareArchiveWorkspaceResponse> {
	return invoke<PrepareArchiveWorkspaceResponse>("validate_archive_workspace", {
		workspaceId,
	});
}

export async function listenArchiveExecutionFailed(
	callback: (payload: ArchiveExecutionFailedPayload) => void,
): Promise<UnlistenFn> {
	return listen<ArchiveExecutionFailedPayload>(
		"archive-execution-failed",
		(event) => callback(event.payload),
	);
}

export async function listenArchiveExecutionSucceeded(
	callback: (payload: ArchiveExecutionSucceededPayload) => void,
): Promise<UnlistenFn> {
	return listen<ArchiveExecutionSucceededPayload>(
		"archive-execution-succeeded",
		(event) => callback(event.payload),
	);
}

export type DetectedEditor = {
	id: string;
	name: string;
	path: string;
};

export async function detectInstalledEditors(): Promise<DetectedEditor[]> {
	try {
		return (await invoke<DetectedEditor[]>("detect_installed_editors")) ?? [];
	} catch {
		return [];
	}
}

export async function openWorkspaceInEditor(
	workspaceId: string,
	editor: string,
): Promise<void> {
	await invoke("open_workspace_in_editor", { workspaceId, editor });
}

export async function openWorkspaceInFinder(
	workspaceId: string,
): Promise<void> {
	await invoke("open_workspace_in_finder", { workspaceId });
}

export async function readEditorFile(
	path: string,
): Promise<EditorFileReadResponse> {
	try {
		return await invoke<EditorFileReadResponse>("read_editor_file", { path });
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to open the selected file."),
		);
	}
}

export function triggerWorkspaceFetch(workspaceId: string): void {
	void invoke("trigger_workspace_fetch", { workspaceId });
}

export async function readFileAtRef(
	workspaceRootPath: string,
	filePath: string,
	gitRef: string,
): Promise<string | null> {
	return await invoke<string | null>("read_file_at_ref", {
		workspaceRootPath,
		filePath,
		gitRef,
	});
}

export async function getFileUnifiedDiff(
	workspaceRootPath: string,
	relativePath: string,
	fromRef?: string | null,
	toRef?: string | null,
	cached?: boolean,
): Promise<string | null> {
	return await invoke<string | null>("get_file_unified_diff", {
		workspaceRootPath,
		relativePath,
		fromRef: fromRef ?? null,
		toRef: toRef ?? null,
		cached: cached ?? false,
	});
}

export async function writeEditorFile(
	path: string,
	content: string,
): Promise<EditorFileWriteResponse> {
	try {
		return await invoke<EditorFileWriteResponse>("write_editor_file", {
			path,
			content,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to save the selected file."),
		);
	}
}

export async function statEditorFile(
	path: string,
): Promise<EditorFileStatResponse> {
	try {
		return await invoke<EditorFileStatResponse>("stat_editor_file", { path });
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to inspect the selected file."),
		);
	}
}

export async function listEditorFiles(
	workspaceRootPath: string,
): Promise<InspectorFileItem[]> {
	try {
		return await invoke<InspectorFileItem[]>("list_editor_files", {
			workspaceRootPath,
		});
	} catch (error) {
		throw new Error(describeInvokeError(error, "Unable to list editor files."));
	}
}

/**
 * Full workspace file listing for the @-mention picker. Walks the same skip
 * rules as `listEditorFiles` but without the 24-file cap. The result is
 * cached per workspace root via React Query and fuzzy-filtered in the frontend
 * as the user types.
 */
export async function listWorkspaceFiles(
	workspaceRootPath: string,
): Promise<InspectorFileItem[]> {
	try {
		return await invoke<InspectorFileItem[]>("list_workspace_files", {
			workspaceRootPath,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to list workspace files."),
		);
	}
}

export async function listEditorFilesWithContent(
	workspaceRootPath: string,
): Promise<EditorFilesWithContentResponse> {
	try {
		return await invoke<EditorFilesWithContentResponse>(
			"list_editor_files_with_content",
			{ workspaceRootPath },
		);
	} catch (error) {
		throw new Error(describeInvokeError(error, "Unable to list editor files."));
	}
}

export async function listWorkspaceChangesWithContent(
	workspaceRootPath: string,
): Promise<EditorFilesWithContentResponse> {
	try {
		return await invoke<EditorFilesWithContentResponse>(
			"list_workspace_changes_with_content",
			{ workspaceRootPath },
		);
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to list workspace changes."),
		);
	}
}

export async function discardWorkspaceFile(
	workspaceRootPath: string,
	relativePath: string,
): Promise<void> {
	try {
		await invoke<void>("discard_workspace_file", {
			workspaceRootPath,
			relativePath,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to discard workspace file."),
		);
	}
}

export async function stageWorkspaceFile(
	workspaceRootPath: string,
	relativePath: string,
): Promise<void> {
	try {
		await invoke<void>("stage_workspace_file", {
			workspaceRootPath,
			relativePath,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to stage workspace file."),
		);
	}
}

export async function unstageWorkspaceFile(
	workspaceRootPath: string,
	relativePath: string,
): Promise<void> {
	try {
		await invoke<void>("unstage_workspace_file", {
			workspaceRootPath,
			relativePath,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to unstage workspace file."),
		);
	}
}

export type ChangeRequestInfo = {
	url: string;
	number: number;
	state: "OPEN" | "CLOSED" | "MERGED" | string;
	title: string;
	isMerged: boolean;
};

export type ActionStatusKind = "success" | "pending" | "running" | "failure";
export type ActionProvider = "github" | "gitlab" | "vercel" | "unknown";
export type WorkspaceGitSyncStatus = "upToDate" | "behind" | "unknown";
export type WorkspacePushStatus = "published" | "unpublished" | "unknown";

export type WorkspaceGitActionStatus = {
	uncommittedCount: number;
	conflictCount: number;
	syncTargetBranch?: string | null;
	syncStatus: WorkspaceGitSyncStatus;
	behindTargetCount: number;
	remoteTrackingRef?: string | null;
	aheadOfRemoteCount: number;
	pushStatus?: WorkspacePushStatus;
};

export type SyncWorkspaceTargetOutcome =
	| "updated"
	| "alreadyUpToDate"
	| "conflict"
	| "dirtyWorktree";

export type SyncWorkspaceTargetResponse = {
	outcome: SyncWorkspaceTargetOutcome;
	targetBranch: string;
	conflictedFiles: string[];
};

export type PushWorkspaceToRemoteResponse = {
	targetRef: string;
	headCommit: string;
};

export type ContinueWorkspaceResponse = {
	branch: string;
	targetBranch: string;
	startPoint: string;
};

export type ForgeActionItem = {
	id: string;
	name: string;
	provider: ActionProvider;
	status: ActionStatusKind;
	duration?: string | null;
	url?: string | null;
};

export type ForgeActionStatus = {
	changeRequest: ChangeRequestInfo | null;
	reviewDecision?: string | null;
	mergeable?: string | null;
	deployments: ForgeActionItem[];
	checks: ForgeActionItem[];
	remoteState: "ok" | "noPr" | "unauthenticated" | "unavailable" | "error";
	message?: string | null;
};

/// A single comment from a PR — either the root of an inline review thread
/// or a general issue-style comment on the PR.
export type PrComment = {
	id: string;
	author: string;
	body: string;
	url: string;
	/** File path for inline review thread comments; absent for general comments. */
	filePath?: string | null;
	/** True when the parent review thread has been marked resolved on GitHub. */
	isThreadResolved: boolean;
	createdAt: string;
};

export type PrCommentData = {
	comments: PrComment[];
	prNumber?: number | null;
	prUrl?: string | null;
};

export async function refreshWorkspaceChangeRequest(
	workspaceId: string,
): Promise<ChangeRequestInfo | null> {
	try {
		const result = await invoke<ChangeRequestInfo | null>(
			"refresh_workspace_change_request",
			{ workspaceId },
		);
		return result ?? null;
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to refresh change request."),
		);
	}
}

export async function loadWorkspaceGitActionStatus(
	workspaceId: string,
): Promise<WorkspaceGitActionStatus> {
	try {
		return await invoke<WorkspaceGitActionStatus>(
			"get_workspace_git_action_status",
			{ workspaceId },
		);
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load workspace Git status."),
		);
	}
}

export async function syncWorkspaceWithTargetBranch(
	workspaceId: string,
): Promise<SyncWorkspaceTargetResponse> {
	try {
		return await invoke<SyncWorkspaceTargetResponse>(
			"sync_workspace_with_target_branch",
			{ workspaceId },
		);
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to pull target branch updates."),
		);
	}
}

export async function pushWorkspaceToRemote(
	workspaceId: string,
): Promise<PushWorkspaceToRemoteResponse> {
	try {
		return await invoke<PushWorkspaceToRemoteResponse>(
			"push_workspace_to_remote",
			{ workspaceId },
		);
	} catch (error) {
		throw new Error(describeInvokeError(error, "Unable to push branch."));
	}
}

export async function loadWorkspaceForgeActionStatus(
	workspaceId: string,
): Promise<ForgeActionStatus> {
	try {
		return await invoke<ForgeActionStatus>(
			"get_workspace_forge_action_status",
			{ workspaceId },
		);
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load workspace forge status."),
		);
	}
}

export async function getWorkspaceForgeCheckInsertText(
	workspaceId: string,
	itemId: string,
): Promise<string> {
	try {
		return await invoke<string>("get_workspace_forge_check_insert_text", {
			workspaceId,
			itemId,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load check details."),
		);
	}
}

export async function getWorkspaceForgeDeploymentInsertText(
	workspaceId: string,
	itemId: string,
): Promise<string> {
	try {
		return await invoke<string>("get_workspace_forge_deployment_insert_text", {
			workspaceId,
			itemId,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load deployment details."),
		);
	}
}

export async function getWorkspacePrComments(
	workspaceId: string,
): Promise<PrCommentData> {
	try {
		return await invoke<PrCommentData>("get_workspace_pr_comments", {
			workspaceId,
		});
	} catch (error) {
		throw new Error(describeInvokeError(error, "Unable to load PR comments."));
	}
}

export async function getWorkspacePrCommentInsertText(
	workspaceId: string,
	commentId: string,
): Promise<string> {
	try {
		return await invoke<string>("get_workspace_pr_comment_insert_text", {
			workspaceId,
			commentId,
		});
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load PR comment details."),
		);
	}
}

export async function mergeWorkspaceChangeRequest(
	workspaceId: string,
): Promise<ChangeRequestInfo | null> {
	try {
		return (
			(await invoke<ChangeRequestInfo | null>(
				"merge_workspace_change_request",
				{ workspaceId },
			)) ?? null
		);
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to merge change request."),
		);
	}
}

export async function closeWorkspaceChangeRequest(
	workspaceId: string,
): Promise<ChangeRequestInfo | null> {
	try {
		return (
			(await invoke<ChangeRequestInfo | null>(
				"close_workspace_change_request",
				{ workspaceId },
			)) ?? null
		);
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to close change request."),
		);
	}
}

export async function continueWorkspaceFromTargetBranch(
	workspaceId: string,
): Promise<ContinueWorkspaceResponse> {
	try {
		return await invoke<ContinueWorkspaceResponse>(
			"continue_workspace_from_target_branch",
			{ workspaceId },
		);
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to continue workspace."),
		);
	}
}

// ---------------------------------------------------------------------------
// Pending CLI sends
// ---------------------------------------------------------------------------

export type PendingCliSend = {
	id: string;
	workspaceId: string;
	sessionId: string;
	prompt: string;
	modelId: string | null;
	permissionMode: string | null;
	status: string;
	lastDrainedAt: string | null;
	startedAt: string | null;
	createdAt: string;
};

/**
 * Atomically read and delete all pending CLI sends. Called on window focus
 * so the App can stream prompts that `helmor send` queued while the CLI
 * detected the App was running.
 */
export async function drainPendingCliSends(): Promise<PendingCliSend[]> {
	return invoke<PendingCliSend[]>("drain_pending_cli_sends");
}

export async function ackPendingCliSendStarted(id: string): Promise<void> {
	return invoke<void>("ack_pending_cli_send_started", { id });
}

export async function permanentlyDeleteWorkspace(
	workspaceId: string,
): Promise<void> {
	await invoke("permanently_delete_workspace", { workspaceId });
}

/**
 * List of action kinds the user has opted-in to auto-close. Action sessions
 * whose `actionKind` appears in this list are hidden automatically after
 * their verifier reports success.
 */
export async function loadAutoCloseActionKinds(): Promise<ActionKind[]> {
	try {
		return await invoke<ActionKind[]>("load_auto_close_action_kinds");
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load auto-close settings."),
		);
	}
}

export async function saveAutoCloseActionKinds(
	kinds: ActionKind[],
): Promise<void> {
	try {
		await invoke<void>("save_auto_close_action_kinds", { kinds });
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to save auto-close settings."),
		);
	}
}

/**
 * Action kinds for which the first-time auto-close opt-in toast has already
 * been shown (whether or not the user opted in). Used to suppress repeat
 * prompts — separate from `loadAutoCloseActionKinds` so "dismissed" and
 * "enabled" are distinct states.
 */
export async function loadAutoCloseOptInAsked(): Promise<ActionKind[]> {
	try {
		return await invoke<ActionKind[]>("load_auto_close_opt_in_asked");
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to load auto-close opt-in history."),
		);
	}
}

export async function saveAutoCloseOptInAsked(
	kinds: ActionKind[],
): Promise<void> {
	try {
		await invoke<void>("save_auto_close_opt_in_asked", { kinds });
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to save auto-close opt-in history."),
		);
	}
}

export async function updateSessionSettings(
	sessionId: string,
	settings: {
		model?: string;
		effortLevel?: string;
		permissionMode?: string;
	},
): Promise<void> {
	await invoke("update_session_settings", {
		sessionId,
		model: settings.model ?? null,
		effortLevel: settings.effortLevel ?? null,
		permissionMode: settings.permissionMode ?? null,
	});
}

export async function createWorkspaceFromRepo(
	repoId: string,
): Promise<CreateWorkspaceResponse> {
	return invoke<CreateWorkspaceResponse>("create_workspace_from_repo", {
		repoId,
	});
}

/**
 * Phase 1 of workspace creation. Fast (<20ms): validates the repo,
 * allocates a unique directory, computes the branch name, generates the
 * workspace + session UUIDs, inserts the `initializing` DB row + initial
 * session, and returns all metadata plus repo-level scripts. The
 * frontend paints with this response immediately — no placeholders.
 */
export async function prepareWorkspaceFromRepo(
	repoId: string,
): Promise<PrepareWorkspaceResponse> {
	return invoke<PrepareWorkspaceResponse>("prepare_workspace_from_repo", {
		repoId,
	});
}

export async function prepareWorkspaceFromSource(
	repoId: string,
	source: WorkspaceCreationSource,
): Promise<PrepareWorkspaceResponse> {
	return invoke<PrepareWorkspaceResponse>("prepare_workspace_from_source", {
		repoId,
		source,
	});
}

/**
 * Phase 2 of workspace creation. Slow (~200ms-2s): creates the git
 * worktree, probes `helmor.json`, and flips the
 * workspace row from `initializing` to `ready` / `setup_pending`. On
 * failure, the workspace row is cleaned up automatically.
 */
export async function finalizeWorkspaceFromRepo(
	workspaceId: string,
	options?: {
		startBranch?: string | null;
		fetchStartBranch?: boolean | null;
		/** Move this existing worktree path into the Helmor workspace location instead of creating a new one. */
		migrateFromPath?: string | null;
	},
): Promise<FinalizeWorkspaceResponse> {
	return invoke<FinalizeWorkspaceResponse>("finalize_workspace_from_repo", {
		workspaceId,
		options: options ?? null,
	});
}

export async function completeWorkspaceSetup(
	workspaceId: string,
): Promise<void> {
	return invoke("complete_workspace_setup", { workspaceId });
}

export async function prepareGoalWorkspace(
	request: PrepareGoalWorkspaceRequest,
): Promise<PrepareGoalWorkspaceResponse> {
	return invoke<PrepareGoalWorkspaceResponse>("prepare_goal_workspace", {
		request,
	});
}

export async function finalizeGoalWorkspace(
	workspaceId: string,
	description: string,
	sourceStartBranch?: string | null,
): Promise<FinalizeGoalWorkspaceResponse> {
	return invoke<FinalizeGoalWorkspaceResponse>("finalize_goal_workspace", {
		workspaceId,
		description,
		sourceStartBranch: sourceStartBranch ?? null,
	});
}

export async function convertWorkspaceToGoal(
	workspaceId: string,
): Promise<ConvertWorkspaceToGoalResponse> {
	try {
		return await invoke<ConvertWorkspaceToGoalResponse>(
			"convert_workspace_to_goal",
			{ workspaceId },
		);
	} catch (error) {
		throw new Error(
			describeInvokeError(error, "Unable to convert workspace to Goal."),
		);
	}
}

export async function listGoalCards(workspaceId: string): Promise<GoalCard[]> {
	return invoke<GoalCard[]>("list_goal_cards", { workspaceId });
}

export async function getGoalOrchestratorState(
	goalWorkspaceId: string,
): Promise<GoalOrchestratorStatus> {
	return invoke<GoalOrchestratorStatus>("get_goal_orchestrator_state", {
		goalWorkspaceId,
	});
}

export async function runGoalOrchestratorTick(
	goalWorkspaceId: string,
): Promise<GoalOrchestratorTickSummary> {
	return invoke<GoalOrchestratorTickSummary>("run_goal_orchestrator_tick", {
		goalWorkspaceId,
	});
}

export async function upsertGoalCard(
	input: UpsertGoalCardInput,
): Promise<GoalCard> {
	return invoke<GoalCard>("upsert_goal_card", { input });
}

export async function linkGoalCardWorkspace(
	goalCardId: string,
	workspaceId: string,
): Promise<GoalCard> {
	return invoke<GoalCard>("link_goal_card_workspace", {
		goalCardId,
		workspaceId,
	});
}

export async function createGoalChildWorkspace(
	request: GoalChildWorkspaceRequest,
): Promise<PrepareWorkspaceResponse> {
	return invoke<PrepareWorkspaceResponse>("create_goal_child_workspace", {
		request,
	});
}

export async function createGoalChildWorkspaceAndStart(
	request: GoalChildWorkspaceCreateRequest,
): Promise<GoalChildWorkspaceCreateResult> {
	return invoke<GoalChildWorkspaceCreateResult>(
		"create_goal_child_workspace_and_start",
		{ request },
	);
}

export async function sendAssigneeMessage(
	request: SendAssigneeMessageRequest,
): Promise<SendAssigneeMessageResult> {
	return invoke<SendAssigneeMessageResult>("send_assignee_message", {
		request,
	});
}

export async function sendThreadMessage(
	request: SendThreadMessageRequest,
): Promise<SendAssigneeMessageResult> {
	return invoke<SendAssigneeMessageResult>("send_thread_message", {
		request,
	});
}

export async function setCardAssigneeThread(
	request: SetCardAssigneeThreadRequest,
): Promise<SetCardAssigneeThreadResult> {
	return invoke<SetCardAssigneeThreadResult>("set_card_assignee_thread", {
		request,
	});
}

export async function readAssigneeThread(
	request: ReadAssigneeThreadRequest,
): Promise<AssigneeThreadResult> {
	return invoke<AssigneeThreadResult>("read_assignee_thread", { request });
}

export async function getThreadRuntimeStatus(
	request: ThreadRuntimeStatusRequest,
): Promise<ThreadRuntimeStatus> {
	return invoke<ThreadRuntimeStatus>("get_thread_runtime_status", { request });
}

export async function summarizeAssigneeStatus(
	goalWorkspaceId: string,
	cardId: string,
): Promise<AssigneeStatusSummary> {
	return invoke<AssigneeStatusSummary>("summarize_assignee_status", {
		request: { goalWorkspaceId, cardId },
	});
}

export async function listAssignees(
	goalWorkspaceId: string,
	status?: string | null,
): Promise<AssigneeSummary[]> {
	return invoke<AssigneeSummary[]>("list_assignees", {
		request: { goalWorkspaceId, status: status ?? null },
	});
}

// ---------------------------------------------------------------------------
// Goals AI panel — Pi Kanban bridge
// ---------------------------------------------------------------------------

/**
 * Send the result of a Pi Kanban custom tool call back to the sidecar.
 * Called after the frontend has executed the corresponding Tauri IPC action
 * in response to a `kanban_tool_call` pipeline event.
 */
export async function sendKanbanToolResult(
	toolCallId: string,
	result: unknown,
	isError = false,
): Promise<void> {
	return invoke("send_kanban_tool_result", {
		toolCallId,
		result: result ?? null,
		isError,
	});
}

/**
 * Respond to a Pi extension interactive UI request (select / confirm / input).
 * Called after the user interacts with the shared conversation UI rendered in
 * response to a `pi_ui_request` event from a Pi extension.
 */
export async function respondToPiUi(
	interactionId: string,
	result: unknown,
): Promise<void> {
	return invoke("respond_to_pi_ui", {
		interactionId,
		result: result ?? null,
	});
}

export async function addRepositoryFromLocalPath(
	folderPath: string,
): Promise<AddRepositoryResponse> {
	return invoke<AddRepositoryResponse>("add_repository_from_local_path", {
		folderPath,
	});
}

export async function cloneRepositoryFromUrl(args: {
	gitUrl: string;
	cloneDirectory: string;
}): Promise<AddRepositoryResponse> {
	return invoke<AddRepositoryResponse>("clone_repository_from_url", args);
}

export async function markSessionRead(
	sessionId: string,
): Promise<MarkWorkspaceReadResponse> {
	return invoke<MarkWorkspaceReadResponse>("mark_session_read", {
		sessionId,
	});
}

export async function markSessionUnread(
	sessionId: string,
): Promise<MarkWorkspaceReadResponse> {
	return invoke<MarkWorkspaceReadResponse>("mark_session_unread", {
		sessionId,
	});
}

export async function markWorkspaceUnread(
	workspaceId: string,
): Promise<MarkWorkspaceReadResponse> {
	return invoke<MarkWorkspaceReadResponse>("mark_workspace_unread", {
		workspaceId,
	});
}

export async function pinWorkspace(workspaceId: string): Promise<void> {
	return invoke<void>("pin_workspace", { workspaceId });
}

export async function unpinWorkspace(workspaceId: string): Promise<void> {
	return invoke<void>("unpin_workspace", { workspaceId });
}

export async function setWorkspaceStatus(
	workspaceId: string,
	status: WorkspaceStatus,
): Promise<void> {
	return invoke<void>("set_workspace_status", { workspaceId, status });
}

export async function setGoalChildWorkspaceStatus(
	goalWorkspaceId: string,
	childWorkspaceId: string,
	status: WorkspaceStatus,
): Promise<void> {
	return invoke<void>("set_goal_child_workspace_status", {
		request: { goalWorkspaceId, childWorkspaceId, status },
	});
}

export type LandingReconcileResponse = {
	workspaceId: string;
	landingState: LandingState;
	landingSource?: LandingSource | null;
	landedAt?: string | null;
	landedTargetBranch?: string | null;
	landedSourceRef?: string | null;
	landedCommitSha?: string | null;
	lastKnownHeadSha?: string | null;
	changed: boolean;
};

export async function reconcileWorkspaceLandingState(
	workspaceId: string,
): Promise<LandingReconcileResponse> {
	return invoke<LandingReconcileResponse>("reconcile_workspace_landing_state", {
		workspaceId,
	});
}

export async function markWorkspaceLanded(
	workspaceId: string,
): Promise<LandingReconcileResponse> {
	return invoke<LandingReconcileResponse>("mark_workspace_landed", {
		workspaceId,
	});
}

export async function assignWorkspaceToGoal(
	workspaceId: string,
	goalWorkspaceId: string,
	status: WorkspaceStatus,
): Promise<void> {
	return invoke<void>("assign_workspace_to_goal", {
		request: { workspaceId, goalWorkspaceId, status },
	});
}

export async function listGoalChildWorkspaces(
	goalWorkspaceId: string,
): Promise<WorkspaceDetail[]> {
	return invoke<WorkspaceDetail[]>("list_goal_child_workspaces", {
		goalWorkspaceId,
	});
}

// ---------------------------------------------------------------------------
// Streaming agent API
// ---------------------------------------------------------------------------

export type AgentStreamStartResponse = {
	streamId: string;
};

export type DelegateAgentRequest = {
	parentSessionId: string;
	task: string;
	provider: AgentProvider;
	modelId?: string | null;
	effortLevel?: string | null;
	permissionMode?: string | null;
	title?: string | null;
	outputSchema: Record<string, unknown>;
	timeoutMs?: number | null;
	parentProvider?: string | null;
};

export type DelegationRecord = {
	id: string;
	parentSessionId: string;
	childSessionId: string;
	parentMessageId: string;
	provider: string;
	modelId?: string | null;
	title: string;
	status: string;
	outputSchema: unknown;
	structuredResult?: unknown;
	error?: string | null;
	createdAt: string;
	startedAt?: string | null;
	completedAt?: string | null;
};

export type DelegateAgentResponse = {
	delegation: DelegationRecord;
	childSessionId: string;
	result: unknown;
};

export async function delegateAgent(
	request: DelegateAgentRequest,
): Promise<DelegateAgentResponse> {
	return invoke<DelegateAgentResponse>("delegate_agent", { request });
}

export async function listSessionDelegations(
	parentSessionId: string,
): Promise<DelegationRecord[]> {
	return invoke<DelegationRecord[]>("list_session_delegations", {
		parentSessionId,
	});
}

// ---------------------------------------------------------------------------
// Pipeline output types — match Rust pipeline::types serde output exactly
// ---------------------------------------------------------------------------

export type StreamingStatus =
	| "pending"
	| "streaming_input"
	| "running"
	| "done"
	| "error";

// Every part carries a stable `id` used as its React key. The Rust side
// mints it at the earliest sighting of the block (accumulator's
// `content_block_start` for Claude, `item.started` for Codex), serializes
// it as `__part_id` in the block JSON, and the adapter reads it back onto
// the typed part. `ToolCallPart` reuses its `toolCallId` (no separate `id`
// field — `tool-call.tsx` already keys on `toolCallId`); every other
// variant has its own `id`.
export type TextPart = { type: "text"; id: string; text: string };
export type ReasoningPart = {
	type: "reasoning";
	id: string;
	text: string;
	/**
	 * Live-streaming state. `true` = actively generating, `false` = just
	 * finished in the current live session (pipeline only sets this during
	 * streaming, never persists it), `undefined` = historical / unknown.
	 */
	streaming?: boolean;
	/** Backend-measured elapsed time for a completed reasoning block. */
	durationMs?: number;
};
export type ToolCallPart = {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	argsText: string;
	result?: unknown;
	isError?: boolean;
	streamingStatus?: StreamingStatus;
	/**
	 * Sub-agent work folded in by the Rust pipeline's grouping pass for
	 * `Task` / `Agent` tool calls. Empty / absent for normal tool calls
	 * (the Rust serializer skips it when empty).
	 */
	children?: ExtendedMessagePart[];
};
export type NoticeSeverity = "info" | "warning" | "error";
export type SystemNoticePart = {
	type: "system-notice";
	id: string;
	severity: NoticeSeverity;
	label: string;
	body?: string;
};
export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoItem = { text: string; status: TodoStatus };
export type TodoListPart = {
	type: "todo-list";
	id: string;
	items: TodoItem[];
};
export type ImageSource =
	| { kind: "base64"; data: string }
	| { kind: "url"; url: string }
	| { kind: "file"; path: string };
export type ImagePart = {
	type: "image";
	id: string;
	source: ImageSource;
	mediaType?: string;
};
export type PromptSuggestionPart = {
	type: "prompt-suggestion";
	id: string;
	text: string;
};
export type FileMentionPart = {
	type: "file-mention";
	id: string;
	path: string;
};
export type PlanReviewAllowedPrompt = {
	tool: string;
	prompt: string;
};
export type PlanReviewPart = {
	type: "plan-review";
	toolUseId: string;
	toolName: string;
	plan?: string | null;
	planFilePath?: string | null;
	allowedPrompts?: PlanReviewAllowedPrompt[];
};
export type DelegationAnchorPart = {
	type: "delegation-anchor";
	id: string;
	delegationId: string;
	parentSessionId: string;
	childSessionId: string;
	title: string;
	provider: string;
	modelId?: string | null;
	status: string;
	outputSchema: unknown;
	structuredResult?: unknown;
	error?: string | null;
	startedAt?: string | null;
	completedAt?: string | null;
};

export type GenericCardPart = {
	type: "generic-card";
	id: string;
	title: string;
	subtitle?: string | null;
	body?: string | null;
	severity?: NoticeSeverity | null;
	status?: string | null;
	provider?: string | null;
	details?: unknown;
};
export type MessagePart =
	| TextPart
	| ReasoningPart
	| ToolCallPart
	| SystemNoticePart
	| TodoListPart
	| ImagePart
	| PromptSuggestionPart
	| FileMentionPart
	| PlanReviewPart
	| GenericCardPart
	| DelegationAnchorPart;

export type CollapsedGroupPart = {
	type: "collapsed-group";
	/** `group:{firstToolId}` — stable across streaming as tools accumulate. */
	id: string;
	category: "search" | "read" | "shell" | "mixed";
	tools: ToolCallPart[];
	active: boolean;
	summary: string;
};

/** Stable React key for any `ExtendedMessagePart`. Hides the fact that
 *  `ToolCallPart` uses `toolCallId` while other variants use `id`. */
export function partKey(part: ExtendedMessagePart): string {
	if (part.type === "tool-call") return part.toolCallId;
	if (part.type === "plan-review") return part.toolUseId;
	return part.id;
}

/**
 * Frontend-only synthetic part injected between the old session's messages
 * and the new session's messages after a provider switch with "Bring history".
 * Never serialized to/from Rust or persisted to the database.
 */
export type ProviderSwitchDividerPart = {
	type: "provider-switch-divider";
	id: string;
	fromProvider: AgentProvider;
	toProvider: AgentProvider;
};

export type ExtendedMessagePart =
	| MessagePart
	| CollapsedGroupPart
	| ProviderSwitchDividerPart;

/**
 * Build the synthetic system message that visually separates the old
 * session's history from the new session's messages after a provider switch.
 */
export function buildProviderSwitchDividerMessage(
	fromProvider: AgentProvider,
	toProvider: AgentProvider,
): ThreadMessageLike {
	return {
		role: "system",
		id: "__provider-switch-divider__",
		content: [
			{
				type: "provider-switch-divider",
				id: "__provider-switch-divider__",
				fromProvider,
				toProvider,
			},
		],
	};
}

/**
 * Mirror of the Rust `MessageRole` enum
 * (`src-tauri/src/pipeline/types.rs`). `"error"` exists in the DB but the
 * adapter rewrites error rows into `"system"` thread messages at render
 * time, so frontend components never observe it in practice.
 */
export type MessageRole = "assistant" | "system" | "user" | "error";

export type ThreadMessageLike = {
	role: MessageRole;
	id?: string;
	createdAt?: string;
	content: ExtendedMessagePart[];
	status?: { type: string; reason?: string };
	streaming?: boolean;
};

export type StreamingTextDelta = {
	messageId: string;
	partId: string;
	partType: "text" | "reasoning";
	textDelta: string;
};

// ---------------------------------------------------------------------------
// Agent stream events
// ---------------------------------------------------------------------------

export type AgentStreamEvent =
	| {
			kind: "update";
			messages: ThreadMessageLike[];
	  }
	| {
			kind: "streamingPartial";
			message: ThreadMessageLike;
	  }
	| {
			kind: "streamingDelta";
			delta: StreamingTextDelta;
	  }
	| {
			kind: "done";
			provider: AgentProvider;
			modelId: string;
			resolvedModel: string;
			sessionId?: string | null;
			workingDirectory: string;
			persisted: boolean;
	  }
	| {
			kind: "aborted";
			provider: AgentProvider;
			modelId: string;
			resolvedModel: string;
			sessionId?: string | null;
			workingDirectory: string;
			persisted: boolean;
			reason: string;
	  }
	| {
			kind: "permissionRequest";
			permissionId: string;
			toolName: string;
			toolInput: Record<string, unknown>;
			title?: string | null;
			description?: string | null;
	  }
	| {
			kind: "deferredToolUse";
			provider: AgentProvider;
			modelId: string;
			resolvedModel: string;
			sessionId?: string | null;
			workingDirectory: string;
			permissionMode?: string | null;
			toolUseId: string;
			toolName: string;
			toolInput: Record<string, unknown>;
	  }
	| {
			kind: "elicitationRequest";
			provider: AgentProvider;
			modelId: string;
			resolvedModel: string;
			sessionId?: string | null;
			workingDirectory: string;
			elicitationId?: string | null;
			serverName: string;
			message: string;
			mode?: string | null;
			url?: string | null;
			requestedSchema?: Record<string, unknown> | null;
	  }
	| { kind: "planCaptured" }
	| {
			kind: "kanbanToolCall";
			toolCallId: string;
			tool: string;
			workspaceId: string;
			args: Record<string, unknown>;
	  }
	| {
			kind: "piUiRequest";
			interactionId: string;
			uiKind: "select" | "confirm" | "input";
			payload: Record<string, unknown>;
	  }
	| { kind: "error"; message: string; persisted: boolean; internal: boolean };

/**
 * Save a pasted clipboard image (base64) to a temp file and return its path.
 */
export async function savePastedImage(
	data: string,
	mediaType: string,
): Promise<string> {
	return invoke<string>("save_pasted_image", { data, mediaType });
}

export async function showImageInFinder(path: string): Promise<void> {
	await invoke("show_image_in_finder", { path });
}

export async function copyImageToClipboard(path: string): Promise<void> {
	await invoke("copy_image_to_clipboard", { path });
}

/**
 * Start an agent message stream.
 *
 * Uses `ipc::Channel<T>` for point-to-point streaming so events emitted by
 * the backend are guaranteed to reach us (no race between `invoke` and a
 * global event listener).
 *
 * The returned promise resolves when the stream has been successfully handed
 * off. The callback continues to fire until a `done` or `error` event arrives.
 */
export async function startAgentMessageStream(
	request: AgentSendRequest,
	callback: (event: AgentStreamEvent) => void,
): Promise<void> {
	const { Channel } = await import("@tauri-apps/api/core");
	const onEvent = new Channel<AgentStreamEvent>();
	onEvent.onmessage = (event) => callback(event);
	await invoke("send_agent_message_stream", { request, onEvent });
}

export async function stopAgentStream(
	sessionId: string,
	provider?: string,
): Promise<void> {
	await invoke("stop_agent_stream", {
		request: { sessionId, provider: provider ?? null },
	});
}

export type AgentSteerRequest = {
	sessionId: string;
	provider?: string;
	prompt: string;
	files?: string[];
	/** Image attachment paths — see `AgentSendRequest.images`. */
	images?: string[];
};

export type AgentSteerResponse = {
	accepted: boolean;
	reason?: string;
};

/**
 * Inject an additional user message into an in-flight agent turn.
 *
 * On `{ accepted: true }` the sidecar has confirmed provider acceptance
 * AND emitted a `user_prompt` passthrough event into the active stream,
 * which the accumulator places at the current streaming position and
 * `persist_turn_message` writes to the DB — no separate persistence path.
 *
 * On `{ accepted: false }` (turn already completed, provider rejected,
 * RPC timeout), the pipeline is untouched. Callers should surface the
 * rejection reason and restore the composer draft so the user can resend
 * — do NOT silently auto-open a fresh `startAgentMessageStream`.
 */
export async function steerAgentStream(
	request: AgentSteerRequest,
): Promise<AgentSteerResponse> {
	return await invoke<AgentSteerResponse>("steer_agent_stream", { request });
}

export async function respondToPermissionRequest(
	permissionId: string,
	behavior: "allow" | "deny",
	options?: {
		updatedPermissions?: unknown[];
		message?: string;
	},
): Promise<void> {
	await invoke("respond_to_permission_request", {
		request: {
			permissionId,
			behavior,
			updatedPermissions: options?.updatedPermissions ?? null,
			message: options?.message ?? null,
		},
	});
}

export async function respondToDeferredTool(
	toolUseId: string,
	behavior: "allow" | "deny",
	options?: {
		reason?: string | null;
		updatedInput?: Record<string, unknown> | null;
	},
): Promise<void> {
	await invoke("respond_to_deferred_tool", {
		request: {
			toolUseId,
			behavior,
			reason: options?.reason ?? null,
			updatedInput: options?.updatedInput ?? null,
		},
	});
}

export async function respondToElicitationRequest(
	elicitationId: string,
	action: "accept" | "decline" | "cancel",
	content?: Record<string, unknown> | null,
): Promise<void> {
	await invoke("respond_to_elicitation_request", {
		request: {
			elicitationId,
			action,
			content: content ?? null,
		},
	});
}

// ---------------------------------------------------------------------------
// Conductor import
// ---------------------------------------------------------------------------

export type ConductorRepo = {
	id: string;
	name: string;
	remoteUrl: string | null;
	workspaceCount: number;
	alreadyImportedCount: number;
};

export type ConductorWorkspace = {
	id: string;
	directoryName: string;
	state: string;
	branch: string | null;
	status: string | null;
	prTitle: string | null;
	sessionCount: number;
	messageCount: number;
	alreadyImported: boolean;
	iconSrc: string | null;
};

export type ImportWorkspacesResult = {
	success: boolean;
	importedCount: number;
	skippedCount: number;
	errors: string[];
};

export async function isConductorAvailable(): Promise<boolean> {
	try {
		return await invoke<boolean>("conductor_source_available");
	} catch {
		return false;
	}
}

export async function listConductorRepos(): Promise<ConductorRepo[]> {
	return invoke<ConductorRepo[]>("list_conductor_repos");
}

export async function listConductorWorkspaces(
	repoId: string,
): Promise<ConductorWorkspace[]> {
	return invoke<ConductorWorkspace[]>("list_conductor_workspaces", { repoId });
}

export async function importConductorWorkspaces(
	workspaceIds: string[],
): Promise<ImportWorkspacesResult> {
	return invoke<ImportWorkspacesResult>("import_conductor_workspaces", {
		workspaceIds,
	});
}

// ---------------------------------------------------------------------------
// Session hide / delete
// ---------------------------------------------------------------------------

export type CreateSessionResponse = {
	sessionId: string;
};

export async function createSession(
	workspaceId: string,
	options?: {
		actionKind?: ActionKind | null;
		permissionMode?: string | null;
		surfaceMode?: "thread" | "terminal" | null;
		runtime?: string | null;
	},
): Promise<CreateSessionResponse> {
	return invoke<CreateSessionResponse>("create_session", {
		workspaceId,
		options: options
			? {
					actionKind: options.actionKind ?? null,
					permissionMode: options.permissionMode ?? null,
					surfaceMode: options.surfaceMode ?? null,
					runtime: options.runtime ?? null,
				}
			: null,
		actionKind: null,
		permissionMode: null,
	});
}

export async function updateSessionControl(
	sessionId: string,
	controlOwner: NonNullable<WorkspaceSessionSummary["controlOwner"]>,
	inputPolicy: NonNullable<WorkspaceSessionSummary["inputPolicy"]>,
): Promise<void> {
	return invoke("update_session_control", {
		sessionId,
		controlOwner,
		inputPolicy,
	});
}

export async function renameSession(
	sessionId: string,
	title: string,
): Promise<void> {
	await invoke("rename_session", { sessionId, title });
}

export async function renameWorkspaceBranch(
	workspaceId: string,
	newBranch: string,
): Promise<void> {
	await invoke("rename_workspace_branch", { workspaceId, newBranch });
}

export type GenerateSessionTitleResponse = {
	title: string | null;
	branchRenamed: boolean;
	skipped: boolean;
};

/**
 * Ask the backend to perform one best-effort naming pass for a session based
 * on the user's message. It may update the session title, workspace branch,
 * both, or neither.
 */
export async function generateSessionTitle(
	sessionId: string,
	userMessage: string,
	titleSeed?: string | null,
): Promise<GenerateSessionTitleResponse | null> {
	try {
		return await invoke<GenerateSessionTitleResponse>(
			"generate_session_title",
			{
				request: { sessionId, userMessage, titleSeed: titleSeed ?? null },
			},
		);
	} catch (error) {
		// Title generation is best-effort — don't propagate errors
		console.warn("[generateSessionTitle] Failed:", error);
		return null;
	}
}

export async function hideSession(sessionId: string): Promise<void> {
	await invoke("hide_session", { sessionId });
}

/** Read the opaque context-usage JSON for one session. Null when nothing
 *  has been recorded yet (e.g. fresh session pre first turn). */
export async function getSessionContextUsage(
	sessionId: string,
): Promise<string | null> {
	return await invoke<string | null>("get_session_context_usage", {
		sessionId,
	});
}

/** Read the account-global Codex rate-limit snapshot. Null until Codex has
 *  emitted at least one `account/rateLimits/updated` notification. */
export async function getCodexRateLimits(): Promise<string | null> {
	return await invoke<string | null>("get_codex_rate_limits");
}

/** Read the account-global Claude rate-limit snapshot. The string is
 *  the raw Anthropic `/api/oauth/usage` response body — parsed on the
 *  frontend via `parseClaudeRateLimits`. Null when no fetch has ever
 *  succeeded (no cache, latest fetch failed). */
export async function getClaudeRateLimits(): Promise<string | null> {
	return await invoke<string | null>("get_claude_rate_limits");
}

/** Live Claude-only context-usage fetch for the hover popover. Pure
 *  passthrough to the sidecar — no DB read. `model` is required because
 *  the sidecar stamps it into the returned rich meta (used for the
 *  model-match check in the ring). Returns slim JSON (never null;
 *  errors throw). */
export async function getLiveContextUsage(params: {
	sessionId: string;
	providerSessionId: string | null;
	model: string;
	cwd: string | null;
}): Promise<string> {
	return await invoke<string>("get_live_context_usage", {
		request: {
			sessionId: params.sessionId,
			providerSessionId: params.providerSessionId,
			model: params.model,
			cwd: params.cwd,
		},
	});
}

export async function unhideSession(sessionId: string): Promise<void> {
	await invoke("unhide_session", { sessionId });
}

export async function deleteSession(sessionId: string): Promise<void> {
	await invoke("delete_session", { sessionId });
}

export async function loadHiddenSessions(
	workspaceId: string,
): Promise<WorkspaceSessionSummary[]> {
	try {
		return await invoke<WorkspaceSessionSummary[]>("list_hidden_sessions", {
			workspaceId,
		});
	} catch {
		return [];
	}
}

// ---- Repository scripts ----

export type RepoScripts = {
	setupScript?: string | null;
	runScript?: string | null;
	archiveScript?: string | null;
	setupFromProject: boolean;
	runFromProject: boolean;
	archiveFromProject: boolean;
	/** Auto-run the setup script on workspace creation. Defaults to true. */
	autoRunSetup: boolean;
};

export type RepoPreferences = {
	createPr?: string | null;
	fixErrors?: string | null;
	resolveConflicts?: string | null;
	branchRename?: string | null;
	general?: string | null;
};

export type ScriptEvent =
	| { type: "started"; pid: number; command: string }
	| { type: "stdout"; data: string }
	| { type: "stderr"; data: string }
	| { type: "exited"; code: number | null }
	| { type: "error"; message: string };

/**
 * Resolve repo scripts using a fixed priority (enforced in Rust):
 *   1. Workspace worktree `helmor.json` (when `workspaceId` is given AND
 *      the worktree exists on disk)
 *   2. Source repo root `helmor.json` (fallback for any missing workspace
 *      / worktree — archived, broken, or caller with no workspace context)
 *   3. DB-level override (Settings UI edit)
 *
 * Pass `workspaceId` when you have a specific workspace context (runtime
 * panel, inspector, script execution, archive hook). Omit for contexts
 * that only care about the repo's defaults (Settings page editing a repo
 * that isn't the current workspace's repo).
 */
export async function loadRepoScripts(
	repoId: string,
	workspaceId?: string | null,
): Promise<RepoScripts> {
	return invoke<RepoScripts>("load_repo_scripts", {
		repoId,
		workspaceId: workspaceId ?? null,
	});
}

export async function updateRepoScripts(
	repoId: string,
	setupScript: string | null,
	runScript: string | null,
	archiveScript: string | null,
): Promise<void> {
	await invoke("update_repo_scripts", {
		repoId,
		setupScript,
		runScript,
		archiveScript,
	});
}

export async function updateRepoAutoRunSetup(
	repoId: string,
	enabled: boolean,
): Promise<void> {
	await invoke("update_repo_auto_run_setup", { repoId, enabled });
}

export async function loadRepoPreferences(
	repoId: string,
): Promise<RepoPreferences> {
	return invoke<RepoPreferences>("load_repo_preferences", {
		repoId,
	});
}

export async function updateRepoPreferences(
	repoId: string,
	preferences: RepoPreferences,
): Promise<void> {
	await invoke("update_repo_preferences", {
		repoId,
		preferences,
	});
}

export async function executeRepoScript(
	repoId: string,
	scriptType: "setup" | "run" | "archive",
	onEvent: (event: ScriptEvent) => void,
	workspaceId?: string | null,
): Promise<void> {
	const channel = new Channel<ScriptEvent>();
	channel.onmessage = onEvent;
	await invoke("execute_repo_script", {
		repoId,
		scriptType,
		workspaceId: workspaceId ?? null,
		channel,
	});
}

export async function stopRepoScript(
	repoId: string,
	scriptType: "setup" | "run" | "archive",
	workspaceId?: string | null,
): Promise<boolean> {
	return invoke<boolean>("stop_repo_script", {
		repoId,
		scriptType,
		workspaceId: workspaceId ?? null,
	});
}

/**
 * Send raw bytes to a running script's PTY master. The kernel's tty line
 * discipline translates `\x03` into SIGINT for the foreground process group,
 * so passing `\x03` here is how Ctrl+C in the terminal tab actually kills
 * the running process.
 *
 * Returns `true` if the script was live and received the bytes, `false` if
 * no live script matches the key (caller can ignore).
 */
export async function writeRepoScriptStdin(
	repoId: string,
	scriptType: "setup" | "run" | "archive",
	workspaceId: string | null,
	data: string,
): Promise<boolean> {
	return invoke<boolean>("write_repo_script_stdin", {
		repoId,
		scriptType,
		workspaceId: workspaceId ?? null,
		data,
	});
}

/**
 * Tell the PTY about a new terminal size. The kernel delivers SIGWINCH to
 * the foreground process group so interactive tools re-layout.
 */
export async function resizeRepoScript(
	repoId: string,
	scriptType: "setup" | "run" | "archive",
	workspaceId: string | null,
	cols: number,
	rows: number,
): Promise<boolean> {
	return invoke<boolean>("resize_repo_script", {
		repoId,
		scriptType,
		workspaceId: workspaceId ?? null,
		cols,
		rows,
	});
}

/**
 * Spawn a blank interactive `$SHELL -i -l` on a fresh PTY in the workspace
 * directory. Each Terminal sub-tab in the Inspector is one of these.
 *
 * `instanceId` distinguishes concurrent terminals within the same workspace;
 * the backend keys its `ScriptProcessManager` on `(repoId, "terminal:<instanceId>",
 * workspaceId)`, so spawning twice with the same `instanceId` would replace
 * the previous shell — callers must mint a fresh UUID per sub-tab.
 *
 * Nothing is persisted: closing the app discards every sub-tab and its
 * output. Cross-tab / cross-workspace survival is in-memory only.
 */
export async function spawnTerminal(
	repoId: string,
	workspaceId: string,
	instanceId: string,
	onEvent: (event: ScriptEvent) => void,
): Promise<void> {
	const channel = new Channel<ScriptEvent>();
	channel.onmessage = onEvent;
	await invoke("spawn_terminal", {
		repoId,
		workspaceId,
		instanceId,
		channel,
	});
}

export async function spawnSessionTerminal(
	repoId: string,
	workspaceId: string,
	sessionId: string,
	runtime: string | null,
	onEvent: (event: ScriptEvent) => void,
): Promise<void> {
	const channel = new Channel<ScriptEvent>();
	channel.onmessage = onEvent;
	await invoke("spawn_session_terminal", {
		repoId,
		workspaceId,
		sessionId,
		runtime,
		channel,
	});
}

export type TerminalProfile = {
	id: string;
	label: string;
	command?: string | null;
	args: string[];
	env: Array<{ key: string; value: string }>;
	tmuxBacked: boolean;
};

export type TmuxSessionStatus = {
	available: boolean;
	sessionName: string;
	exists: boolean;
	attachedClients: number;
	windows: number;
	panes: number;
	currentCommand?: string | null;
	currentPath?: string | null;
	paneTitle?: string | null;
	dead: boolean;
};

export async function listTerminalProfiles(): Promise<TerminalProfile[]> {
	return invoke<TerminalProfile[]>("list_terminal_profiles");
}

export async function getSessionTerminalStatus(
	workspaceId: string,
	sessionId: string,
): Promise<TmuxSessionStatus> {
	return invoke<TmuxSessionStatus>("get_session_terminal_status", {
		workspaceId,
		sessionId,
	});
}

export async function captureSessionTerminal(
	workspaceId: string,
	sessionId: string,
	lines = 80,
): Promise<string> {
	return invoke<string>("capture_session_terminal", {
		workspaceId,
		sessionId,
		lines,
	});
}

export async function stopSessionTerminal(
	repoId: string,
	workspaceId: string,
	sessionId: string,
): Promise<boolean> {
	return invoke<boolean>("stop_session_terminal", {
		repoId,
		workspaceId,
		sessionId,
	});
}

export async function writeSessionTerminalStdin(
	repoId: string,
	workspaceId: string,
	sessionId: string,
	data: string,
): Promise<boolean> {
	return invoke<boolean>("write_session_terminal_stdin", {
		repoId,
		workspaceId,
		sessionId,
		data,
	});
}

export async function resizeSessionTerminal(
	repoId: string,
	workspaceId: string,
	sessionId: string,
	cols: number,
	rows: number,
): Promise<boolean> {
	return invoke<boolean>("resize_session_terminal", {
		repoId,
		workspaceId,
		sessionId,
		cols,
		rows,
	});
}

export async function stopTerminal(
	repoId: string,
	workspaceId: string,
	instanceId: string,
): Promise<boolean> {
	return invoke<boolean>("stop_terminal", {
		repoId,
		workspaceId,
		instanceId,
	});
}

export async function writeTerminalStdin(
	repoId: string,
	workspaceId: string,
	instanceId: string,
	data: string,
): Promise<boolean> {
	return invoke<boolean>("write_terminal_stdin", {
		repoId,
		workspaceId,
		instanceId,
		data,
	});
}

export async function resizeTerminal(
	repoId: string,
	workspaceId: string,
	instanceId: string,
	cols: number,
	rows: number,
): Promise<boolean> {
	return invoke<boolean>("resize_terminal", {
		repoId,
		workspaceId,
		instanceId,
		cols,
		rows,
	});
}

export type BrowserTabRecord = {
	id: string;
	workspaceId: string;
	url: string;
	title: string | null;
	displayOrder: number;
	active: boolean;
	createdAt: string;
	updatedAt: string;
};

export type BrowserRuntimeActionResponse = {
	tabId: string;
	action: string;
	implemented: boolean;
	message: string;
};

export type BrowserProfileOptions = {
	workspaceId: string;
	tabId?: string;
	dataDirectory: string;
	dataStoreIdentifier: number[];
};

export type BrowserWebviewBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export async function listWorkspaceBrowserTabs(
	workspaceId: string,
): Promise<BrowserTabRecord[]> {
	return invoke<BrowserTabRecord[]>("list_workspace_browser_tabs", {
		workspaceId,
	});
}

export async function createBrowserTab(
	workspaceId: string,
	initialUrl?: string | null,
): Promise<BrowserTabRecord> {
	return invoke<BrowserTabRecord>("create_browser_tab", {
		workspaceId,
		initialUrl: initialUrl ?? null,
	});
}

export async function selectBrowserTab(
	tabId: string,
): Promise<BrowserTabRecord> {
	return invoke<BrowserTabRecord>("select_browser_tab", { tabId });
}

export async function navigateBrowserTab(
	tabId: string,
	url: string,
): Promise<BrowserTabRecord> {
	return invoke<BrowserTabRecord>("navigate_browser_tab", { tabId, url });
}

export async function updateBrowserTabTitle(
	tabId: string,
	title: string | null,
): Promise<BrowserTabRecord | null> {
	return invoke<BrowserTabRecord | null>("update_browser_tab_title", {
		tabId,
		title,
	});
}

export async function closeBrowserTab(
	tabId: string,
): Promise<BrowserTabRecord | null> {
	return invoke<BrowserTabRecord | null>("close_browser_tab", { tabId });
}

export async function getWorkspaceBrowserProfile(
	workspaceId: string,
): Promise<BrowserProfileOptions> {
	return invoke<BrowserProfileOptions>("get_workspace_browser_profile", {
		workspaceId,
	});
}

export async function getBrowserTabProfile(
	tabId: string,
): Promise<BrowserProfileOptions> {
	return invoke<BrowserProfileOptions>("get_browser_tab_profile", { tabId });
}

export async function createBrowserWebviewHost(
	label: string,
	url: string,
	bounds: BrowserWebviewBounds,
	profile: BrowserProfileOptions,
	userAgent: string,
): Promise<void> {
	return invoke<void>("create_browser_webview", {
		label,
		url,
		bounds,
		profile,
		userAgent,
	});
}

export async function browserGoBack(tabId: string): Promise<void> {
	return invoke<void>("browser_go_back", { tabId });
}

export async function browserGoForward(tabId: string): Promise<void> {
	return invoke<void>("browser_go_forward", { tabId });
}

export async function openBrowserDevtools(tabId: string): Promise<void> {
	return invoke<void>("open_browser_devtools", { tabId });
}

export async function browserSnapshot(
	tabId: string,
): Promise<BrowserRuntimeActionResponse> {
	return invoke<BrowserRuntimeActionResponse>("browser_snapshot", { tabId });
}

export async function browserScreenshot(
	tabId: string,
): Promise<BrowserRuntimeActionResponse> {
	return invoke<BrowserRuntimeActionResponse>("browser_screenshot", { tabId });
}

export async function browserClick(
	tabId: string,
	x: number,
	y: number,
): Promise<BrowserRuntimeActionResponse> {
	return invoke<BrowserRuntimeActionResponse>("browser_click", { tabId, x, y });
}

export async function browserType(
	tabId: string,
	text: string,
): Promise<BrowserRuntimeActionResponse> {
	return invoke<BrowserRuntimeActionResponse>("browser_type", { tabId, text });
}

export async function browserKey(
	tabId: string,
	key: string,
): Promise<BrowserRuntimeActionResponse> {
	return invoke<BrowserRuntimeActionResponse>("browser_key", { tabId, key });
}

export async function browserScroll(
	tabId: string,
	deltaX: number,
	deltaY: number,
): Promise<BrowserRuntimeActionResponse> {
	return invoke<BrowserRuntimeActionResponse>("browser_scroll", {
		tabId,
		deltaX,
		deltaY,
	});
}

export { DEFAULT_WORKSPACE_GROUPS };

function describeInvokeError(error: unknown, fallback: string): string {
	return extractError(error, fallback).message;
}
