import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, ListTree, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
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
	loadWorkspaceSessions,
	readAssigneeThread,
	renameSession,
	sendAssigneeMessage,
	sendKanbanToolResult,
	sendThreadMessage,
	setCardAssigneeThread,
	setGoalChildWorkspaceStatus,
	summarizeAssigneeStatus,
} from "@/lib/api";
import {
	agentModelSectionsQueryOptions,
	helmorQueryKeys,
} from "@/lib/query-client";
import { goalLaneForWorkspace, isMovableGoalLaneId } from "../board-model";
import { canonicalPiModelId } from "../pi-handoff-models";
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
	const modelSectionsQuery = useQuery(agentModelSectionsQueryOptions());
	const piModels = useMemo(
		() =>
			modelSectionsQuery.data?.find((section) => section.id === "pi")
				?.options ?? [],
		[modelSectionsQuery.data],
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
	const activeSupervisorModelIdRef = useRef<string | null>(null);
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
		overlayMode === "threads" ? "Goal threads" : "Conversations";

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
				} else if (event.tool === "create_kanban_card") {
					if (!canCreateCards) {
						throw new Error(
							"Goal setup must finish before Pi can create cards.",
						);
					}
					const requestedLane = String(args.lane ?? "backlog");
					if (!isMovableGoalLaneId(requestedLane)) {
						throw new Error(
							"Merged is derived from PR state and cannot be set manually.",
						);
					}
					const requestedModelId =
						typeof args.assignedModelId === "string"
							? args.assignedModelId
							: null;
					const assignedModelId =
						activeSupervisorModelIdRef.current ??
						(requestedModelId
							? canonicalPiModelId(requestedModelId, piModels)
							: null);
					const handoffModel = {
						assignedProvider: "pi",
						assignedModelId,
						requestedModelId,
						resolvedModelId: assignedModelId,
						fallbackUsed: false,
						policyApplied: false,
						allowedModelIds: assignedModelId ? [assignedModelId] : [],
						suggestedModelIds: assignedModelId ? [assignedModelId] : [],
					};
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
							"Merged is derived from PR state and cannot be set manually.",
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
						modelId: activeSupervisorModelIdRef.current,
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
			piModels,
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
				buildSendRequestExtras={({ model }) => {
					activeSupervisorModelIdRef.current = model.id;
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
							aria-label="Manage goal card threads"
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
