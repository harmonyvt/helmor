import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { focusManager, QueryClient, queryOptions } from "@tanstack/react-query";
import {
	type ActionKind,
	type AgentProvider,
	type BrowserTabRecord,
	type ChangeRequestInfo,
	DEFAULT_WORKSPACE_GROUPS,
	type DetectedEditor,
	detectInstalledEditors,
	type ForgeActionStatus,
	type ForgeCliStatus,
	type ForgeDetection,
	type ForgeProvider,
	getClaudeRateLimits,
	getCodexRateLimits,
	getForgeCliStatus,
	getGoalOrchestratorState,
	getLiveContextUsage,
	getSessionContextUsage,
	getWorkspaceForge,
	getWorkspacePrComments,
	listGoalCards,
	listGoalChildWorkspaces,
	listRepositories,
	listSessionDelegations,
	listSlashCommands,
	listWorkspaceBrowserTabs,
	listWorkspaceCandidateDirectories,
	listWorkspaceChangesWithContent,
	listWorkspaceFiles,
	listWorkspaceLinkedDirectories,
	loadAgentModelSections,
	loadArchivedWorkspaces,
	loadAutoCloseActionKinds,
	loadAutoCloseOptInAsked,
	loadSessionThreadMessages,
	loadWorkspaceDetail,
	loadWorkspaceForgeActionStatus,
	loadWorkspaceGitActionStatus,
	loadWorkspaceGroups,
	loadWorkspaceSessions,
	type PrCommentData,
	type PrSyncState,
	refreshWorkspaceChangeRequest,
} from "./api";
import { postDebugEvidence } from "./debug-evidence";
import { parsePrUrl } from "./pr-url";

const SESSION_STALE_TIME = 10 * 60_000;
const CHANGES_STALE_TIME = 3_000;
const CHANGES_REFETCH_INTERVAL = 10_000;
const WORKSPACE_FORGE_REFETCH_INTERVAL = 60_000;
const DEFAULT_GC_TIME = 30 * 60_000;
const SESSION_GC_TIME = 60 * 60_000;
const PERSIST_GC_TIME = 24 * 60 * 60_000; // 24h — persisted entries live this long
const DEBUG_INGEST_URL =
	"http://127.0.0.1:62813/ingest?token=6b9abcf2-2463-435f-aa0d-febc5272908b";

async function probedQuery<T>(
	name: string,
	details: Record<string, unknown>,
	queryFn: () => Promise<T>,
): Promise<T> {
	const startedAt =
		typeof performance !== "undefined" ? performance.now() : Date.now();
	postDebugEvidence(DEBUG_INGEST_URL, {
		source: "query-client",
		message: `${name} start`,
		details,
	});
	try {
		const result = await queryFn();
		const finishedAt =
			typeof performance !== "undefined" ? performance.now() : Date.now();
		postDebugEvidence(DEBUG_INGEST_URL, {
			source: "query-client",
			message: `${name} success`,
			details: {
				...details,
				durationMs: Math.round(finishedAt - startedAt),
				resultSize: Array.isArray(result) ? result.length : null,
			},
		});
		return result;
	} catch (error) {
		const failedAt =
			typeof performance !== "undefined" ? performance.now() : Date.now();
		postDebugEvidence(DEBUG_INGEST_URL, {
			level: "warn",
			source: "query-client",
			message: `${name} failure`,
			details: {
				...details,
				durationMs: Math.round(failedAt - startedAt),
				error: error instanceof Error ? error.message : String(error),
			},
		});
		throw error;
	}
}

