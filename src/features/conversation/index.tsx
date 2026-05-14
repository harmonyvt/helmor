// React Compiler opt-out: this file has an intentional render-phase ref
// mutation + setState-during-render pattern (see ~line 117) that the
// compiler's rules-of-react check rejects. The pattern is documented as
// intentional and StrictMode-safe in situ.
"use no memo";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { WorkspaceComposerContainer } from "@/features/composer/container";
import type {
	DeferredToolResponseHandler,
	DeferredToolResponseOptions,
} from "@/features/composer/deferred-tool";
import { WorkspacePanelContainer } from "@/features/panel/container";
import { FileLinkProvider } from "@/features/panel/message-components/file-link-context";
import type { SessionCloseRequest } from "@/features/panel/use-confirm-session-close";
import {
	type AgentModelOption,
	type AgentSendRequest,
	type AgentStreamEvent,
	type ChangeRequestInfo,
	createSession,
	type DebugIngestStatus,
	type PlanReviewPart,
} from "@/lib/api";
import type { ResolvedComposerInsertRequest } from "@/lib/composer-insert";
import { insertRequestMatchesComposer } from "@/lib/composer-insert";
import { getUnresolvedPlanReview } from "@/lib/plan-review";
import {
	helmorQueryKeys,
	sessionThreadMessagesQueryOptions,
	workspaceSessionsQueryOptions,
} from "@/lib/query-client";
import { useSettings } from "@/lib/settings";
import { EMPTY_QUEUE, useSubmitQueue } from "@/lib/use-submit-queue";
import { getComposerContextKey } from "@/lib/workspace-helpers";
import { useConversationStreaming } from "./hooks/use-streaming";
import {
	adaptPermissionToDeferredTool,
	permissionIdFromAdaptedToolUseId,
} from "./permission-as-deferred-tool";
import { usePiUiInteraction } from "./pi-ui-interaction";

type WorkspaceConversationContainerProps = {
	selectedWorkspaceId: string | null;
	displayedWorkspaceId: string | null;
	selectedSessionId: string | null;
	displayedSessionId: string | null;
	repoId?: string | null;
	sessionSelectionHistory?: string[];
	onSelectSession: (sessionId: string | null) => void;
	onResolveDisplayedSession: (sessionId: string | null) => void;
	onSendingWorkspacesChange?: (workspaceIds: Set<string>) => void;
	/** Reports the set of session IDs currently streaming, so App can observe
	 * session-level lifecycle events (e.g. the commit button driver needs to
	 * know when its target session's stream has ended). */
	onSendingSessionsChange?: (sessionIds: Set<string>) => void;
	onInteractionSessionsChange?: (
		sessionWorkspaceMap: Map<string, string>,
		interactionCounts: Map<string, number>,
	) => void;
	interactionRequiredSessionIds?: Set<string>;
	onSessionCompleted?: (sessionId: string, workspaceId: string) => void;
	workspaceChangeRequest?: ChangeRequestInfo | null;
	onSessionAborted?: (sessionId: string, workspaceId: string) => void;
	headerActions?: React.ReactNode;
	headerLeading?: React.ReactNode;
	/** Prompt queued by an external caller (e.g. the inspector Git commit
	 * button) to be auto-submitted once the displayed session matches. */
	pendingPromptForSession?: {
		sessionId: string;
		prompt: string;
		modelId?: string | null;
		permissionMode?: string | null;
		/** When true, submit must queue if a turn is already streaming,
		 *  regardless of the user's `followUpBehavior` setting. */
		forceQueue?: boolean;
		pendingSendId?: string | null;
	} | null;
	/** Called after the pending prompt has been handed off to the composer's
	 * submit flow, so the caller can clear the queue. */
	onPendingPromptConsumed?: (pendingSendId?: string | null) => void;
	pendingInsertRequests?: ResolvedComposerInsertRequest[];
	onPendingInsertRequestsConsumed?: (ids: string[]) => void;
	onQueuePendingPromptForSession?: (request: {
		sessionId: string;
		prompt: string;
		modelId?: string | null;
		permissionMode?: string | null;
	}) => void;
	onRequestCloseSession?: (request: SessionCloseRequest) => void;
	workspaceRootPath?: string | null;
	onOpenFileReference?: (path: string, line?: number, column?: number) => void;
	modelFilter?: (model: AgentModelOption) => boolean;
	buildSendRequestExtras?: (context: {
		workspaceId: string | null;
		sessionId: string;
		prompt: string;
		model: AgentModelOption;
	}) => Partial<AgentSendRequest> | null | undefined;
	debugModes?: Record<string, boolean>;
	onChangeDebugMode?: (
		context: { contextKey: string; workspaceId: string | null },
		enabled: boolean,
	) => void;
	ensureDebugIngestForSubmit?: (
		workspaceId: string,
	) => Promise<DebugIngestStatus | null>;
	onKanbanToolCall?: (
		event: Extract<AgentStreamEvent, { kind: "kanbanToolCall" }>,
	) => void;
	/** Optional observer for Pi extension UI requests. The shared conversation
	 * surface always renders and responds to select/confirm/input requests. */
	onPiUiRequest?: (
		event: Extract<AgentStreamEvent, { kind: "piUiRequest" }>,
	) => void;
	composerAccessory?: ReactNode;
	/** Renders a compact header (no branch/tabs) and hides the composer toolbar.
	 *  Used by narrow embedded panels such as the Pi goals surface. */
	compact?: boolean;
};

