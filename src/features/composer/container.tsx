import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDirectoryDialog } from "@tauri-apps/plugin-dialog";
import { CircleAlert, TimerReset } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ActionRow, ActionRowButton } from "@/components/action-row";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ShineBorder } from "@/components/ui/shine-border";
import type { PendingDeferredTool } from "@/features/conversation/pending-deferred-tool";
import type { PendingElicitation } from "@/features/conversation/pending-elicitation";
import { seedNewSessionInCache } from "@/features/panel/session-cache";
import {
	getShortcut,
	getShortcutConflicts,
} from "@/features/shortcuts/registry";
import type {
	AgentModelOption,
	AgentModelSection,
	AgentProvider,
	CandidateDirectory,
	PlanReviewPart,
	SlashCommandEntry,
} from "@/lib/api";
import {
	createSession,
	loadSessionThreadMessages,
	saveAutoCloseActionKinds,
	setWorkspaceLinkedDirectories,
} from "@/lib/api";
import type {
	ComposerCustomTag,
	ResolvedComposerInsertRequest,
} from "@/lib/composer-insert";
import {
	agentModelSectionsQueryOptions,
	autoCloseActionKindsQueryOptions,
	helmorQueryKeys,
	slashCommandsQueryOptions,
	workspaceCandidateDirectoriesQueryOptions,
	workspaceDetailQueryOptions,
	workspaceLinkedDirectoriesQueryOptions,
	workspaceSessionsQueryOptions,
} from "@/lib/query-client";
import { sessionThreadCacheKey } from "@/lib/session-thread-cache";
import { useSettings } from "@/lib/settings";
import type { QueuedSubmit } from "@/lib/use-submit-queue";
import { cn } from "@/lib/utils";
import {
	clampEffortToModel,
	findModelOption,
	getComposerContextKey,
	isNewSession,
	resolveSessionSelectedModelId,
} from "@/lib/workspace-helpers";
import { buildContextTransferPrefix } from "./build-context-transfer";
import type { DeferredToolResponseHandler } from "./deferred-tool";
import type { AddDirPickerEntry } from "./editor/add-dir/typeahead-plugin";
import type { ElicitationResponseHandler } from "./elicitation";
import { WorkspaceComposer } from "./index";
import {
	type ProviderSwapChoice,
	ProviderSwapDialog,
} from "./provider-swap-dialog";
import { storeProviderSwitchParent } from "./provider-switch-parents";
import { SubmitQueueList } from "./submit-queue-list";

const EMPTY_MODEL_SECTIONS: AgentModelSection[] = [];
const EMPTY_SLASH_COMMANDS: SlashCommandEntry[] = [];
const EMPTY_LINKED_DIRECTORIES: readonly string[] = [];
const EMPTY_CANDIDATE_DIRECTORIES: readonly CandidateDirectory[] = [];
const EMPTY_QUEUE_ITEMS: readonly QueuedSubmit[] = [];

/**
 * Host-app slash commands. Prepended to the agent-supplied list so they
 * always appear at the top of the popup.
 */
const ADD_DIR_COMMAND: SlashCommandEntry = {
	name: "add-dir",
	description: "Link extra directories to this workspace",
	source: "client-action",
};

const CODEX_COMPACT_COMMAND: SlashCommandEntry = {
	name: "compact",
	description: "Compact this Codex thread's context",
	source: "builtin",
	providers: ["codex"],
};

const BUILTIN_CLIENT_COMMANDS: readonly SlashCommandEntry[] = [
	ADD_DIR_COMMAND,
	CODEX_COMPACT_COMMAND,
];

function debugNowMs(): number {
	return globalThis.performance?.now?.() ?? Date.now();
}

function summarizeModelSections(
	sections: readonly AgentModelSection[],
): Record<string, number> {
	return Object.fromEntries(
		sections.map((section) => [section.id, section.options.length]),
	);
}

function modelProviderCounts(
	sections: readonly AgentModelSection[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const section of sections) {
		for (const option of section.options) {
			counts[option.provider] = (counts[option.provider] ?? 0) + 1;
		}
	}
	return counts;
}

function logComposerDebug(
	event: string,
	payload?: Record<string, unknown>,
): void {
	console.info(`[composer-debug] ${event}`, payload ?? {});
}

function filterModelSections(
	sections: readonly AgentModelSection[],
	predicate?: (model: AgentModelOption) => boolean,
): AgentModelSection[] {
	if (!predicate) {
		return [...sections];
	}

	return sections
		.map((section) => ({
			...section,
			options: section.options.filter(predicate),
		}))
		.filter((section) => section.options.length > 0);
}