export const helmorQueryKeys = {
	workspaceGroups: ["workspaceGroups"] as const,
	archivedWorkspaces: ["archivedWorkspaces"] as const,
	repositories: ["repositories"] as const,
	agentModelSections: ["agentModelSections"] as const,
	workspaceDetail: (workspaceId: string) =>
		["workspaceDetail", workspaceId] as const,
	goalCards: (workspaceId: string) => ["goalCards", workspaceId] as const,
	goalOrchestratorState: (goalWorkspaceId: string) =>
		["goalOrchestratorState", goalWorkspaceId] as const,
	goalChildWorkspaces: (goalWorkspaceId: string) =>
		["goalChildWorkspaces", goalWorkspaceId] as const,
	goalAssignees: (goalWorkspaceId: string) =>
		["goalAssignees", goalWorkspaceId] as const,
	goalAssigneeRuns: (goalWorkspaceId: string, workspaceId?: string) =>
		workspaceId
			? (["goalAssigneeRuns", goalWorkspaceId, workspaceId] as const)
			: (["goalAssigneeRuns", goalWorkspaceId] as const),
	workspaceSessions: (workspaceId: string) =>
		["workspaceSessions", workspaceId] as const,
	sessionContextUsage: (sessionId: string) =>
		["sessionContextUsage", sessionId] as const,
	codexRateLimits: ["codexRateLimits"] as const,
	claudeRateLimits: ["claudeRateLimits"] as const,
	claudeRichContextUsage: (
		sessionId: string,
		providerSessionId: string | null,
		model: string | null,
	) =>
		[
			"claudeRichContextUsage",
			sessionId,
			providerSessionId ?? "",
			model ?? "",
		] as const,
	sessionMessages: (sessionId: string) =>
		["sessionMessages", sessionId] as const,
	sessionDelegations: (sessionId: string) =>
		["sessionDelegations", sessionId] as const,
	workspaceChanges: (workspaceRootPath: string) =>
		["workspaceChanges", workspaceRootPath] as const,
	workspaceFiles: (workspaceRootPath: string) =>
		["workspaceFiles", workspaceRootPath] as const,
	workspaceChangeRequest: (workspaceId: string) =>
		["workspaceChangeRequest", workspaceId] as const,
	workspaceForge: (workspaceId: string) =>
		["workspaceForge", workspaceId] as const,
	forgeCliStatus: (provider: ForgeProvider, host: string) =>
		["forgeCliStatus", provider, host] as const,
	// Prefix for matching every `forgeCliStatus` cache entry — pass to
	// `invalidateQueries` when an auth signal arrives from elsewhere.
	forgeCliStatusAll: ["forgeCliStatus"] as const,
	workspaceGitActionStatus: (workspaceId: string) =>
		["workspaceGitActionStatus", workspaceId] as const,
	workspaceForgeActionStatus: (workspaceId: string) =>
		["workspaceForgeActionStatus", workspaceId] as const,
	workspacePrComments: (workspaceId: string) =>
		["workspacePrComments", workspaceId] as const,
	repoScripts: (repoId: string, workspaceId: string | null) =>
		["repoScripts", repoId, workspaceId ?? ""] as const,
	repoPreferences: (repoId: string) => ["repoPreferences", repoId] as const,
	autoCloseActionKinds: ["autoCloseActionKinds"] as const,
	autoCloseOptInAsked: ["autoCloseOptInAsked"] as const,
	detectedEditors: ["detectedEditors"] as const,
	debugIngestOverview: ["debugIngestOverview"] as const,
	slashCommands: (
		provider: AgentProvider,
		workingDirectory: string | null,
		workspaceId: string | null,
	) =>
		[
			"slashCommands",
			provider,
			workingDirectory ?? "",
			workspaceId ?? "",
		] as const,
	workspaceLinkedDirectories: (workspaceId: string) =>
		["workspaceLinkedDirectories", workspaceId] as const,
	workspaceCandidateDirectories: (excludeWorkspaceId: string | null) =>
		["workspaceCandidateDirectories", excludeWorkspaceId ?? ""] as const,
	workspaceBrowserTabs: (workspaceId: string) =>
		["workspaceBrowserTabs", workspaceId] as const,
};