export const WorkspaceConversationContainer = memo(
	function WorkspaceConversationContainer({
		selectedWorkspaceId,
		displayedWorkspaceId,
		selectedSessionId,
		displayedSessionId,
		repoId = null,
		sessionSelectionHistory = [],
		onSelectSession,
		onResolveDisplayedSession,
		onSendingWorkspacesChange,
		onSendingSessionsChange,
		onInteractionSessionsChange,
		interactionRequiredSessionIds,
		onSessionCompleted,
		workspaceChangeRequest = null,
		onSessionAborted,
		headerActions,
		headerLeading,
		pendingPromptForSession = null,
		onPendingPromptConsumed,
		pendingInsertRequests = [],
		onPendingInsertRequestsConsumed,
		onQueuePendingPromptForSession,
		onRequestCloseSession,
		workspaceRootPath,
		onOpenFileReference,
		modelFilter,
		buildSendRequestExtras,
		debugModes: externalDebugModes,
		onChangeDebugMode: onExternalChangeDebugMode,
		ensureDebugIngestForSubmit,
		onKanbanToolCall,
		onPiUiRequest,
		composerAccessory,
		compact = false,
	}: WorkspaceConversationContainerProps) {
		const queryClient = useQueryClient();
		const {
			accessory: piUiAccessory,
			handlePiUiRequest: handleSharedPiUiRequest,
		} = usePiUiInteraction();
		const [composerModelSelections, setComposerModelSelections] = useState<
			Record<string, string>
		>({});
		const [composerEffortLevels, setComposerEffortLevels] = useState<
			Record<string, string>
		>({});
		const [composerPermissionModes, setComposerPermissionModes] = useState<
			Record<string, string>
		>({});
		const [composerFastModes, setComposerFastModes] = useState<
			Record<string, boolean>
		>({});
		const [internalDebugModes, setInternalDebugModes] = useState<
			Record<string, boolean>
		>({});
		const composerDebugModes = externalDebugModes ?? internalDebugModes;

		const composerContextKey = getComposerContextKey(
			displayedWorkspaceId,
			displayedSessionId,
		);
		const displayedSelectedModelId =
			composerModelSelections[composerContextKey] ?? null;
		const selectionPending =
			selectedWorkspaceId !== displayedWorkspaceId ||
			selectedSessionId !== displayedSessionId;

		// App-level follow-up queue. Survives session / workspace
		// switches because this container is mounted once in the App
		// tree (not keyed by session id).
		const { settings } = useSettings();
		const sessionsQuery = useQuery({
			...workspaceSessionsQueryOptions(displayedWorkspaceId ?? "__none__"),
			enabled: Boolean(displayedWorkspaceId),
		});
		const { queuesBySessionId, api: submitQueueApi } = useSubmitQueue();

		const handlePiUiRequest = useCallback(
			(event: Extract<AgentStreamEvent, { kind: "piUiRequest" }>) => {
				handleSharedPiUiRequest(event);
				onPiUiRequest?.(event);
			},
			[handleSharedPiUiRequest, onPiUiRequest],
		);

		const {
			activeSendError,
			handleComposerSubmit,
			handleDeferredToolResponse,
			handleElicitationResponse,
			handlePermissionResponse,
			handleStopStream,
			handleSteerQueued,
			handleRemoveQueued,
			elicitationResponsePending,
			isSending,
			pendingElicitation,
			pendingDeferredTool,
			pendingPermissions,
			restoreCustomTags,
			restoreDraft,
			restoreFiles,
			restoreImages,
			restoreNonce,
			activeFastPreludes,
			sendingSessionIds,
		} = useConversationStreaming({
			composerContextKey,
			displayedSelectedModelId,
			displayedSessionId,
			displayedWorkspaceId,
			repoId,
			selectionPending,
			followUpBehavior: settings.followUpBehavior,
			submitQueue: submitQueueApi,
			onSendingSessionsChange,
			onSendingWorkspacesChange,
			onInteractionSessionsChange,
			onSessionCompleted,
			onSessionAborted,
			buildSendRequestExtras,
			ensureDebugIngestForSubmit,
			onKanbanToolCall,
			onPiUiRequest: handlePiUiRequest,
		});

		const queueItems = displayedSessionId
			? (queuesBySessionId.get(displayedSessionId) ?? EMPTY_QUEUE)
			: EMPTY_QUEUE;

		// Derived from thread messages — survives refresh / session switch.
		const threadQuery = useQuery({
			...sessionThreadMessagesQueryOptions(displayedSessionId ?? "__none__"),
			enabled: Boolean(displayedSessionId),
		});
		const planReview = useMemo<PlanReviewPart | null>(
			() => getUnresolvedPlanReview(threadQuery.data ?? []),
			[threadQuery.data],
		);
		const hasPlanReview = planReview !== null;

		// Auto-activate plan button when AI enters plan mode on its own.
		const prevPlanReviewRef = useRef(false);
		useEffect(() => {
			if (hasPlanReview && !prevPlanReviewRef.current) {
				setComposerPermissionModes((current) => ({
					...current,
					[composerContextKey]: "plan",
				}));
			}
			prevPlanReviewRef.current = hasPlanReview;
		}, [hasPlanReview, composerContextKey]);

		const handleSelectModel = useCallback(
			(contextKey: string, modelId: string) => {
				setComposerModelSelections((current) => ({
					...current,
					[contextKey]: modelId,
				}));
			},
			[],
		);

		const handleSelectEffort = useCallback(
			(contextKey: string, level: string) => {
				setComposerEffortLevels((current) => ({
					...current,
					[contextKey]: level,
				}));
			},
			[],
		);

		const handleChangePermissionMode = useCallback(
			(contextKey: string, mode: string) => {
				setComposerPermissionModes((current) => ({
					...current,
					[contextKey]: mode,
				}));
			},
			[],
		);

		const handleChangeFastMode = useCallback(
			(contextKey: string, enabled: boolean) => {
				setComposerFastModes((current) => ({
					...current,
					[contextKey]: enabled,
				}));
			},
			[],
		);

		const handleChangeDebugMode = useCallback(
			(contextKey: string, enabled: boolean) => {
				if (onExternalChangeDebugMode) {
					onExternalChangeDebugMode(
						{ contextKey, workspaceId: displayedWorkspaceId },
						enabled,
					);
					return;
				}
				setInternalDebugModes((current) => ({
					...current,
					[contextKey]: enabled,
				}));
			},
			[displayedWorkspaceId, onExternalChangeDebugMode],
		);

		const handleImplementPlanInCleanThread = useCallback(
			async (plan: PlanReviewPart, modelId?: string | null) => {
				if (!displayedWorkspaceId || !onQueuePendingPromptForSession) return;
				const { sessionId } = await createSession(displayedWorkspaceId, {
					permissionMode: "bypassPermissions",
				});
				await queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceSessions(displayedWorkspaceId),
				});
				const planBody = plan.plan?.trim() || "No plan content.";
				const planPath = plan.planFilePath?.trim();
				const prompt = [
					"Implement this plan in a clean thread:",
					planPath ? `Plan file: ${planPath}` : null,
					planBody,
				]
					.filter(Boolean)
					.join("\n\n");

				onQueuePendingPromptForSession({
					sessionId,
					prompt,
					modelId: modelId ?? displayedSelectedModelId,
					permissionMode: "bypassPermissions",
				});
				onSelectSession(sessionId);
			},
			[
				displayedSelectedModelId,
				displayedWorkspaceId,
				onQueuePendingPromptForSession,
				onSelectSession,
				queryClient,
			],
		);

		const handleComposerSubmitWrapper = useCallback(
			(payload: Parameters<typeof handleComposerSubmit>[0]) => {
				void handleComposerSubmit(payload);
			},
			[handleComposerSubmit],
		);
		const relevantPendingInsertRequests = pendingInsertRequests.filter(
			(request) =>
				insertRequestMatchesComposer(request, {
					workspaceId: displayedWorkspaceId,
					sessionId: displayedSessionId,
				}),
		);

		// Permission requests are rendered through the same `GenericDeferredToolPanel`
		// as deferred-tool requests so both flows share one UI. Pick the head of the
		// queue (one-at-a-time, same as `pendingDeferredTool`) and adapt it. The
		// wrapped response handler routes callbacks back to the correct API.
		const headPendingPermission = pendingPermissions[0] ?? null;
		const permissionAsDeferredTool = useMemo(
			() =>
				headPendingPermission
					? adaptPermissionToDeferredTool(headPendingPermission)
					: null,
			[headPendingPermission],
		);

		const effectivePendingDeferredTool =
			pendingDeferredTool ?? permissionAsDeferredTool;

		const effectiveComposerAccessory =
			composerAccessory || piUiAccessory ? (
				<>
					{composerAccessory}
					{piUiAccessory}
				</>
			) : null;
		const selectedSession = sessionsQuery.data?.find(
			(session) => session.id === displayedSessionId,
		);
		const selectedInputPolicy = selectedSession?.inputPolicy ?? "writable";
		const hideComposerForMode =
			selectedSession?.surfaceKind === "terminal" ||
			selectedSession?.surfaceMode === "task_monitor" ||
			selectedInputPolicy === "read_only" ||
			selectedInputPolicy === "request_control";

		const effectiveDeferredToolResponse =
			useCallback<DeferredToolResponseHandler>(
				(deferred, behavior, options?: DeferredToolResponseOptions) => {
					const permissionId = permissionIdFromAdaptedToolUseId(
						deferred.toolUseId,
					);
					if (permissionId !== null) {
						handlePermissionResponse(
							permissionId,
							behavior,
							options?.reason ? { message: options.reason } : undefined,
						);
						return;
					}
					handleDeferredToolResponse(deferred, behavior, options);
				},
				[handlePermissionResponse, handleDeferredToolResponse],
			);

		return (
			<FileLinkProvider
				value={{
					openInEditor: onOpenFileReference,
					workspaceRootPath,
				}}
			>
				<WorkspacePanelContainer
					selectedWorkspaceId={selectedWorkspaceId}
					displayedWorkspaceId={displayedWorkspaceId}
					selectedSessionId={selectedSessionId}
					displayedSessionId={displayedSessionId}
					sessionSelectionHistory={sessionSelectionHistory}
					sending={isSending}
					sendingSessionIds={sendingSessionIds}
					interactionRequiredSessionIds={interactionRequiredSessionIds}
					modelSelections={composerModelSelections}
					workspaceChangeRequest={workspaceChangeRequest}
					onSelectSession={onSelectSession}
					onResolveDisplayedSession={onResolveDisplayedSession}
					onQueuePendingPromptForSession={onQueuePendingPromptForSession}
					onRequestCloseSession={onRequestCloseSession}
					headerActions={headerActions}
					headerLeading={headerLeading}
					compact={compact}
				/>

				{hideComposerForMode ? (
					<ModeStatusBar session={selectedSession} />
				) : (
					<div
						className={
							compact ? "mt-auto px-2.5 pb-2.5 pt-0" : "mt-auto px-4 pb-4 pt-0"
						}
					>
						<div>
							{effectiveComposerAccessory}
							<WorkspaceComposerContainer
								displayedWorkspaceId={displayedWorkspaceId}
								displayedSessionId={displayedSessionId}
								disabled={selectionPending}
								sending={isSending}
								sendError={activeSendError}
								restoreDraft={restoreDraft}
								restoreImages={restoreImages}
								restoreFiles={restoreFiles}
								restoreCustomTags={restoreCustomTags}
								restoreNonce={restoreNonce}
								pendingElicitation={pendingElicitation}
								onElicitationResponse={handleElicitationResponse}
								elicitationResponsePending={elicitationResponsePending}
								pendingDeferredTool={effectivePendingDeferredTool}
								onDeferredToolResponse={effectiveDeferredToolResponse}
								planReview={planReview}
								onImplementPlanInCleanThread={
									displayedWorkspaceId && onQueuePendingPromptForSession
										? handleImplementPlanInCleanThread
										: undefined
								}
								modelSelections={composerModelSelections}
								effortLevels={composerEffortLevels}
								permissionModes={composerPermissionModes}
								fastModes={composerFastModes}
								debugModes={composerDebugModes}
								activeFastPreludes={activeFastPreludes}
								onSelectModel={handleSelectModel}
								onSelectEffort={handleSelectEffort}
								onChangePermissionMode={handleChangePermissionMode}
								onChangeFastMode={handleChangeFastMode}
								onChangeDebugMode={handleChangeDebugMode}
								onSwitchSession={onSelectSession}
								onSubmit={handleComposerSubmitWrapper}
								onStop={handleStopStream}
								pendingPromptForSession={pendingPromptForSession}
								onPendingPromptConsumed={onPendingPromptConsumed}
								pendingInsertRequests={relevantPendingInsertRequests}
								onPendingInsertRequestsConsumed={
									onPendingInsertRequestsConsumed
								}
								queueItems={queueItems}
								onSteerQueued={handleSteerQueued}
								onRemoveQueued={handleRemoveQueued}
								modelFilter={modelFilter}
								hideToolbar={compact}
							/>
						</div>
					</div>
				)}
			</FileLinkProvider>
		);
	},
);

function ModeStatusBar({
	session,
}: {
	session?: {
		surfaceMode?: string;
		controlOwner?: string;
		agentType?: string | null;
	} | null;
}) {
	const label =
		session?.surfaceMode === "task_monitor"
			? "Task Monitor is read-only. Progress appears in the thread."
			: session?.surfaceMode === "agent_terminal"
				? `Agent Terminal controlled by ${session.agentType ?? session.controlOwner ?? "agent"}.`
				: "Terminal input is handled in the terminal surface.";
	return (
		<div className="mt-auto border-t bg-background/70 px-4 py-2 text-xs text-muted-foreground">
			{label}
		</div>
	);
}
