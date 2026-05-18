import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, ListTree, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkspaceConversationContainer } from "@/features/conversation";
import type {
	AgentModelOption,
	AgentStreamEvent,
	AssigneeSummary,
	WorkspaceDetail,
	WorkspaceSessionSummary,
} from "@/lib/api";
import {
	createGoalChildWorkspaceAndStart,
	deleteSession,
	getThreadRuntimeStatus,
	listAssignees,
	listGoalChildWorkspaces,
	loadSessionThreadMessages,
	loadWorkspaceForgeActionStatus,
	loadWorkspaceGitActionStatus,
	loadWorkspaceSessions,
	markWorkspaceLanded,
	mergeWorkspaceChangeRequest,
	pushWorkspaceToRemote,
	readAssigneeThread,
	reconcileWorkspaceLandingState,
	refreshWorkspaceChangeRequest,
	renameSession,
	sendAssigneeMessage,
	sendKanbanToolResult,
	sendThreadMessage,
	setCardAssigneeThread,
	setGoalChildWorkspaceStatus,
	summarizeAssigneeStatus,
	syncWorkspaceWithTargetBranch,
} from "@/lib/api";
import {
	agentModelSectionsQueryOptions,
	helmorQueryKeys,
} from "@/lib/query-client";
import { useSettings } from "@/lib/settings";
import { goalLaneForWorkspace, isMovableGoalLaneId } from "../board-model";
import {
	listGoalAssigneePiModels,
	resolveGoalAssigneePiHandoffModel,
} from "../pi-handoff-models";
import { AssigneesBar } from "./assignees-bar";
import { HistoryView } from "./history-view";
import { ThreadManagerView } from "./thread-manager-view";

type GoalsAiPanelProps = {
	workspaceId: string;
	/** Child workspaces shown as kanban cards. */
	cards: WorkspaceDetail[];
	/** Pre-serialised snapshot passed to the Pi agent as context. */
	kanbanSnapshot: string;
	goalTitle?: string | null;
	goalDescription?: string | null;
	canCreateCards?: boolean;
	onClose: () => void;
	/** Called when Pi creates a workspace card so the parent can select it. */
	onCardCreated?: (ws: WorkspaceDetail) => void;
	/** Reports the set of workspace IDs currently streaming (the goal workspace
	 *  ID itself) so the sidebar folder ring stays in sync. */
	onSendingWorkspacesChange?: (workspaceIds: Set<string>) => void;
	/** Assignees to display in the collapsible bar above the composer. */
	assignees?: AssigneeSummary[];
	/** Called when the user clicks an assignee to navigate to its workspace. */
	onSelectAssignee?: (ws: WorkspaceDetail) => void;
};

const piOnlyModelFilter = (model: AgentModelOption) => model.provider === "pi";

function resolveFavouritePiModelId(
	piModels: readonly AgentModelOption[],
	favouriteModelIds: readonly string[],
): string | null {
	if (favouriteModelIds.length === 0) return null;
	const favouriteSet = new Set(favouriteModelIds);
	return piModels.find((model) => favouriteSet.has(model.id))?.id ?? null;
}

function buildKanbanToolError(
	event: Extract<AgentStreamEvent, { kind: "kanbanToolCall" }>,
	error: unknown,
) {
	const args = event.args;
	const message = error instanceof Error ? error.message : String(error);
	return {
		tool: event.tool,
		toolCallId: event.toolCallId,
		workspaceId: event.workspaceId,
		cardTitle: typeof args.title === "string" ? args.title : null,
		cardId:
			typeof args.cardId === "string"
				? args.cardId
				: typeof args.card_id === "string"
					? args.card_id
					: null,
		message,
	};
}

