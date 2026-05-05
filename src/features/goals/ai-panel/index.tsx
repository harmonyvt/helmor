import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkspaceConversationContainer } from "@/features/conversation";
import type {
	AgentModelOption,
	AgentStreamEvent,
	WorkspaceDetail,
	WorkspaceStatus,
} from "@/lib/api";
import {
	createGoalChildWorkspace,
	finalizeWorkspaceFromRepo,
	listGoalChildWorkspaces,
	loadSessionThreadMessages,
	loadWorkspaceSessions,
	renameSession,
	respondToPiUi,
	sendKanbanToolResult,
	setGoalChildWorkspaceStatus,
} from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import { PiConfirmCard, PiInputCard, PiSelectCard } from "./pi-ui-cards";
import type { PiUiState } from "./types";

type GoalsAiPanelProps = {
	workspaceId: string;
	/** Child workspaces shown as kanban cards. */
	cards: WorkspaceDetail[];
	/** Pre-serialised snapshot passed to the Pi agent as context. */
	kanbanSnapshot: string;
	goalTitle?: string | null;
	goalDescription?: string | null;
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
	const [piUiState, setPiUiState] = useState<PiUiState>(null);
	const [inputAnswer, setInputAnswer] = useState("");

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
					const prepared = await createGoalChildWorkspace({
						goalWorkspaceId: workspaceId,
						title: String(args.title ?? "Untitled"),
					});
					await finalizeWorkspaceFromRepo(prepared.workspaceId, {
						...(prepared.sourceStartBranch
							? {
									startBranch: prepared.sourceStartBranch,
									fetchStartBranch: true,
								}
							: {}),
					});
					await invalidateBoard();
					const children = await listGoalChildWorkspaces(workspaceId);
					const newWorkspace = children.find(
						(child) => child.id === prepared.workspaceId,
					);
					if (newWorkspace) {
						onCardCreated?.(newWorkspace);
					}
					result = newWorkspace ?? { workspaceId: prepared.workspaceId };
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
		[workspaceId, queryClient, onCardCreated],
	);

	const handlePiUiRequest = useCallback(
		(event: Extract<AgentStreamEvent, { kind: "piUiRequest" }>) => {
			const payload = event.payload;
			if (event.uiKind === "select") {
				setPiUiState({
					type: "select",
					interactionId: event.interactionId,
					title: String(payload.title ?? "Select an option"),
					options: Array.isArray(payload.options)
						? payload.options.map(String)
						: [],
				});
			} else if (event.uiKind === "confirm") {
				setPiUiState({
					type: "confirm",
					interactionId: event.interactionId,
					title: String(payload.title ?? "Confirm"),
					message: String(payload.message ?? ""),
				});
			} else if (event.uiKind === "input") {
				setInputAnswer("");
				setPiUiState({
					type: "input",
					interactionId: event.interactionId,
					title: String(payload.title ?? "Enter text"),
					placeholder: String(payload.placeholder ?? ""),
				});
			}
		},
		[],
	);

	const handleSelect = useCallback(
		async (option: string) => {
			if (!piUiState || piUiState.type !== "select") return;
			const { interactionId } = piUiState;
			setPiUiState(null);
			await respondToPiUi(interactionId, option);
		},
		[piUiState],
	);

	const handleConfirm = useCallback(
		async (confirmed: boolean) => {
			if (!piUiState || piUiState.type !== "confirm") return;
			const { interactionId } = piUiState;
			setPiUiState(null);
			await respondToPiUi(interactionId, confirmed);
		},
		[piUiState],
	);

	const handleInput = useCallback(async () => {
		if (!piUiState || piUiState.type !== "input") return;
		const { interactionId } = piUiState;
		const value = inputAnswer.trim();
		setPiUiState(null);
		setInputAnswer("");
		await respondToPiUi(interactionId, value || null);
	}, [piUiState, inputAnswer]);

	const handleInputCancel = useCallback(async () => {
		if (!piUiState || piUiState.type !== "input") return;
		const { interactionId } = piUiState;
		setPiUiState(null);
		setInputAnswer("");
		await respondToPiUi(interactionId, null);
	}, [piUiState]);

	const composerAccessory = useMemo(() => {
		if (!piUiState) return null;

		return (
			<div className="mb-3">
				{piUiState.type === "select" && (
					<PiSelectCard state={piUiState} onSelect={handleSelect} />
				)}
				{piUiState.type === "confirm" && (
					<PiConfirmCard state={piUiState} onConfirm={handleConfirm} />
				)}
				{piUiState.type === "input" && (
					<PiInputCard
						state={piUiState}
						value={inputAnswer}
						onChange={setInputAnswer}
						onSubmit={handleInput}
						onCancel={handleInputCancel}
					/>
				)}
			</div>
		);
	}, [
		piUiState,
		handleSelect,
		handleConfirm,
		inputAnswer,
		handleInput,
		handleInputCancel,
	]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
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
				onPiUiRequest={handlePiUiRequest}
				composerAccessory={composerAccessory}
				compact={true}
				headerLeading={
					<span className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground/70">
						Pi
					</span>
				}
				headerActions={
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
				}
			/>
		</div>
	);
}