type WorkspaceComposerContainerProps = {
	displayedWorkspaceId: string | null;
	displayedSessionId: string | null;
	disabled: boolean;
	onStop?: () => void;
	sending: boolean;
	sendError: string | null;
	restoreDraft: string | null;
	restoreImages: string[];
	restoreFiles: string[];
	restoreCustomTags?: ComposerCustomTag[];
	restoreNonce: number;
	pendingElicitation?: PendingElicitation | null;
	onElicitationResponse?: ElicitationResponseHandler;
	elicitationResponsePending?: boolean;
	pendingDeferredTool?: PendingDeferredTool | null;
	onDeferredToolResponse?: DeferredToolResponseHandler;
	planReview?: PlanReviewPart | null;
	onImplementPlanInCleanThread?: (
		plan: PlanReviewPart,
		modelId?: string | null,
	) => void | Promise<void>;
	modelSelections: Record<string, string>;
	effortLevels: Record<string, string>;
	permissionModes: Record<string, string>;
	fastModes: Record<string, boolean>;
	debugModes?: Record<string, boolean>;
	activeFastPreludes?: Record<string, boolean>;
	onSelectModel: (contextKey: string, modelId: string) => void;
	onSelectEffort: (contextKey: string, level: string) => void;
	onChangePermissionMode: (contextKey: string, mode: string) => void;
	onChangeFastMode: (contextKey: string, enabled: boolean) => void;
	onChangeDebugMode?: (contextKey: string, enabled: boolean) => void;
	onSwitchSession?: (sessionId: string) => void;
	onSubmit: (payload: {
		prompt: string;
		imagePaths: string[];
		filePaths: string[];
		customTags: ComposerCustomTag[];
		model: AgentModelOption;
		workingDirectory: string | null;
		effortLevel: string;
		permissionMode: string;
		fastMode: boolean;
		debugMode?: boolean;
		/** Force queue (bypass `followUpBehavior`) if a turn is streaming. */
		forceQueue?: boolean;
		/** When set, override the user's `followUpBehavior` setting for this
		 *  one submit (queue ↔ steer). Used by the "send with opposite
		 *  follow-up" composer shortcut. Ignored when `forceQueue` is true. */
		followUpBehaviorOverride?: "queue" | "steer";
		/**
		 * Hidden conversation-history preamble injected on the wire when the
		 * user switched providers mid-thread and chose "Bring history". Rides
		 * as `promptPrefix` so it never appears in the chat bubble or DB.
		 * Consumed once on the first message of the new session and then
		 * cleared.
		 */
		contextTransferPrefix?: string | null;
	}) => void;
	/** Prompt queued by an external caller to auto-submit once the displayed
	 * session matches `sessionId`. */
	pendingPromptForSession?: {
		sessionId: string;
		prompt: string;
		modelId?: string | null;
		permissionMode?: string | null;
		/** Force queue (bypass `followUpBehavior`) if a turn is streaming. */
		forceQueue?: boolean;
		pendingSendId?: string | null;
	} | null;
	/** Called after the pending prompt has been dispatched, so the caller can
	 * clear the queue. */
	onPendingPromptConsumed?: (pendingSendId?: string | null) => void;
	pendingInsertRequests?: ResolvedComposerInsertRequest[];
	onPendingInsertRequestsConsumed?: (ids: string[]) => void;
	/** Follow-up queue rendered above composer when `followUpBehavior === 'queue'`. */
	queueItems?: readonly QueuedSubmit[];
	onSteerQueued?: (itemId: string) => void;
	onRemoveQueued?: (itemId: string) => void;
	modelFilter?: (model: AgentModelOption) => boolean;
	/** When true hides the full toolbar and shows only send/stop. */
	hideToolbar?: boolean;
};

const noopDeferredToolResponse: DeferredToolResponseHandler = () => {};
const noopElicitationResponse: ElicitationResponseHandler = () => {};