export function createHelmorQueryClient() {
	// Replace React Query's default focus listener (browser visibilitychange)
	// with Tauri's native window focus/blur events. This is the official
	// pattern for non-browser environments (cf. React Native AppState in
	// the TanStack Query docs). The focusManager calls `handleFocus(true)`
	// which triggers refetchOnWindowFocus for all queries, respecting each
	// query's own staleTime — local DB queries use staleTime: 0 so they
	// always refetch on focus, while remote GitHub queries keep their
	// staleTime: 30s to avoid hammering the API.
	focusManager.setEventListener((handleFocus) => {
		let unlistenFocus: (() => void) | undefined;
		let unlistenBlur: (() => void) | undefined;

		void import("@tauri-apps/api/event").then(({ listen }) => {
			void listen("tauri://focus", () => handleFocus(true)).then((fn) => {
				unlistenFocus = fn;
			});
			void listen("tauri://blur", () => handleFocus(false)).then((fn) => {
				unlistenBlur = fn;
			});
		});

		return () => {
			unlistenFocus?.();
			unlistenBlur?.();
		};
	});

	return new QueryClient({
		defaultOptions: {
			queries: {
				gcTime: PERSIST_GC_TIME,
				refetchOnReconnect: false,
				refetchOnWindowFocus: true,
				retry: 1,
			},
		},
	});
}

const QUERY_CACHE_STORAGE_KEY = "helmor-query-cache";

export function isStorageQuotaError(error: unknown): boolean {
	return (
		error instanceof DOMException &&
		(error.name === "QuotaExceededError" ||
			error.name === "NS_ERROR_DOM_QUOTA_REACHED")
	);
}

let warnedQueryCacheWriteFailure = false;

export function resetQueryCacheWriteFailureWarningForTests() {
	warnedQueryCacheWriteFailure = false;
}

type PersistCandidateQuery = {
	queryKey: readonly unknown[];
	state: { status: string };
};

export function shouldDehydrateHelmorQuery(query: PersistCandidateQuery) {
	const key = query.queryKey;
	// Never persist session thread messages — they must always be loaded fresh
	// from the DB. Stale streaming snapshots surviving app restart was a root
	// cause of cross-session message contamination.
	if (key[0] === "sessionMessages" && key.length >= 3 && key[2] === "thread") {
		return false;
	}
	if (key[0] === "slashCommands") {
		return false;
	}
	if (key[0] === "agentModelSections") {
		return false;
	}
	// Debug mode state is ephemeral and can refresh while the user is actively
	// debugging; persisting it only increases localStorage pressure.
	if (key[0] === "debugIngestOverview") {
		return false;
	}
	// Workspace lists are fast local DB queries — always load fresh to avoid
	// "ghost workspace" errors on startup.
	if (key[0] === "workspaceGroups" || key[0] === "archivedWorkspaces") {
		return false;
	}
	if (key[0] === "workspaceChanges" || key[0] === "workspaceFiles") {
		return false;
	}
	return query.state.status === "success";
}

const resilientQueryCacheStorage: Storage = {
	get length() {
		return window.localStorage.length;
	},
	clear: () => window.localStorage.clear(),
	getItem: (k) => window.localStorage.getItem(k),
	key: (i) => window.localStorage.key(i),
	removeItem: (k) => window.localStorage.removeItem(k),
	setItem: (k, v) => {
		try {
			window.localStorage.setItem(k, v);
		} catch (error) {
			if (k === QUERY_CACHE_STORAGE_KEY) {
				try {
					window.localStorage.removeItem(k);
				} catch {
					// Ignore cleanup failures: query persistence is a startup optimisation.
				}
			}

			if (!warnedQueryCacheWriteFailure) {
				warnedQueryCacheWriteFailure = true;
				const sizeKb = (v.length / 1024).toFixed(1);
				const reason = isStorageQuotaError(error)
					? "localStorage quota exceeded"
					: "localStorage write failed";
				console.warn(
					`[helmor] Query cache persistence skipped: ${reason} (${sizeKb} KB).`,
				);
			}
		}
	},
};

export const helmorQueryPersister = createAsyncStoragePersister({
	storage: resilientQueryCacheStorage,
	key: QUERY_CACHE_STORAGE_KEY,
});

