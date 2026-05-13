import { useQueryClient } from "@tanstack/react-query";
import { History, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkspaceConversationContainer } from "@/features/conversation";
import type {
	AgentModelOption,
	AgentStreamEvent,
	WorkspaceDetail,
	WorkspaceSessionSummary,
	WorkspaceStatus,
} from "@/lib/api";
import {
	createGoalChildWorkspaceAndStart,
	listAssignees,
	listGoalChildWorkspaces,
	loadSessionThreadMessages,
	loadWorkspaceSessions,
	readAssigneeThread,
	renameSession,
	sendAssigneeMessage,
	sendKanbanToolResult,
	setGoalChildWorkspaceStatus,
	summarizeAssigneeStatus,
} from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import { HistoryView } from "./history-view";

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
};

const piOnlyModelFilter = (model: AgentModelOption) => model.provider === "pi";

export function GoalsAiPanel({
	workspaceId,
	cards: _cards,
	kanbanSnapshot,
	goalTitle,
	goalDescription,
	canCreateCards = true,
	onClose,
	onCardCreated,
}: GoalsAiPanelProps) {
	const queryClient = useQueryClient();
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
		null,
	);
	const [displayedSessionId, setDisplayedSessionId] = useState<string | null>(
		null,
	);
	const [showHistory, setShowHistory] = useState(false);

	const handleSelectSession = useCallback((sessionId: string | null) => {
		setSelectedSessionId(sessionId);
		setDisplayedSessionId(sessionId);
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
			setShowHistory(false);
		},
		[handleSelectSession],
	);

	const handleNewSession = useCallback(() => {
		handleSelectSession(null);
		setShowHistory(false);
	}, [handleSelectSession]);

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
					result = await listGoalChildWorkspaces(workspaceId);
				} else if (event.tool === "create_kanban_card") {
					if (!canCreateCards) {
						throw new Error(
							"Goal setup must finish before Pi can create cards.",
						);
					}
					const created = await createGoalChildWorkspaceAndStart({
						goalWorkspace: workspaceId,
						title: String(args.title ?? "Untitled"),
						description:
							typeof args.description === "string" ? args.description : null,
						lane: String(args.lane ?? "backlog") as WorkspaceStatus,
						targetBranch:
							typeof args.targetBranch === "string" ? args.targetBranch : null,
						assignedProvider:
							typeof args.assignedProvider === "string"
								? args.assignedProvider
								: null,
						assignedModelId:
							typeof args.assignedModelId === "string"
								? args.assignedModelId
								: null,
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
					if (newWorkspace) {
						onCardCreated?.(newWorkspace);
					}
					result = newWorkspace
						? { ...created, workspace: newWorkspace }
						: created;
				} else if (event.tool === "move_kanban_card") {
					const childWorkspaceId = String(
						args.cardId ?? args.workspaceId ?? "",
					);
					await setGoalChildWorkspaceStatus(
						workspaceId,
						childWorkspaceId,
						String(args.lane) as WorkspaceStatus,
					);
					await invalidateBoard();
					result = { workspaceId: childWorkspaceId, lane: args.lane };
				} else if (event.tool === "update_kanban_card") {
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
					result = { workspaceId: childWorkspaceId };
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
				} else if (event.tool === "update_thread") {
					await renameSession(String(args.threadId), String(args.title));
					result = { threadId: args.threadId, title: args.title };
					await queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.workspaceSessions(
							String(args.workspaceId),
						),
					});
				} else if (event.tool === "send_assignee_message") {
					const cardId = String(args.cardId ?? args.card_id ?? "");
					const message = String(args.message ?? "");
					result = await sendAssigneeMessage({
						goalWorkspaceId: workspaceId,
						cardId,
						message,
						priority: typeof args.priority === "string" ? args.priority : null,
					});
					await queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.workspaceSessions(cardId),
					});
				} else if (event.tool === "read_assignee_thread") {
					result = await readAssigneeThread({
						goalWorkspaceId: workspaceId,
						cardId: String(args.cardId ?? args.card_id ?? ""),
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
					String(error instanceof Error ? error.message : error),
					true,
				);
			}
		},
		[workspaceId, queryClient, onCardCreated, canCreateCards],
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
				modelFilter={piOnlyModelFilter}
				buildSendRequestExtras={() => ({
					kanbanWorkspaceId: workspaceId,
					kanbanSnapshot,
					goalTitle: goalTitle ?? null,
					goalDescription: goalDescription ?? null,
				})}
				onKanbanToolCall={handleKanbanToolCall}
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
							onClick={() => setShowHistory(true)}
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
			{showHistory && (
				<div className="absolute inset-0 z-10 flex flex-col bg-background">
					<div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
						<span className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground/70">
							Conversations
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-7 cursor-pointer"
							onClick={() => setShowHistory(false)}
							aria-label="Back to conversation"
						>
							<X className="size-3.5" />
						</Button>
					</div>
					<HistoryView
						workspaceId={workspaceId}
						activeSessionId={displayedSessionId}
						onRestore={handleRestoreSession}
						onNewSession={handleNewSession}
					/>
				</div>
			)}
		</div>
	);
}