export const WorkspaceComposerContainer = memo(
	function WorkspaceComposerContainer({
		displayedWorkspaceId,
		displayedSessionId,
		disabled,
		onStop,
		sending,
		sendError,
		restoreDraft,
		restoreImages,
		restoreFiles,
		restoreCustomTags = [],
		restoreNonce,
		pendingElicitation = null,
		onElicitationResponse = noopElicitationResponse,
		elicitationResponsePending = false,
		pendingDeferredTool = null,
		onDeferredToolResponse = noopDeferredToolResponse,
		planReview = null,
		onImplementPlanInCleanThread,
		modelSelections,
		effortLevels = {},
		permissionModes = {},
		fastModes = {},
		debugModes = {},
		activeFastPreludes = {},
		onSelectModel,
		onSelectEffort,
		onChangePermissionMode,
		onChangeFastMode,
		onChangeDebugMode,
		onSwitchSession,
		onSubmit,
		pendingPromptForSession = null,
		onPendingPromptConsumed,
		pendingInsertRequests = [],
		onPendingInsertRequestsConsumed,
		queueItems = EMPTY_QUEUE_ITEMS,
		onSteerQueued,
		onRemoveQueued,
		modelFilter,
		hideToolbar = false,
	}: WorkspaceComposerContainerProps) {
		const queryClient = useQueryClient();
		const { settings, updateSettings } = useSettings();
		const renderDebugRef = useRef({
			count: 0,
			startedAt: debugNowMs(),
			lastBurstWarningAt: 0,
		});
		renderDebugRef.current.count += 1;

		// -----------------------------------------------------------------------
		// Mid-thread provider swap state
		// -----------------------------------------------------------------------

		/**
		 * When the user confirms a provider swap with "Bring history", we store the
		 * context-transfer prefix keyed by the NEW session id. On the next submit
		 * for that session, the prefix is consumed once and cleared.
		 */
		const pendingContextTransferRef = useRef<Map<string, string>>(new Map());

		/**
		 * Pending dialog state. When non-null the dialog is visible. Once the user
		 * makes a choice (or cancels), `resolve` is called and the state is cleared.
		 */
		const [swapDialogState, setSwapDialogState] = useState<{
			fromProvider: AgentProvider;
			toProvider: AgentProvider;
			modelId: string;
			resolve: (choice: ProviderSwapChoice | null) => void;
		} | null>(null);
		const [providerSwitchStatus, setProviderSwitchStatus] = useState<
			string | null
		>(null);
		const modelSectionsQuery = useQuery(agentModelSectionsQueryOptions());
		const workspaceDetailQuery = useQuery({
			...workspaceDetailQueryOptions(displayedWorkspaceId ?? "__none__"),
			enabled: Boolean(displayedWorkspaceId),
		});
		const sessionsQuery = useQuery({
			...workspaceSessionsQueryOptions(displayedWorkspaceId ?? "__none__"),
			enabled: Boolean(displayedWorkspaceId),
		});
		const linkedDirectoriesQuery = useQuery({
			...workspaceLinkedDirectoriesQueryOptions(
				displayedWorkspaceId ?? "__none__",
			),
			enabled: Boolean(displayedWorkspaceId),
		});
		const linkedDirectories =
			linkedDirectoriesQuery.data ?? EMPTY_LINKED_DIRECTORIES;

		// Candidate workspaces the /add-dir popup offers as quick picks.
		// Excludes the currently-active workspace (you're already in it —
		// linking self to self is a no-op).
		const candidateDirectoriesQuery = useQuery({
			...workspaceCandidateDirectoriesQueryOptions(
				displayedWorkspaceId ?? null,
			),
			enabled: Boolean(displayedWorkspaceId),
		});
		const candidateDirectories =
			candidateDirectoriesQuery.data ?? EMPTY_CANDIDATE_DIRECTORIES;

		const linkedDirectoriesMutation = useMutation({
			mutationFn: async (next: string[]) => {
				if (!displayedWorkspaceId) {
					throw new Error("No workspace selected");
				}
				return setWorkspaceLinkedDirectories(displayedWorkspaceId, next);
			},
			// Write the server's canonical (trimmed + deduped) list into
			// the query cache immediately so any back-to-back mutation
			// computes its next value from fresh state, not the stale
			// pre-mutation list. Prevents the obvious race when the user
			// removes two chips in quick succession.
			onSuccess: (returned) => {
				if (!displayedWorkspaceId) return;
				queryClient.setQueryData(
					helmorQueryKeys.workspaceLinkedDirectories(displayedWorkspaceId),
					returned,
				);
				void queryClient.invalidateQueries({
					predicate: (query) =>
						query.queryKey[0] === "slashCommands" &&
						query.queryKey[3] === displayedWorkspaceId,
				});
			},
			onError: (error) => {
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to update linked directories",
				);
			},
		});

		const handleRemoveLinkedDirectory = useCallback(
			(path: string) => {
				if (!displayedWorkspaceId) return;
				// `mutate` (not `mutateAsync`) sends errors through the
				// `onError` callback configured above — no need to catch.
				linkedDirectoriesMutation.mutate(
					linkedDirectories.filter((d) => d !== path),
				);
			},
			[displayedWorkspaceId, linkedDirectories, linkedDirectoriesMutation],
		);

		// Handle a pick from the AddDirTypeaheadPlugin popup. For
		// candidate entries we toggle linking by path (adds if new,
		// removes if already linked — matches the "linked" badge in
		// the popup). For "browse" we open the native directory picker.
		const handlePickAddDir = useCallback(
			async (entry: AddDirPickerEntry) => {
				if (!displayedWorkspaceId) return;
				if (entry.kind === "browse") {
					let picked: string | null = null;
					try {
						const selected = await openDirectoryDialog({
							directory: true,
							multiple: false,
						});
						picked = typeof selected === "string" ? selected : null;
					} catch (error) {
						toast.error(
							error instanceof Error
								? error.message
								: "Could not open directory picker",
						);
						return;
					}
					if (!picked) return;
					if (linkedDirectories.includes(picked)) return;
					linkedDirectoriesMutation.mutate([...linkedDirectories, picked]);
					return;
				}
				const path = entry.candidate.absolutePath;
				if (entry.alreadyLinked) {
					linkedDirectoriesMutation.mutate(
						linkedDirectories.filter((d) => d !== path),
					);
				} else {
					linkedDirectoriesMutation.mutate([...linkedDirectories, path]);
				}
			},
			[displayedWorkspaceId, linkedDirectories, linkedDirectoriesMutation],
		);

		const rawModelSections = modelSectionsQuery.data ?? EMPTY_MODEL_SECTIONS;
		const modelSections = useMemo(
			() => filterModelSections(rawModelSections, modelFilter),
			[rawModelSections, modelFilter],
		);
		const modelsLoading =
			modelSectionsQuery.isLoading &&
			modelSections.every((s) => s.options.length === 0);
		const currentSession =
			(sessionsQuery.data ?? []).find(
				(session) => session.id === displayedSessionId,
			) ?? null;
		const composerContextKey = getComposerContextKey(
			displayedWorkspaceId,
			displayedSessionId,
		);
		const selectedModelId = resolveSessionSelectedModelId({
			session: currentSession,
			modelSelections,
			modelSections,
			settingsDefaultModelId: settings.defaultModelId,
		});
		const selectedModel = useMemo(
			() => findModelOption(modelSections, selectedModelId),
			[modelSections, selectedModelId],
		);
		const shortcutConflicts = useMemo(
			() => getShortcutConflicts(settings.shortcuts),
			[settings.shortcuts],
		);
		const focusShortcut = shortcutConflicts.conflictById["composer.focus"]
			? null
			: getShortcut(settings.shortcuts, "composer.focus");
		const togglePlanShortcut = shortcutConflicts.conflictById[
			"composer.togglePlanMode"
		]
			? null
			: getShortcut(settings.shortcuts, "composer.togglePlanMode");
		const toggleFollowUpShortcut = shortcutConflicts.conflictById[
			"composer.toggleFollowUpBehavior"
		]
			? null
			: getShortcut(settings.shortcuts, "composer.toggleFollowUpBehavior");
		const pendingOverrideActive =
			pendingPromptForSession?.sessionId === displayedSessionId;
		const pendingModel = useMemo(
			() =>
				pendingOverrideActive && pendingPromptForSession?.modelId
					? findModelOption(modelSections, pendingPromptForSession.modelId)
					: null,
			[
				displayedSessionId,
				modelSections,
				pendingOverrideActive,
				pendingPromptForSession,
			],
		);
		const effectiveModel = pendingModel ?? selectedModel;
		const effectiveSelectedModelId = effectiveModel?.id ?? selectedModelId;
		const provider =
			effectiveModel?.provider ?? currentSession?.agentType ?? "claude";
		const cachedEffort = composerContextKey.startsWith("session:")
			? effortLevels[composerContextKey]
			: undefined;
		// For new sessions, use user setting; for existing sessions with history, use session's effort
		const sessionEffort =
			(!isNewSession(currentSession) && currentSession?.effortLevel) || null;
		const rawEffort =
			cachedEffort ?? sessionEffort ?? settings.defaultEffort ?? "high";
		const effortLevel = clampEffortToModel(
			rawEffort,
			effectiveSelectedModelId,
			modelSections,
		);
		const cachedPermissionMode = composerContextKey.startsWith("session:")
			? permissionModes[composerContextKey]
			: undefined;
		const sessionPermissionMode = !isNewSession(currentSession)
			? currentSession?.permissionMode
			: null;
		const permissionMode =
			cachedPermissionMode ??
			(sessionPermissionMode === "plan" ? "plan" : "bypassPermissions");
		const effectivePermissionMode =
			pendingOverrideActive && pendingPromptForSession?.permissionMode
				? pendingPromptForSession.permissionMode
				: permissionMode;
		const supportsFastMode = effectiveModel?.supportsFastMode === true;
		const cachedFastMode = composerContextKey.startsWith("session:")
			? fastModes[composerContextKey]
			: undefined;
		const sessionFastMode = !isNewSession(currentSession)
			? currentSession?.fastMode
			: undefined;
		const fastMode = supportsFastMode
			? (cachedFastMode ?? sessionFastMode ?? settings.defaultFastMode ?? false)
			: false;
		const debugMode = debugModes[composerContextKey] ?? false;
		const showFastModePrelude = activeFastPreludes[composerContextKey] === true;
		const loadingConversationContext =
			Boolean(displayedWorkspaceId) &&
			(workspaceDetailQuery.isPending || sessionsQuery.isPending);
		// Split the "disabled" concept along two axes:
		//
		//   * `composerUnavailable` — the composer is conceptually not
		//     usable here (no workspace selected, or workspace archived).
		//     Entire UI dims to opacity-60, all toolbars disabled.
		//
		//   * `composerAwaitingFinalize` — workspace is still in Phase 2
		//     (`initializing`). The composer is fully live visually so the
		//     user can compose / tweak settings while the worktree is
		//     materializing; only the Send button is blocked (see
		//     `submitDisabled` below) to keep sends from racing with
		//     finalize. The typical ~200-500ms window ends long before the
		//     user finishes typing, so there is no visible transition.
		const composerUnavailable =
			displayedWorkspaceId === null ||
			workspaceDetailQuery.data?.state === "archived";
		const composerAwaitingFinalize =
			workspaceDetailQuery.data?.state === "initializing";

		// Auto-close opt-in state comes from settings: `auto_close_action_kinds`
		// is the persistent list of action kinds the user has enabled. A given
		// session is "auto-close enabled" when its `actionKind` is in that set.
		const autoCloseQuery = useQuery(autoCloseActionKindsQueryOptions());
		const autoCloseActionKinds = useMemo(
			() => new Set(autoCloseQuery.data ?? []),
			[autoCloseQuery.data],
		);
		const sessionActionKind = currentSession?.actionKind ?? null;
		const isActionSession = Boolean(sessionActionKind);
		const autoCloseEnabled = sessionActionKind
			? autoCloseActionKinds.has(sessionActionKind)
			: false;

		useEffect(() => {
			logComposerDebug("model sections state", {
				status: modelSectionsQuery.status,
				fetchStatus: modelSectionsQuery.fetchStatus,
				sectionCounts: summarizeModelSections(modelSections),
				providerCounts: modelProviderCounts(modelSections),
				selectedModelId,
				effectiveSelectedModelId,
				effectiveModelProvider: effectiveModel?.provider ?? null,
				modelsLoading,
			});
		}, [
			effectiveModel?.provider,
			effectiveSelectedModelId,
			modelSections,
			modelSectionsQuery.fetchStatus,
			modelSectionsQuery.status,
			modelsLoading,
			selectedModelId,
		]);

		useEffect(() => {
			if (!swapDialogState) return;
			logComposerDebug("provider swap dialog visible", {
				fromProvider: swapDialogState.fromProvider,
				toProvider: swapDialogState.toProvider,
				modelId: swapDialogState.modelId,
				workspaceId: displayedWorkspaceId,
				sessionId: displayedSessionId,
			});
		}, [displayedSessionId, displayedWorkspaceId, swapDialogState]);

		const handleToggleAutoClose = useCallback(async () => {
			if (!sessionActionKind) return;
			const currentKinds = Array.from(autoCloseActionKinds);
			const nextKinds = autoCloseEnabled
				? currentKinds.filter((kind) => kind !== sessionActionKind)
				: [...currentKinds, sessionActionKind];
			try {
				await saveAutoCloseActionKinds(nextKinds);
			} finally {
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.autoCloseActionKinds,
				});
			}
		}, [
			sessionActionKind,
			autoCloseActionKinds,
			autoCloseEnabled,
			queryClient,
		]);

		const handleModelSelect = useCallback(
			async (modelId: string) => {
				if (providerSwitchStatus) {
					logComposerDebug("model select ignored during provider switch", {
						modelId,
						providerSwitchStatus,
						workspaceId: displayedWorkspaceId,
						sessionId: displayedSessionId,
					});
					return;
				}

				const newModel = findModelOption(modelSections, modelId);
				const currentProvider = provider;
				const newProvider = newModel?.provider;
				logComposerDebug("model select requested", {
					modelId,
					modelFound: Boolean(newModel),
					currentProvider,
					newProvider: newProvider ?? null,
					currentSessionId: currentSession?.id ?? null,
					currentSessionAgentType: currentSession?.agentType ?? null,
					currentSessionModel: currentSession?.model ?? null,
					currentSessionStatus: currentSession?.status ?? null,
					isNewSession: isNewSession(currentSession),
					workspaceId: displayedWorkspaceId,
					sessionId: displayedSessionId,
					contextKey: composerContextKey,
					sectionCounts: summarizeModelSections(modelSections),
					providerCounts: modelProviderCounts(modelSections),
				});

				// Only create a new session when provider changes AND the session
				// already has messages. New/empty sessions just switch in-place.
				if (
					newProvider &&
					currentProvider &&
					newProvider !== currentProvider &&
					!isNewSession(currentSession) &&
					displayedSessionId &&
					displayedWorkspaceId
				) {
					// Ask the user for consent before switching providers. Defer the
					// dialog one tick so the model popover can finish closing first;
					// otherwise Radix focus scopes can fight when a large Pi list is
					// open, tripping React's nested-update guard.
					const choice = await new Promise<ProviderSwapChoice | null>(
						(resolve) => {
							window.setTimeout(() => {
								logComposerDebug("opening provider swap dialog", {
									fromProvider: currentProvider,
									toProvider: newProvider,
									modelId,
									workspaceId: displayedWorkspaceId,
									sessionId: displayedSessionId,
								});
								setSwapDialogState({
									fromProvider: currentProvider as AgentProvider,
									toProvider: newProvider as AgentProvider,
									modelId,
									resolve,
								});
							}, 0);
						},
					);

					// User cancelled — leave everything as-is.
					logComposerDebug("provider swap dialog resolved", {
						choice,
						fromProvider: currentProvider,
						toProvider: newProvider,
						modelId,
						workspaceId: displayedWorkspaceId,
						sessionId: displayedSessionId,
					});
					if (choice === null) return;

					const toastId = toast.loading("Preparing provider switch…");
					setProviderSwitchStatus("Preparing provider switch…");

					try {
						// Build the context-transfer prefix BEFORE creating the new
						// session so any load failure doesn't leave an orphaned session.
						let contextPrefix: string | null = null;
						if (choice === "bring-history") {
							setProviderSwitchStatus("Loading conversation history…");
							toast.loading("Loading conversation history…", { id: toastId });
							logComposerDebug("loading provider swap history", {
								sessionId: displayedSessionId,
								fromProvider: currentProvider,
								toProvider: newProvider,
							});
							try {
								const msgs =
									await loadSessionThreadMessages(displayedSessionId);
								logComposerDebug("provider swap history loaded", {
									sessionId: displayedSessionId,
									messageCount: msgs.length,
								});
								const prefix = buildContextTransferPrefix(
									msgs,
									currentProvider as AgentProvider,
								);
								if (prefix) {
									contextPrefix = prefix;
								}
								logComposerDebug("provider swap history prefix built", {
									sessionId: displayedSessionId,
									hasContextPrefix: Boolean(contextPrefix),
									contextPrefixLength: contextPrefix?.length ?? 0,
								});
							} catch (error) {
								console.warn(
									"[composer] failed to load provider-swap history:",
									error,
								);
								toast.warning("Could not load history; switching without it.", {
									id: toastId,
								});
							}
						}

						setProviderSwitchStatus("Creating a new session…");
						toast.loading("Creating a new session…", { id: toastId });
						logComposerDebug("creating provider swap session", {
							workspaceId: displayedWorkspaceId,
							modelId,
							toProvider: newProvider,
						});
						const { sessionId: newSessionId } =
							await createSession(displayedWorkspaceId);
						logComposerDebug("provider swap session created", {
							workspaceId: displayedWorkspaceId,
							newSessionId,
						});
						seedNewSessionInCache({
							queryClient,
							workspaceId: displayedWorkspaceId,
							sessionId: newSessionId,
							workspace: workspaceDetailQuery.data ?? null,
							existingSessions: sessionsQuery.data ?? [],
						});

						queryClient.setQueryData(sessionThreadCacheKey(newSessionId), []);

						// Register the pending context transfer for the new session.
						if (contextPrefix) {
							pendingContextTransferRef.current.set(
								newSessionId,
								contextPrefix,
							);
						}

						if (choice === "bring-history") {
							// Record the parent session so the panel can show the old
							// conversation history above a visual divider in the new thread.
							storeProviderSwitchParent(newSessionId, {
								parentSessionId: displayedSessionId,
								fromProvider: currentProvider as AgentProvider,
								toProvider: newProvider as AgentProvider,
							});
						}

						setProviderSwitchStatus("Switching composer to new provider…");
						toast.loading("Switching composer to new provider…", {
							id: toastId,
						});
						const newContextKey = getComposerContextKey(
							displayedWorkspaceId,
							newSessionId,
						);
						logComposerDebug("applying provider swap model selection", {
							newSessionId,
							newContextKey,
							modelId,
							toProvider: newProvider,
						});
						onSelectModel(newContextKey, modelId);
						onSwitchSession?.(newSessionId);

						void Promise.all([
							queryClient.invalidateQueries({
								queryKey:
									helmorQueryKeys.workspaceSessions(displayedWorkspaceId),
							}),
							...(workspaceDetailQuery.data?.repoId
								? [
										queryClient.invalidateQueries({
											queryKey: helmorQueryKeys.repoScripts(
												workspaceDetailQuery.data.repoId,
												displayedWorkspaceId,
											),
										}),
									]
								: []),
						]);
						toast.success("Provider switched. Send a message to continue.", {
							id: toastId,
						});
						logComposerDebug("provider swap completed", {
							workspaceId: displayedWorkspaceId,
							oldSessionId: displayedSessionId,
							newSessionId,
							modelId,
							fromProvider: currentProvider,
							toProvider: newProvider,
						});
						return;
					} catch (error) {
						console.error("[composer] provider switch failed:", error);
						toast.error(
							error instanceof Error
								? error.message
								: "Failed to switch provider.",
							{ id: toastId },
						);
						return;
					} finally {
						setProviderSwitchStatus(null);
					}
				}

				logComposerDebug("model select applied in current context", {
					contextKey: composerContextKey,
					modelId,
					currentProvider,
					newProvider: newProvider ?? null,
				});
				onSelectModel(composerContextKey, modelId);
			},
			[
				modelSections,
				provider,
				currentSession,
				displayedSessionId,
				displayedWorkspaceId,
				composerContextKey,
				onSelectModel,
				onSwitchSession,
				queryClient,
				workspaceDetailQuery.data,
				workspaceDetailQuery.data?.repoId,
				sessionsQuery.data,
				providerSwitchStatus,
			],
		);

		const workingDirectory =
			workspaceDetailQuery.data?.state === "archived"
				? null
				: (workspaceDetailQuery.data?.rootPath ?? null);

		// Narrow `provider` (which can be the loosely-typed agentType from a
		// historical session) to a real AgentProvider before keying the
		// query — anything else degrades to claude so we never miss the popup.
		const slashProvider: AgentProvider =
			provider === "codex" || provider === "pi" ? provider : "claude";
		// Slash command list — keyed by (provider, workingDirectory). The
		// composer popup is hidden until this resolves; on error we fall back
		// to an empty list and the popup never opens (no UI breakage).
		const slashCommandsQuery = useQuery({
			...slashCommandsQueryOptions(
				slashProvider,
				workingDirectory,
				workspaceDetailQuery.data?.repoId ?? null,
				displayedWorkspaceId,
			),
			enabled: Boolean(workingDirectory),
		});
		const slashCommandsResponse = slashCommandsQuery.data;
		const agentSlashCommands =
			slashCommandsResponse?.commands ?? EMPTY_SLASH_COMMANDS;
		// Prepend Helmor's host-app commands (e.g. /add-dir) so they always
		// show at the top of the popup, even before the agent-supplied list
		// has loaded.
		const slashCommands = useMemo<readonly SlashCommandEntry[]>(
			() => [
				...BUILTIN_CLIENT_COMMANDS.filter(
					(command) =>
						!command.providers || command.providers.includes(slashProvider),
				),
				...agentSlashCommands,
			],
			[agentSlashCommands, slashProvider],
		);
		// Pending only (`isPending`) covers the very first fetch with no data
		// yet; once we have data, `isFetching` covers background refetches but
		// users don't need a spinner for those — the cached list is fine.
		const slashCommandsLoading =
			Boolean(workingDirectory) &&
			slashCommandsQuery.isPending &&
			!slashCommandsQuery.isError;
		const slashCommandsError =
			Boolean(workingDirectory) && slashCommandsQuery.isError;
		const refetchSlashCommands = useCallback(() => {
			logComposerDebug("slash commands retry requested", {
				provider: slashProvider,
				workingDirectory,
				workspaceId: displayedWorkspaceId,
			});
			void slashCommandsQuery.refetch();
		}, [
			displayedWorkspaceId,
			slashCommandsQuery,
			slashProvider,
			workingDirectory,
		]);

		useEffect(() => {
			logComposerDebug("slash commands state", {
				provider: slashProvider,
				workingDirectory,
				workspaceId: displayedWorkspaceId,
				status: slashCommandsQuery.status,
				fetchStatus: slashCommandsQuery.fetchStatus,
				isPending: slashCommandsQuery.isPending,
				isError: slashCommandsQuery.isError,
				agentCommandCount: agentSlashCommands.length,
				totalCommandCount: slashCommands.length,
			});
		}, [
			agentSlashCommands.length,
			displayedWorkspaceId,
			slashCommands.length,
			slashCommandsQuery.fetchStatus,
			slashCommandsQuery.isError,
			slashCommandsQuery.isPending,
			slashCommandsQuery.status,
			slashProvider,
			workingDirectory,
		]);

		useEffect(() => {
			logComposerDebug("session context state", {
				workspaceId: displayedWorkspaceId,
				sessionId: displayedSessionId,
				composerContextKey,
				currentSessionId: currentSession?.id ?? null,
				currentSessionAgentType: currentSession?.agentType ?? null,
				currentSessionModel: currentSession?.model ?? null,
				currentSessionStatus: currentSession?.status ?? null,
				workspaceState: workspaceDetailQuery.data?.state ?? null,
				workspaceStatus: workspaceDetailQuery.data?.status ?? null,
				workingDirectory,
				provider,
				slashProvider,
				effortLevel,
				effectivePermissionMode,
				fastMode,
				debugMode,
				supportsFastMode,
				sessionsStatus: sessionsQuery.status,
				sessionsCount: sessionsQuery.data?.length ?? 0,
			});
		}, [
			composerContextKey,
			currentSession?.agentType,
			currentSession?.id,
			currentSession?.model,
			currentSession?.status,
			displayedSessionId,
			displayedWorkspaceId,
			effectivePermissionMode,
			effortLevel,
			debugMode,
			fastMode,
			provider,
			sessionsQuery.data?.length,
			sessionsQuery.status,
			slashProvider,
			supportsFastMode,
			workingDirectory,
			workspaceDetailQuery.data?.state,
			workspaceDetailQuery.data?.status,
		]);

		const handleComposerSubmit = useCallback(
			(
				prompt: string,
				imagePaths: string[],
				filePaths: string[],
				customTags: ComposerCustomTag[],
				options?: {
					permissionModeOverride?: string;
					oppositeFollowUp?: boolean;
				},
			) => {
				if (!effectiveModel) {
					logComposerDebug("submit blocked without effective model", {
						selectedModelId,
						effectiveSelectedModelId,
						workspaceId: displayedWorkspaceId,
						sessionId: displayedSessionId,
					});
					return;
				}
				// Translate the per-submit "opposite" toggle into a concrete
				// override based on the user's persistent setting. The setting
				// itself is left untouched.
				const followUpBehaviorOverride = options?.oppositeFollowUp
					? settings.followUpBehavior === "queue"
						? "steer"
						: "queue"
					: undefined;

				// Consume any pending context-transfer prefix for this session. It
				// is cleared immediately so a second submit doesn't re-inject it.
				let contextTransferPrefix: string | null = null;
				if (displayedSessionId) {
					const pending =
						pendingContextTransferRef.current.get(displayedSessionId);
					if (pending) {
						contextTransferPrefix = pending;
						pendingContextTransferRef.current.delete(displayedSessionId);
					}
				}

				logComposerDebug("submit prepared", {
					workspaceId: displayedWorkspaceId,
					sessionId: displayedSessionId,
					modelId: effectiveModel.id,
					modelProvider: effectiveModel.provider,
					modelCliModel: effectiveModel.cliModel,
					workingDirectory,
					effortLevel,
					permissionMode:
						options?.permissionModeOverride ?? effectivePermissionMode,
					fastMode: supportsFastMode ? fastMode : false,
					debugMode,
					promptLength: prompt.length,
					imageCount: imagePaths.length,
					fileCount: filePaths.length,
					customTagCount: customTags.length,
					hasContextTransferPrefix: Boolean(contextTransferPrefix),
				});
				onSubmit({
					prompt,
					imagePaths,
					filePaths,
					customTags,
					model: effectiveModel,
					workingDirectory,
					effortLevel,
					permissionMode:
						options?.permissionModeOverride ?? effectivePermissionMode,
					fastMode: supportsFastMode ? fastMode : false,
					debugMode,
					followUpBehaviorOverride,
					contextTransferPrefix,
				});
			},
			[
				effectiveModel,
				onSubmit,
				workingDirectory,
				effortLevel,
				effectivePermissionMode,
				fastMode,
				debugMode,
				supportsFastMode,
				settings.followUpBehavior,
				displayedSessionId,
				displayedWorkspaceId,
				selectedModelId,
				effectiveSelectedModelId,
			],
		);

		// Track which queued prompt we've already dispatched so a re-render
		// (e.g. due to query invalidation refreshing the session list) can't
		// resubmit the same prompt twice before the parent clears the queue.
		const dispatchedPromptKeyRef = useRef<string | null>(null);

		useEffect(() => {
			if (!pendingPromptForSession) {
				dispatchedPromptKeyRef.current = null;
				return;
			}
			if (pendingPromptForSession.sessionId !== displayedSessionId) {
				return;
			}
			if (pendingPromptForSession.modelId && !pendingModel) {
				// Wait for the model sections query to resolve the queued model.
				return;
			}
			if (!effectiveModel) {
				// Wait for the model sections query to resolve.
				return;
			}

			const dispatchKey = [
				pendingPromptForSession.sessionId,
				pendingPromptForSession.prompt,
				pendingPromptForSession.modelId ?? "",
				pendingPromptForSession.permissionMode ?? "",
				pendingPromptForSession.forceQueue ? "q" : "",
			].join("|");
			if (dispatchedPromptKeyRef.current === dispatchKey) {
				logComposerDebug("pending prompt already dispatched", {
					dispatchKey,
					sessionId: displayedSessionId,
				});
				return;
			}
			dispatchedPromptKeyRef.current = dispatchKey;

			logComposerDebug("dispatching pending prompt", {
				sessionId: pendingPromptForSession.sessionId,
				modelId: effectiveModel.id,
				modelProvider: effectiveModel.provider,
				promptLength: pendingPromptForSession.prompt.length,
				forceQueue: pendingPromptForSession.forceQueue ?? false,
			});
			onSubmit({
				prompt: pendingPromptForSession.prompt,
				imagePaths: [],
				filePaths: [],
				customTags: [],
				model: effectiveModel,
				workingDirectory,
				effortLevel,
				permissionMode:
					pendingPromptForSession.permissionMode ?? effectivePermissionMode,
				fastMode: supportsFastMode ? fastMode : false,
				debugMode,
				forceQueue: pendingPromptForSession.forceQueue,
			});
			onPendingPromptConsumed?.(pendingPromptForSession.pendingSendId);
		}, [
			displayedSessionId,
			effectiveModel,
			effectivePermissionMode,
			effortLevel,
			debugMode,
			fastMode,
			onPendingPromptConsumed,
			onSubmit,
			pendingModel,
			pendingPromptForSession,
			supportsFastMode,
			workingDirectory,
		]);

		useEffect(() => {
			const debug = renderDebugRef.current;
			const elapsedMs = Math.round(debugNowMs() - debug.startedAt);
			const snapshot = {
				renderCount: debug.count,
				elapsedMs,
				workspaceId: displayedWorkspaceId,
				sessionId: displayedSessionId,
				contextKey: composerContextKey,
				selectedModelId,
				effectiveSelectedModelId,
				provider,
				slashProvider,
				swapDialogOpen: Boolean(swapDialogState),
				providerSwitchStatus,
				modelSectionsStatus: modelSectionsQuery.status,
				sessionsStatus: sessionsQuery.status,
				workspaceStatus: workspaceDetailQuery.status,
				slashCommandsStatus: slashCommandsQuery.status,
				slashCommandsFetching: slashCommandsQuery.isFetching,
				loadingConversationContext,
				composerUnavailable,
				composerAwaitingFinalize,
			};
			if (debug.count <= 20 || debug.count % 10 === 0) {
				logComposerDebug("render snapshot", snapshot);
			}
			if (
				debug.count >= 50 &&
				elapsedMs < 2_000 &&
				debugNowMs() - debug.lastBurstWarningAt > 250
			) {
				debug.lastBurstWarningAt = debugNowMs();
				console.warn("[composer-debug] rapid render burst", snapshot);
			}
		});

		const handleSelectModelInner = useCallback(
			(modelId: string) => {
				logComposerDebug("model picker callback", {
					modelId,
					workspaceId: displayedWorkspaceId,
					sessionId: displayedSessionId,
				});
				void handleModelSelect(modelId);
			},
			[displayedSessionId, displayedWorkspaceId, handleModelSelect],
		);

		const handleToggleFavouriteInner = useCallback(
			(modelId: string) => {
				const current = settings.favoriteModelIds ?? [];
				const next = current.includes(modelId)
					? current.filter((id) => id !== modelId)
					: [...current, modelId];
				logComposerDebug("favorite models update", {
					modelId,
					wasFavorite: current.includes(modelId),
					nextCount: next.length,
				});
				void updateSettings({ favoriteModelIds: next });
			},
			[settings.favoriteModelIds, updateSettings],
		);

		const handleSelectEffortInner = useCallback(
			(level: string) => {
				onSelectEffort(composerContextKey, level);
			},
			[onSelectEffort, composerContextKey],
		);

		const handleChangePermissionModeInner = useCallback(
			(mode: string) => {
				onChangePermissionMode(composerContextKey, mode);
			},
			[onChangePermissionMode, composerContextKey],
		);

		const handleChangeFastModeInner = useCallback(
			(enabled: boolean) => {
				onChangeFastMode(composerContextKey, enabled);
			},
			[onChangeFastMode, composerContextKey],
		);

		const handleChangeDebugModeInner = useCallback(
			(enabled: boolean) => {
				onChangeDebugMode?.(composerContextKey, enabled);
			},
			[onChangeDebugMode, composerContextKey],
		);
		const autoCloseHelpText =
			"When enabled, action sessions will close automatically when finished.";

		return (
			<>
				{/* `z-20` lifts the entire composer stacking context above the thread
			    viewport's `z-10` root (`thread-viewport.tsx:99`). Without this the
			    slash/@ popup — which portals into the composer root — gets
			    occluded by chat messages when it opens upward past the composer's
			    top edge, because the composer's `isolate` traps popup z-index
			    inside a stacking context whose outer z defaults to `auto`. */}
				<div className="relative isolate z-20 flex flex-col">
					{isActionSession ? (
						<ActionRow
							className={cn(
								"relative z-0 mx-auto -mb-px w-[90%] rounded-t-2xl border-b-0",
								autoCloseEnabled ? "border-transparent" : "border-secondary/80",
							)}
							overlay={
								autoCloseEnabled ? (
									<>
										<ShineBorder
											borderWidth={1}
											duration={8}
											shineColor="var(--primary)"
										/>
										<div className="pointer-events-none absolute inset-x-px bottom-0 z-[1] h-[2px] bg-background" />
									</>
								) : null
							}
							leading={
								sending ? (
									<ShimmerText
										durationMs={1900}
										className="truncate text-[12px] font-medium tracking-[0.02em] text-muted-foreground"
									>
										Working...
									</ShimmerText>
								) : (
									<>
										<CircleAlert
											className="size-3.5 shrink-0 text-muted-foreground/60"
											strokeWidth={1.8}
											aria-hidden="true"
										/>
										<span className="truncate text-[12px] font-medium tracking-[0.01em] text-muted-foreground">
											{autoCloseHelpText}
										</span>
									</>
								)
							}
							trailing={
								<ActionRowButton
									active={autoCloseEnabled}
									aria-label={
										autoCloseEnabled
											? "Disable Auto Close"
											: "Enable Auto Close"
									}
									disabled={composerUnavailable}
									onClick={() => {
										void handleToggleAutoClose();
									}}
								>
									<TimerReset
										className="size-[13px] shrink-0"
										strokeWidth={1.8}
									/>
									<span className="inline-flex items-center">
										{autoCloseEnabled ? "Auto Close On" : "Enable Auto Close"}
									</span>
								</ActionRowButton>
							}
						/>
					) : null}

					<div className="relative z-10">
						{providerSwitchStatus ? (
							<div className="mb-2 flex items-center justify-center rounded-xl border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
								<ShimmerText durationMs={1700}>
									{providerSwitchStatus}
								</ShimmerText>
							</div>
						) : null}
						<div className="pointer-events-none absolute inset-x-0 bottom-[calc(100%-1px)] z-20 flex justify-center">
							<SubmitQueueList
								items={queueItems}
								onSteer={(id) => onSteerQueued?.(id)}
								onRemove={(id) => onRemoveQueued?.(id)}
								disabled={composerUnavailable}
							/>
						</div>
						<WorkspaceComposer
							contextKey={composerContextKey}
							sessionId={displayedSessionId}
							providerSessionId={currentSession?.providerSessionId ?? null}
							agentType={slashProvider}
							focusShortcut={focusShortcut}
							togglePlanShortcut={togglePlanShortcut}
							toggleFollowUpShortcut={toggleFollowUpShortcut}
							alwaysShowContextUsage={settings.alwaysShowContextUsage}
							hideToolbar={hideToolbar}
							onSubmit={handleComposerSubmit}
							disabled={composerUnavailable}
							submitDisabled={
								disabled ||
								loadingConversationContext ||
								composerAwaitingFinalize ||
								Boolean(providerSwitchStatus)
							}
							onStop={onStop}
							sending={sending}
							selectedModelId={effectiveSelectedModelId}
							modelSections={modelSections}
							modelsLoading={modelsLoading}
							onSelectModel={handleSelectModelInner}
							favoriteModelIds={settings.favoriteModelIds}
							onToggleFavorite={handleToggleFavouriteInner}
							provider={provider}
							effortLevel={effortLevel}
							onSelectEffort={handleSelectEffortInner}
							permissionMode={effectivePermissionMode}
							onChangePermissionMode={handleChangePermissionModeInner}
							fastMode={fastMode}
							showFastModePrelude={showFastModePrelude}
							onChangeFastMode={
								supportsFastMode ? handleChangeFastModeInner : undefined
							}
							debugMode={debugMode}
							onChangeDebugMode={
								onChangeDebugMode ? handleChangeDebugModeInner : undefined
							}
							sendError={sendError}
							restoreDraft={restoreDraft}
							restoreImages={restoreImages}
							restoreFiles={restoreFiles}
							restoreCustomTags={restoreCustomTags}
							restoreNonce={restoreNonce}
							pendingElicitation={pendingElicitation}
							onElicitationResponse={onElicitationResponse}
							elicitationResponsePending={elicitationResponsePending}
							pendingDeferredTool={pendingDeferredTool}
							onDeferredToolResponse={onDeferredToolResponse}
							planReview={planReview}
							onImplementPlanInCleanThread={onImplementPlanInCleanThread}
							pendingInsertRequests={pendingInsertRequests}
							onPendingInsertRequestsConsumed={onPendingInsertRequestsConsumed}
							slashCommands={slashCommands}
							slashCommandsLoading={slashCommandsLoading}
							slashCommandsError={slashCommandsError}
							onRetrySlashCommands={refetchSlashCommands}
							workspaceRootPath={workingDirectory}
							linkedDirectories={linkedDirectories}
							onRemoveLinkedDirectory={handleRemoveLinkedDirectory}
							linkedDirectoriesDisabled={linkedDirectoriesMutation.isPending}
							addDirCandidates={candidateDirectories}
							onPickAddDir={handlePickAddDir}
						/>
					</div>
				</div>

				{/* Provider swap consent dialog — rendered as a portal so it floats
			    above the composer; position in the tree doesn't matter visually. */}
				{swapDialogState ? (
					<ProviderSwapDialog
						open={true}
						fromProvider={swapDialogState.fromProvider}
						toProvider={swapDialogState.toProvider}
						onChoose={(choice) => {
							logComposerDebug("provider swap choice selected", {
								choice,
								fromProvider: swapDialogState.fromProvider,
								toProvider: swapDialogState.toProvider,
								modelId: swapDialogState.modelId,
							});
							swapDialogState.resolve(choice);
							setSwapDialogState(null);
						}}
						onCancel={() => {
							logComposerDebug("provider swap cancelled", {
								fromProvider: swapDialogState.fromProvider,
								toProvider: swapDialogState.toProvider,
								modelId: swapDialogState.modelId,
							});
							swapDialogState.resolve(null);
							setSwapDialogState(null);
						}}
					/>
				) : null}
			</>
		);
	},
);