// On desktop, workspace list changes arrive instantly via UiMutationEvent push.
// On web (no Tauri IPC), threads created by other clients never appear without
// polling. A 5-second interval keeps both surfaces live — fast enough to feel
// collaborative, infrequent enough not to hammer the backend.
const WORKSPACE_LIST_POLL_INTERVAL = 5_000;

export function workspaceGroupsQueryOptions() {
	return queryOptions({
		queryKey: helmorQueryKeys.workspaceGroups,
		queryFn: () => probedQuery("workspaceGroups", {}, loadWorkspaceGroups),
		initialData: DEFAULT_WORKSPACE_GROUPS,
		initialDataUpdatedAt: 0,
		staleTime: 0,
		refetchInterval: WORKSPACE_LIST_POLL_INTERVAL,
	});
}

export function archivedWorkspacesQueryOptions() {
	return queryOptions({
		queryKey: helmorQueryKeys.archivedWorkspaces,
		queryFn: loadArchivedWorkspaces,
		initialData: [],
		initialDataUpdatedAt: 0,
		staleTime: 0,
		refetchInterval: WORKSPACE_LIST_POLL_INTERVAL,
	});
}

export function repositoriesQueryOptions() {
	return queryOptions({
		queryKey: helmorQueryKeys.repositories,
		queryFn: listRepositories,
		initialData: [],
		initialDataUpdatedAt: 0,
		staleTime: 0,
	});
}

export function workspaceBrowserTabsQueryOptions(workspaceId: string) {
	return queryOptions<BrowserTabRecord[]>({
		queryKey: helmorQueryKeys.workspaceBrowserTabs(workspaceId),
		queryFn: () => listWorkspaceBrowserTabs(workspaceId),
		initialData: [],
		initialDataUpdatedAt: 0,
		staleTime: 0,
	});
}

export function agentModelSectionsQueryOptions() {
	return queryOptions({
		queryKey: helmorQueryKeys.agentModelSections,
		queryFn: loadAgentModelSections,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		retry: false,
	});
}

export function workspaceDetailQueryOptions(workspaceId: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.workspaceDetail(workspaceId),
		queryFn: () => loadWorkspaceDetail(workspaceId),
		staleTime: 0,
	});
}

export function goalCardsQueryOptions(workspaceId: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.goalCards(workspaceId),
		queryFn: () => listGoalCards(workspaceId),
		initialData: [],
		staleTime: 0,
	});
}

export function goalChildWorkspacesQueryOptions(goalWorkspaceId: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.goalChildWorkspaces(goalWorkspaceId),
		queryFn: () =>
			probedQuery("goalChildWorkspaces", { goalWorkspaceId }, () =>
				listGoalChildWorkspaces(goalWorkspaceId),
			),
		initialData: [] as import("./api").WorkspaceDetail[],
		staleTime: 0,
	});
}

export function goalOrchestratorStateQueryOptions(goalWorkspaceId: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.goalOrchestratorState(goalWorkspaceId),
		queryFn: () => getGoalOrchestratorState(goalWorkspaceId),
		staleTime: 0,
	});
}

export function workspaceForgeQueryOptions(workspaceId: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.workspaceForge(workspaceId),
		queryFn: () => getWorkspaceForge(workspaceId),
		staleTime: 30_000,
		refetchOnWindowFocus: "always",
		refetchInterval: (query) => workspaceForgeRefetchInterval(query.state.data),
	});
}

export function forgeCliStatusQueryOptions(
	provider: ForgeProvider,
	host: string,
) {
	return queryOptions<ForgeCliStatus>({
		queryKey: helmorQueryKeys.forgeCliStatus(provider, host),
		queryFn: () => getForgeCliStatus(provider, host),
		staleTime: 30_000,
		refetchOnWindowFocus: "always",
		refetchInterval: 60_000,
	});
}

/**
 * Default `staleTime: 0` matches the panel's "always re-validate sessions"
 * expectation. Callers that *peek* at the cache (e.g. sidebar hover card)
 * can pass a small `staleTime` so re-mounts inside the same hover session
 * don't refire the IPC.
 */