export function GoalsAiPanel({
	workspaceId,
	cards,
	kanbanSnapshot,
	goalTitle,
	goalDescription,
	canCreateCards = true,
	onClose,
	onCardCreated,
	onSendingWorkspacesChange,
	assignees,
	onSelectAssignee,
}: GoalsAiPanelProps) {
	const queryClient = useQueryClient();
	const { settings } = useSettings();
	const modelSectionsQuery = useQuery(agentModelSectionsQueryOptions());
	const modelSections = useMemo(
		() => modelSectionsQuery.data ?? [],
		[modelSectionsQuery.data],
	);
	const piModels = useMemo(
		() => modelSections.find((section) => section.id === "pi")?.options ?? [],
		[modelSections],
	);
	const favouritePiModelId = useMemo(
		() => resolveFavouritePiModelId(piModels, settings.favoriteModelIds),
		[piModels, settings.favoriteModelIds],
	);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
		null,
	);
	const [displayedSessionId, setDisplayedSessionId] = useState<string | null>(
		null,
	);
	const [overlayMode, setOverlayMode] = useState<"history" | "threads" | null>(
		null,
	);

	// Reset session state when the workspace changes so stale session IDs from a
	// previously-viewed goal workspace don't bleed into the new one. Without this
	// reset, GoalWorkspaceContainer reuses the same component instance across
	// workspace switches (no key prop), which means selectedSessionId /
	// displayedSessionId kept pointing at the old workspace's Pi session. The
	// WorkspacePanelContainer then showed that stale session's messages (from
	// cache) with hasSession=false instead of showing the "no thread selected"
	// empty state or auto-resolving the new workspace's active session.
	useEffect(() => {
		setSelectedSessionId(null);
		setDisplayedSessionId(null);
		setOverlayMode(null);
	}, [workspaceId]);
	const kanbanMutationQueueRef = useRef<Promise<void>>(Promise.resolve());

	const handleSelectSession = useCallback((sessionId: string | null) => {
		setSelectedSessionId(sessionId);
		setDisplayedSessionId(sessionId);
	}, []);

	const enqueueKanbanMutation = useCallback(<T,>(fn: () => Promise<T>) => {
		const next = kanbanMutationQueueRef.current.then(fn, fn);
		kanbanMutationQueueRef.current = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}, []);

	const handleResolveDisplayedSession = useCallback(
		(sessionId: string | null) => {
			setDisplayedSessionId(sessionId);
			setSelectedSessionId(sessionId);
		},
		[],
	);

	const handleRestoreSession = useCallback(
		(session: WorkspaceSessionSummary) => {
			handleSelectSession(session.id);
			setOverlayMode(null);
		},
		[handleSelectSession],
	);

	const handleNewSession = useCallback(() => {
		handleSelectSession(null);
		setOverlayMode(null);
	}, [handleSelectSession]);

	const handleOpenManagedThread = useCallback(
		(_card: WorkspaceDetail, session: WorkspaceSessionSummary) => {
			handleSelectSession(session.id);
			setOverlayMode(null);
		},
		[handleSelectSession],
	);

	const overlayTitle =
		overlayMode === "threads" ? "Card assignees" : "Conversations";

	const handleKanbanToolCall = useCallback(
		async (event: Extract<AgentStreamEvent, { kind: "kanbanToolCall" }>) => {
			try {
				const args = event.args;
				let result: unknown;
				const invalidateBoard = () =>
					queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.goalChildWorkspaces(workspaceId),
					});

				if (event.tool === "list_kanban_cards") {
					const children = await listGoalChildWorkspaces(workspaceId);
					result = children.map((child) => ({
						...child,
						lane: goalLaneForWorkspace(child),
					}));
				} else if (event.tool === "list_assignee_models") {
					const assigneeModels = listGoalAssigneePiModels({
						modelSections,
						piModels,
						allowAllModels: settings.allowAllGoalAssigneePiModels,
					});
					result = {
						policy: settings.allowAllGoalAssigneePiModels
							? "all-goal-assignee-pi-providers"
							: "available-claude-and-codex-backed-pi-models",
						assigneeModels: assigneeModels.map((model) => ({
							id: model.id,
							label: model.label,
							cliModel: model.cliModel,
							providerKey: model.providerKey ?? null,
						})),
						claudeModels:
							modelSections.find((section) => section.id === "claude")
								?.options ?? [],
						codexModels:
							modelSections.find((section) => section.id === "codex")
								?.options ?? [],
					};
				} else if (event.tool === "create_kanban_card") {
					if (!canCreateCards) {
						throw new Error(
							"Goal setup must finish before Pi can create cards.",
						);
					}
					const requestedLane = String(args.lane ?? "backlog");
					if (!isMovableGoalLaneId(requestedLane)) {
						throw new Error(
							"Merged is derived from whether the child workspace has landed in the goal branch and cannot be set manually.",
						);
					}
					const requestedModelId =
						typeof args.assignedModelId === "string"
							? args.assignedModelId
							: typeof args.assigned_model_id === "string"
								? args.assigned_model_id
								: null;
					const handoffModel = resolveGoalAssigneePiHandoffModel({
						requestedModelId,
						modelSections,
						piModels,
						allowAllModels: settings.allowAllGoalAssigneePiModels,
					});
					if (
						typeof args.prompt === "string" &&
						args.prompt.trim() &&
						!handoffModel.assignedModelId
					) {
						throw new Error(
							requestedModelId
								? `The selected assignee model is not available: ${requestedModelId}. Call list_assignee_models and ask the user to choose one of the returned assigneeModels.`
								: "Choose an assignee model before starting work. Call list_assignee_models, show the returned assigneeModels to the user, ask which model to use, then pass assigned_model_id to create_kanban_card.",
						);
					}
					const { created, newWorkspace } = await enqueueKanbanMutation(
						async () => {
							const created = await createGoalChildWorkspaceAndStart({
								goalWorkspace: workspaceId,
								title: String(args.title ?? "Untitled"),
								description:
									typeof args.description === "string"
										? args.description
										: null,
								lane: requestedLane,
								targetBranch:
									typeof args.targetBranch === "string"
										? args.targetBranch
										: null,
								assignedProvider: handoffModel.assignedProvider,
								assignedModelId: handoffModel.assignedModelId,
								assignedEffortLevel:
									typeof args.assignedEffortLevel === "string"
										? args.assignedEffortLevel
										: null,
								prompt: typeof args.prompt === "string" ? args.prompt : null,
								permissionMode:
									typeof args.permissionMode === "string"
										? args.permissionMode
										: null,
								finalize: true,
							});
							await invalidateBoard();
							const children = await listGoalChildWorkspaces(workspaceId);
							const newWorkspace = children.find(
								(child) => child.id === created.workspaceId,
							);
							return { created, newWorkspace };
						},
					);
					if (newWorkspace) {
						onCardCreated?.(newWorkspace);
					}
					result = newWorkspace
						? { ...created, workspace: newWorkspace, handoffModel }
						: { ...created, handoffModel };
				} else if (event.tool === "move_kanban_card") {
					const childWorkspaceId = String(
						args.cardId ?? args.workspaceId ?? "",
					);
					const requestedLane = String(args.lane ?? "");
					if (!isMovableGoalLaneId(requestedLane)) {
						throw new Error(
							"Merged is derived from whether the child workspace has landed in the goal branch and cannot be set manually.",
						);
					}
					result = await enqueueKanbanMutation(async () => {
						await setGoalChildWorkspaceStatus(
							workspaceId,
							childWorkspaceId,
							requestedLane,
						);
						await invalidateBoard();
						return { workspaceId: childWorkspaceId, lane: requestedLane };
					});
				} else if (event.tool === "update_kanban_card") {
					result = await enqueueKanbanMutation(async () => {
						const childWorkspaceId = String(
							args.cardId ?? args.workspaceId ?? "",
						);
						if (args.title) {
							const sessions = await loadWorkspaceSessions(childWorkspaceId);
							const primary = sessions[0];
							if (primary) {
								await renameSession(primary.id, String(args.title));
							}
						}
						await invalidateBoard();
						return { workspaceId: childWorkspaceId };
					});
				} else if (event.tool === "list_threads") {
					result = await loadWorkspaceSessions(String(args.workspaceId));
				} else if (event.tool === "create_thread") {
					const { createSession } = await import("@/lib/api");
					const { sessionId } = await createSession(String(args.workspaceId));
					if (args.title) {
						await renameSession(sessionId, String(args.title));
					}
					result = { sessionId, workspaceId: args.workspaceId };
					await queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.workspaceSessions(
							String(args.workspaceId),
						),
					});
				} else if (event.tool === "get_thread") {
					result = await loadSessionThreadMessages(String(args.threadId));
				} else if (event.tool === "get_thread_runtime_status") {
					result = await getThreadRuntimeStatus({
						goalWorkspaceId: workspaceId,
						workspaceId: String(args.workspaceId ?? args.workspace_id ?? ""),
						threadId: String(args.threadId ?? args.thread_id ?? ""),
					});
				} else if (event.tool === "update_thread") {
					await renameSession(String(args.threadId), String(args.title));
					result = { threadId: args.threadId, title: args.title };
					await queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.workspaceSessions(
							String(args.workspaceId),
						),
					});
				} else if (event.tool === "delete_thread") {
					const workspaceRef = String(
						args.workspaceId ?? args.workspace_id ?? "",
					);
					const threadId = String(args.threadId ?? args.thread_id ?? "");
					await deleteSession(threadId);
					result = { threadId, workspaceId: workspaceRef, deleted: true };
					await queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.workspaceSessions(workspaceRef),
					});
				} else if (event.tool === "send_assignee_message") {
					const cardId = String(args.cardId ?? args.card_id ?? "");
					const message = String(args.message ?? "");
					result = await sendAssigneeMessage({
						goalWorkspaceId: workspaceId,
						cardId,
						message,
						priority: typeof args.priority === "string" ? args.priority : null,
						threadId:
							typeof args.threadId === "string"
								? args.threadId
								: typeof args.thread_id === "string"
									? args.thread_id
									: null,
					});
					await queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.workspaceSessions(cardId),
					});
				} else if (event.tool === "send_thread_message") {
					const workspaceRef = String(
						args.workspaceId ?? args.workspace_id ?? "",
					);
					result = await sendThreadMessage({
						goalWorkspaceId: workspaceId,
						workspaceId: workspaceRef,
						threadId: String(args.threadId ?? args.thread_id ?? ""),
						message: String(args.message ?? ""),
						priority: typeof args.priority === "string" ? args.priority : null,
						modelId: null,
						permissionMode:
							typeof args.permissionMode === "string"
								? args.permissionMode
								: typeof args.permission_mode === "string"
									? args.permission_mode
									: null,
					});
					await queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.workspaceSessions(workspaceRef),
					});
				} else if (event.tool === "set_card_assignee_thread") {
					const cardId = String(args.cardId ?? args.card_id ?? "");
					result = await enqueueKanbanMutation(async () => {
						const result = await setCardAssigneeThread({
							goalWorkspaceId: workspaceId,
							cardId,
							threadId: String(args.threadId ?? args.thread_id ?? ""),
							reason: typeof args.reason === "string" ? args.reason : null,
							supersedesThreadId:
								typeof args.supersedesThreadId === "string"
									? args.supersedesThreadId
									: typeof args.supersedes_thread_id === "string"
										? args.supersedes_thread_id
										: null,
						});
						await queryClient.invalidateQueries({
							queryKey: helmorQueryKeys.workspaceSessions(cardId),
						});
						return result;
					});
				} else if (event.tool === "read_assignee_thread") {
					result = await readAssigneeThread({
						goalWorkspaceId: workspaceId,
						cardId: String(args.cardId ?? args.card_id ?? ""),
						threadId:
							typeof args.threadId === "string"
								? args.threadId
								: typeof args.thread_id === "string"
									? args.thread_id
									: null,
						sinceMessageId:
							typeof args.sinceMessageId === "string"
								? args.sinceMessageId
								: typeof args.since_message_id === "string"
									? args.since_message_id
									: null,
					});
				} else if (event.tool === "summarize_assignee_status") {
					result = await summarizeAssigneeStatus(
						workspaceId,
						String(args.cardId ?? args.card_id ?? ""),
					);
				} else if (event.tool === "list_assignees") {
					result = await listAssignees(
						workspaceId,
						typeof args.status === "string" ? args.status : null,
					);
				} else if (event.tool === "inspect_workspace_merge_state") {
					const cardId = String(args.cardId ?? args.card_id ?? "");
					const [gitStatus, forgeStatus, changeRequest, landing] =
						await Promise.all([
							loadWorkspaceGitActionStatus(cardId),
							loadWorkspaceForgeActionStatus(cardId),
							refreshWorkspaceChangeRequest(cardId),
							reconcileWorkspaceLandingState(cardId),
						]);
					await invalidateBoard();
					result = {
						workspaceId: cardId,
						gitStatus,
						forgeStatus,
						changeRequest,
						landing,
					};
				} else if (event.tool === "refresh_change_request") {
					const cardId = String(args.cardId ?? args.card_id ?? "");
					result = await refreshWorkspaceChangeRequest(cardId);
					await invalidateBoard();
				} else if (event.tool === "sync_workspace_target_branch") {
					const cardId = String(args.cardId ?? args.card_id ?? "");
					result = await syncWorkspaceWithTargetBranch(cardId);
					await invalidateBoard();
				} else if (event.tool === "push_workspace_branch") {
					const cardId = String(args.cardId ?? args.card_id ?? "");
					result = await pushWorkspaceToRemote(cardId);
					await invalidateBoard();
				} else if (event.tool === "merge_change_request") {
					const cardId = String(args.cardId ?? args.card_id ?? "");
					result = await enqueueKanbanMutation(async () => {
						const changeRequest = await mergeWorkspaceChangeRequest(cardId);
						await invalidateBoard();
						return changeRequest;
					});
				} else if (event.tool === "check_workspace_landed") {
					const cardId = String(args.cardId ?? args.card_id ?? "");
					result = await reconcileWorkspaceLandingState(cardId);
					await invalidateBoard();
				} else if (event.tool === "mark_workspace_landed") {
					const cardId = String(args.cardId ?? args.card_id ?? "");
					result = await enqueueKanbanMutation(async () => {
						const landing = await markWorkspaceLanded(cardId);
						await invalidateBoard();
						return landing;
					});
				} else {
					throw new Error(`Unknown Pi tool: ${event.tool}`);
				}

				await sendKanbanToolResult(event.toolCallId, result);
			} catch (error) {
				await sendKanbanToolResult(
					event.toolCallId,
					buildKanbanToolError(event, error),
					true,
				);
			}
		},
		[
			workspaceId,
			queryClient,
			onCardCreated,
			canCreateCards,
			modelSections,
			piModels,
			settings.allowAllGoalAssigneePiModels,
			enqueueKanbanMutation,
		],
	);

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<WorkspaceConversationContainer
				selectedWorkspaceId={workspaceId}
				displayedWorkspaceId={workspaceId}
				selectedSessionId={selectedSessionId}
				displayedSessionId={displayedSessionId}
				onSelectSession={handleSelectSession}
				onResolveDisplayedSession={handleResolveDisplayedSession}
				onSendingWorkspacesChange={onSendingWorkspacesChange}
				modelFilter={piOnlyModelFilter}
				preferredDefaultModelId={favouritePiModelId}
				buildSendRequestExtras={() => {
					return {
						kanbanWorkspaceId: workspaceId,
						kanbanSnapshot,
						goalTitle: goalTitle ?? null,
						goalDescription: goalDescription ?? null,
					};
				}}
				onKanbanToolCall={handleKanbanToolCall}
				composerAccessory={
					assignees && assignees.length > 0 ? (
						<AssigneesBar
							assignees={assignees}
							cards={cards}
							onSelectAssignee={onSelectAssignee}
						/>
					) : undefined
				}
				compact
				headerLeading={
					<span className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground/70">
						Pi
					</span>
				}
				headerActions={
					<>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-7 cursor-pointer"
							onClick={() => setOverlayMode("threads")}
							aria-label="Manage card assignees"
						>
							<ListTree className="size-3.5" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-7 cursor-pointer"
							onClick={() => setOverlayMode("history")}
							aria-label="View conversation history"
						>
							<History className="size-3.5" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-7 cursor-pointer"
							onClick={onClose}
							aria-label="Close Pi panel"
						>
							<X className="size-3.5" />
						</Button>
					</>
				}
			/>
			{overlayMode && (
				<div className="absolute inset-0 z-10 flex flex-col bg-background">
					<div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
						<span className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground/70">
							{overlayTitle}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-7 cursor-pointer"
							onClick={() => setOverlayMode(null)}
							aria-label="Back to conversation"
						>
							<X className="size-3.5" />
						</Button>
					</div>
					{overlayMode === "threads" ? (
						<ThreadManagerView
							goalWorkspaceId={workspaceId}
							cards={cards}
							onOpenThread={handleOpenManagedThread}
						/>
					) : (
						<HistoryView
							workspaceId={workspaceId}
							activeSessionId={displayedSessionId}
							onRestore={handleRestoreSession}
							onNewSession={handleNewSession}
						/>
					)}
				</div>
			)}
		</div>
	);
}