export function workspaceSessionsQueryOptions(
	workspaceId: string,
	overrides: { staleTime?: number } = {},
) {
	return queryOptions({
		queryKey: helmorQueryKeys.workspaceSessions(workspaceId),
		queryFn: () => loadWorkspaceSessions(workspaceId),
		staleTime: overrides.staleTime ?? 0,
	});
}

/** Baseline context-usage cache. Event-driven: `contextUsageChanged`
 *  invalidates → observer refetches from DB. Same pattern as rate limits. */
export function sessionContextUsageQueryOptions(sessionId: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.sessionContextUsage(sessionId),
		queryFn: () => getSessionContextUsage(sessionId),
		staleTime: 0,
	});
}

const RATE_LIMITS_STALE_TIME = 2 * 60_000;

// 2 min interval + window-focus refetch + hover refetch. The Rust
// command's 30 s throttle is the hard ceiling — extra triggers just
// hit the cached body, so we can be eager here.
export function codexRateLimitsQueryOptions(enabled: boolean) {
	return queryOptions({
		queryKey: helmorQueryKeys.codexRateLimits,
		queryFn: getCodexRateLimits,
		staleTime: RATE_LIMITS_STALE_TIME,
		refetchInterval: enabled ? RATE_LIMITS_STALE_TIME : false,
		refetchOnWindowFocus: true,
		enabled,
	});
}
export function claudeRateLimitsQueryOptions(enabled: boolean) {
	return queryOptions({
		queryKey: helmorQueryKeys.claudeRateLimits,
		queryFn: getClaudeRateLimits,
		staleTime: RATE_LIMITS_STALE_TIME,
		refetchInterval: enabled ? RATE_LIMITS_STALE_TIME : false,
		refetchOnWindowFocus: true,
		enabled,
	});
}

/** Hover-triggered rich Claude context breakdown. `staleTime: Infinity`
 *  so cached categories survive session hops — SDK context doesn't
 *  mutate between turns, and `contextUsageChanged` invalidates on turn
 *  end to force a refetch the next time hover opens. */
export function claudeRichContextUsageQueryOptions(params: {
	sessionId: string;
	providerSessionId: string | null;
	model: string | null;
	cwd: string | null;
	enabled: boolean;
}) {
	return queryOptions({
		queryKey: helmorQueryKeys.claudeRichContextUsage(
			params.sessionId,
			params.providerSessionId,
			params.model,
		),
		queryFn: () =>
			getLiveContextUsage({
				sessionId: params.sessionId,
				providerSessionId: params.providerSessionId,
				// `enabled` gate ensures model is non-null before queryFn runs.
				model: params.model ?? "",
				cwd: params.cwd,
			}),
		staleTime: Number.POSITIVE_INFINITY,
		enabled: params.enabled,
	});
}

/** `/add-dir` linked directories, workspace-scoped. */
export function workspaceLinkedDirectoriesQueryOptions(workspaceId: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.workspaceLinkedDirectories(workspaceId),
		queryFn: () => listWorkspaceLinkedDirectories(workspaceId),
		staleTime: 0,
	});
}

/**
 * Candidate directories shown as quick-pick suggestions in the /add-dir
 * popup. Staled quickly so newly-created workspaces show up on the next
 * popup open without a manual refresh.
 */
export function workspaceCandidateDirectoriesQueryOptions(
	excludeWorkspaceId: string | null,
) {
	return queryOptions({
		queryKey: helmorQueryKeys.workspaceCandidateDirectories(excludeWorkspaceId),
		queryFn: () => listWorkspaceCandidateDirectories({ excludeWorkspaceId }),
		staleTime: 0,
	});
}

/** Pipeline-rendered thread messages — ready for direct rendering. */
export function sessionThreadMessagesQueryOptions(sessionId: string) {
	return queryOptions({
		queryKey: [...helmorQueryKeys.sessionMessages(sessionId), "thread"],
		queryFn: () => loadSessionThreadMessages(sessionId),
		gcTime: SESSION_GC_TIME,
		staleTime: SESSION_STALE_TIME,
	});
}

export function sessionDelegationsQueryOptions(sessionId: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.sessionDelegations(sessionId),
		queryFn: () =>
			probedQuery("sessionDelegations", { sessionId }, () =>
				listSessionDelegations(sessionId),
			),
		initialData: [] as import("./api").DelegationRecord[],
		initialDataUpdatedAt: 0,
		staleTime: 0,
	});
}

export function slashCommandsQueryOptions(
	provider: AgentProvider,
	workingDirectory: string | null,
	repoId: string | null,
	workspaceId: string | null,
) {
	return queryOptions({
		queryKey: helmorQueryKeys.slashCommands(
			provider,
			workingDirectory,
			workspaceId,
		),
		queryFn: () =>
			probedQuery(
				"slashCommands",
				{ provider, workingDirectory, repoId, workspaceId },
				() =>
					listSlashCommands({
						provider,
						workingDirectory,
						repoId,
						workspaceId,
					}),
			),
		// The backend owns slash-command caching and background refresh. Keep
		// the frontend layer as a thin request shell only.
		staleTime: 0,
		gcTime: 0,
		retry: 0,
		refetchOnWindowFocus: false,
	});
}

export function autoCloseActionKindsQueryOptions() {
	return queryOptions({
		queryKey: helmorQueryKeys.autoCloseActionKinds,
		queryFn: loadAutoCloseActionKinds,
		initialData: [] as ActionKind[],
		initialDataUpdatedAt: 0,
		staleTime: 60_000,
	});
}

export function autoCloseOptInAskedQueryOptions() {
	return queryOptions({
		queryKey: helmorQueryKeys.autoCloseOptInAsked,
		queryFn: loadAutoCloseOptInAsked,
		initialData: [] as ActionKind[],
		initialDataUpdatedAt: 0,
		staleTime: 60_000,
	});
}

/**
 * Installed third-party editors (Cursor, VS Code, JetBrains, terminals, Git GUIs).
 * Detection is cheap but non-trivial — the Rust side stat()'s known app paths and
 * falls back to a single batched `mdfind` for apps in non-standard locations.
 * Cached for 60s so revisiting the dropdown does not re-scan; persisted across
 * app restarts via the localStorage persister so the button shows up instantly
 * on the next launch.
 */
export function detectedEditorsQueryOptions() {
	return queryOptions({
		queryKey: helmorQueryKeys.detectedEditors,
		queryFn: detectInstalledEditors,
		initialData: [] as DetectedEditor[],
		initialDataUpdatedAt: 0,
		staleTime: 60_000,
		gcTime: PERSIST_GC_TIME,
	});
}

export function changeRequestRefetchInterval(
	data: ChangeRequestInfo | null | undefined,
): number {
	if (!data) return 60_000;
	if (data.isMerged || data.state === "MERGED" || data.state === "CLOSED") {
		return 300_000;
	}
	return 60_000;
}

export function forgeActionStatusRefetchInterval(
	data: ForgeActionStatus | undefined,
): number | false {
	if (!data) return 60_000;
	if (data.remoteState !== "ok") return 60_000;
	if (
		data.changeRequest?.isMerged ||
		data.changeRequest?.state === "MERGED" ||
		data.changeRequest?.state === "CLOSED"
	) {
		return false;
	}
	if (data.mergeable === "UNKNOWN") return 5_000;
	const hasRunningWork =
		data.checks.some((c) => c.status === "pending" || c.status === "running") ||
		data.deployments.some(
			(d) => d.status === "pending" || d.status === "running",
		);
	if (hasRunningWork) return 15_000;
	return 60_000;
}

/**
 * Persisted PR snapshot from the workspace row. Used as `placeholderData` so
 * the inspector renders the PR badge optimistically on first visit, before
 * the live forge query returns. Pass whichever of these you have — when the
 * URL is missing or unparseable, no placeholder is produced and the header
 * falls back to its empty state.
 */
export type WorkspaceChangeRequestSeed = {
	prSyncState?: PrSyncState | null;
	prUrl?: string | null;
	prTitle?: string | null;
};

function changeRequestPlaceholder(
	seed: WorkspaceChangeRequestSeed | undefined,
): ChangeRequestInfo | undefined {
	if (!seed) return undefined;
	const syncState = seed.prSyncState ?? "none";
	if (syncState === "none") return undefined;
	const parsed = parsePrUrl(seed.prUrl);
	if (!parsed) return undefined;
	return {
		url: seed.prUrl ?? "",
		number: parsed.number,
		state: syncState.toUpperCase(),
		title: seed.prTitle ?? "",
		isMerged: syncState === "merged",
	};
}

export function workspaceChangeRequestQueryOptions(
	workspaceId: string,
	seed?: WorkspaceChangeRequestSeed,
) {
	const placeholder = changeRequestPlaceholder(seed);
	return queryOptions({
		queryKey: helmorQueryKeys.workspaceChangeRequest(workspaceId),
		queryFn: () => refreshWorkspaceChangeRequest(workspaceId),
		staleTime: 30_000,
		gcTime: DEFAULT_GC_TIME,
		refetchOnWindowFocus: true,
		refetchInterval: (query) => changeRequestRefetchInterval(query.state.data),
		retry: 0,
		// Identity-stable per (workspaceId, seed signature) so React Query
		// doesn't re-evaluate placeholderData on unrelated re-renders.
		placeholderData: placeholder,
	});
}

export function workspaceGitActionStatusQueryOptions(workspaceId: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.workspaceGitActionStatus(workspaceId),
		queryFn: () => loadWorkspaceGitActionStatus(workspaceId),
		staleTime: CHANGES_STALE_TIME,
		gcTime: DEFAULT_GC_TIME,
		refetchOnWindowFocus: true,
		refetchInterval: 10_000,
		retry: 0,
	});
}

export function workspaceForgeActionStatusQueryOptions(workspaceId: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.workspaceForgeActionStatus(workspaceId),
		queryFn: () => loadWorkspaceForgeActionStatus(workspaceId),
		staleTime: 30_000,
		gcTime: DEFAULT_GC_TIME,
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			forgeActionStatusRefetchInterval(query.state.data),
		retry: 0,
	});
}

export function workspacePrCommentsQueryOptions(workspaceId: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.workspacePrComments(workspaceId),
		queryFn: (): Promise<PrCommentData> => getWorkspacePrComments(workspaceId),
		staleTime: 30_000,
		gcTime: DEFAULT_GC_TIME,
		refetchInterval: 60_000,
		refetchOnWindowFocus: true,
		retry: 0,
	});
}

export function workspaceForgeRefetchInterval(
	data: ForgeDetection | undefined,
): number | false {
	if (!data) return WORKSPACE_FORGE_REFETCH_INTERVAL;
	return data.provider === "github" || data.provider === "gitlab"
		? WORKSPACE_FORGE_REFETCH_INTERVAL
		: false;
}

export function workspaceChangesQueryOptions(workspaceRootPath: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.workspaceChanges(workspaceRootPath),
		queryFn: () => listWorkspaceChangesWithContent(workspaceRootPath),
		staleTime: CHANGES_STALE_TIME,
		refetchOnWindowFocus: true,
		refetchInterval: CHANGES_REFETCH_INTERVAL,
	});
}

/**
 * Full workspace file list for the @-mention picker. The popup is hidden
 * until this resolves; on error we fall back to an empty list and the
 * popup never opens (no UI breakage). Cached aggressively because the
 * walk is bounded but not free, and the file set rarely changes within
 * a single composer session.
 */
export function workspaceFilesQueryOptions(workspaceRootPath: string) {
	return queryOptions({
		queryKey: helmorQueryKeys.workspaceFiles(workspaceRootPath),
		queryFn: () => listWorkspaceFiles(workspaceRootPath),
		staleTime: 60_000,
		gcTime: DEFAULT_GC_TIME,
		retry: 0,
	});
}
