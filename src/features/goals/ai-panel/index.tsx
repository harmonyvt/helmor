/**
 * Goals AI Panel — Pi-powered Kanban assistant.
 *
 * Orchestrates session lifecycle, streaming, kanban tool execution, and
 * Pi interactive UI round-trips. Rendering is delegated to sub-modules:
 *   - MessageFeed  — scrollable thread with content-typed parts
 *   - ContentParts — thinking / tool-call / text / notice renderers
 *   - Composer     — text input + send
 *   - HistoryView  — past Pi sessions
 *   - Pi*Card      — select / confirm / input UI cards
 */

import { useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Bot,
	ChevronDown,
	Clock,
	Plus,
	Star,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type AgentModelOption,
	checkPiModels,
	createSession,
	listGoalChildWorkspaces,
	loadSessionThreadMessages,
	loadWorkspaceSessions,
	renameSession,
	respondToPiUi,
	sendKanbanToolResult,
	setWorkspaceStatus,
	startAgentMessageStream,
	type ThreadMessageLike,
	type WorkspaceDetail,
	type WorkspaceSessionSummary,
	type WorkspaceStatus,
} from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { HistoryView } from "./history-view";
import { MessageFeed } from "./message-feed";
import { PiConfirmCard, PiInputCard, PiSelectCard } from "./pi-ui-cards";
import type { PiUiState, View } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAV_MODEL_KEY = "helmor.pi.favModel";
const DEFAULT_MODEL_ID = "pi:anthropic/claude-opus-4-7";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

export function GoalsAiPanel({
	workspaceId,
	kanbanSnapshot,
	goalTitle,
	goalDescription,
	onClose,
	onCardCreated,
}: GoalsAiPanelProps) {
	const queryClient = useQueryClient();

	// ── Model state ──────────────────────────────────────────────────────────
	const [models, setModels] = useState<AgentModelOption[]>([]);
	const [selectedModelId, setSelectedModelId] = useState<string>(
		() => localStorage.getItem(FAV_MODEL_KEY) ?? DEFAULT_MODEL_ID,
	);
	const [favModelId, setFavModelId] = useState<string>(
		() => localStorage.getItem(FAV_MODEL_KEY) ?? "",
	);

	useEffect(() => {
		checkPiModels()
			.then((res) => {
				if (res.models.length > 0) {
					setModels(res.models);
					const saved = localStorage.getItem(FAV_MODEL_KEY);
					if (saved && res.models.some((m) => m.id === saved)) {
						setSelectedModelId(saved);
					} else {
						setSelectedModelId(res.models[0].id);
					}
				}
			})
			.catch(() => {
				/* Non-fatal */
			});
	}, []);

	const toggleFavourite = useCallback(
		(modelId: string) => {
			const next = favModelId === modelId ? "" : modelId;
			setFavModelId(next);
			if (next) localStorage.setItem(FAV_MODEL_KEY, next);
			else localStorage.removeItem(FAV_MODEL_KEY);
		},
		[favModelId],
	);

	// ── Session state ────────────────────────────────────────────────────────
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
	const [streaming, setStreaming] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [piUiState, setPiUiState] = useState<PiUiState>(null);
	const [inputAnswer, setInputAnswer] = useState("");

	// ── View state ───────────────────────────────────────────────────────────
	const [view, setView] = useState<View>("chat");

	// Text area ref forwarded to Composer via callback ref workaround.
	const textareaFocusCb = useRef<(() => void) | null>(null);

	// Create a fresh session on mount.
	useEffect(() => {
		let cancelled = false;
		createSession(workspaceId).then((res) => {
			if (!cancelled) setSessionId(res.sessionId);
		});
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	// ── Pi tool execution ────────────────────────────────────────────────────
	//
	// All Pi custom tools (kanban + thread) ride the same kanban_tool_call /
	// kanbanToolResult round-trip. We route by tool name.
	const executeKanbanTool = useCallback(
		async (
			toolCallId: string,
			tool: string,
			args: Record<string, unknown>,
		): Promise<void> => {
			try {
				let result: unknown;
				const invalidateBoard = () =>
					queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.goalChildWorkspaces(workspaceId),
					});

				// ── Kanban tools (workspace-based) ────────────────────────────────
				if (tool === "list_kanban_cards") {
					result = await listGoalChildWorkspaces(workspaceId);
				} else if (tool === "create_kanban_card") {
					// Pi creates a card → spin up a real child workspace.
					const { createGoalChildWorkspace, finalizeWorkspaceFromRepo } =
						await import("@/lib/api");
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
					// Let the parent know so it can select the new card.
					const children = await listGoalChildWorkspaces(workspaceId);
					const newWs = children.find((c) => c.id === prepared.workspaceId);
					if (newWs) onCardCreated?.(newWs);
					result = newWs ?? { workspaceId: prepared.workspaceId };
				} else if (tool === "move_kanban_card") {
					const wsId = String(args.cardId ?? args.workspaceId ?? "");
					await setWorkspaceStatus(wsId, String(args.lane) as WorkspaceStatus);
					await invalidateBoard();
					result = { workspaceId: wsId, lane: args.lane };
				} else if (tool === "update_kanban_card") {
					// Title update — rename the workspace's primary session title.
					// (Workspace titles are derived; best effort via renameSession.)
					const wsId = String(args.cardId ?? args.workspaceId ?? "");
					if (args.title) {
						const sessions = await loadWorkspaceSessions(wsId);
						const primary = sessions[0];
						if (primary) await renameSession(primary.id, String(args.title));
					}
					await invalidateBoard();
					result = { workspaceId: wsId };

					// ── Thread tools ──────────────────────────────────────────────────
				} else if (tool === "list_threads") {
					result = await loadWorkspaceSessions(String(args.workspaceId));
				} else if (tool === "create_thread") {
					const { sessionId: newSessionId } = await createSession(
						String(args.workspaceId),
					);
					if (args.title) {
						await renameSession(newSessionId, String(args.title));
					}
					result = { sessionId: newSessionId, workspaceId: args.workspaceId };
					await queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.workspaceSessions(
							String(args.workspaceId),
						),
					});
				} else if (tool === "get_thread") {
					result = await loadSessionThreadMessages(String(args.threadId));
				} else if (tool === "update_thread") {
					await renameSession(String(args.threadId), String(args.title));
					result = { threadId: args.threadId, title: args.title };
					await queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.workspaceSessions(
							String(args.workspaceId),
						),
					});
				} else {
					throw new Error(`Unknown Pi tool: ${tool}`);
				}

				await sendKanbanToolResult(toolCallId, result);
			} catch (err) {
				await sendKanbanToolResult(
					toolCallId,
					String(err instanceof Error ? err.message : err),
					true,
				);
			}
		},
		[workspaceId, queryClient, onCardCreated],
	);

	// ── Send message ─────────────────────────────────────────────────────────
	const send = useCallback(async () => {
		if (!sessionId || !prompt.trim() || streaming) return;
		const text = prompt.trim();
		setPrompt("");
		setStreaming(true);

		try {
			await startAgentMessageStream(
				{
					provider: "pi",
					modelId: selectedModelId,
					prompt: text,
					helmorSessionId: sessionId,
					workingDirectory: null,
					kanbanWorkspaceId: workspaceId,
					kanbanSnapshot,
					goalTitle: goalTitle ?? null,
					goalDescription: goalDescription ?? null,
					images: [],
				},
				(event) => {
					if (event.kind === "update") {
						setMessages(event.messages);
					} else if (event.kind === "streamingPartial") {
						setMessages((prev) => {
							const last = prev[prev.length - 1];
							if (last?.id === event.message.id) {
								return [...prev.slice(0, -1), event.message];
							}
							return [...prev, event.message];
						});
					} else if (event.kind === "kanbanToolCall") {
						void executeKanbanTool(event.toolCallId, event.tool, event.args);
					} else if (event.kind === "piUiRequest") {
						const p = event.payload as Record<string, unknown>;
						if (event.uiKind === "select") {
							setPiUiState({
								type: "select",
								interactionId: event.interactionId,
								title: String(p.title ?? "Select an option"),
								options: Array.isArray(p.options)
									? (p.options as string[])
									: [],
							});
						} else if (event.uiKind === "confirm") {
							setPiUiState({
								type: "confirm",
								interactionId: event.interactionId,
								title: String(p.title ?? "Confirm"),
								message: String(p.message ?? ""),
							});
						} else if (event.uiKind === "input") {
							setInputAnswer("");
							setPiUiState({
								type: "input",
								interactionId: event.interactionId,
								title: String(p.title ?? "Enter text"),
								placeholder: String(p.placeholder ?? ""),
							});
						}
					} else if (event.kind === "done" || event.kind === "aborted") {
						setStreaming(false);
						queryClient.invalidateQueries({
							queryKey: helmorQueryKeys.workspaceSessions(workspaceId),
						});
					} else if (event.kind === "error") {
						setStreaming(false);
					}
				},
			);
		} catch {
			setStreaming(false);
		}
	}, [
		sessionId,
		prompt,
		streaming,
		kanbanSnapshot,
		workspaceId,
		selectedModelId,
		executeKanbanTool,
		queryClient,
		goalTitle,
		goalDescription,
	]);

	// ── Pi UI handlers ───────────────────────────────────────────────────────
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

	// ── Session management ───────────────────────────────────────────────────
	const newSession = useCallback(async () => {
		if (streaming) return;
		setMessages([]);
		setPiUiState(null);
		const res = await createSession(workspaceId);
		setSessionId(res.sessionId);
		setView("chat");
		textareaFocusCb.current?.();
	}, [workspaceId, streaming]);

	const restoreSession = useCallback(
		async (session: WorkspaceSessionSummary) => {
			if (streaming) return;
			setMessages([]);
			setPiUiState(null);
			const msgs = await loadSessionThreadMessages(session.id);
			setMessages(msgs);
			setSessionId(session.id);
			setView("chat");
		},
		[streaming],
	);

	// ── Derived ──────────────────────────────────────────────────────────────
	const selectedModel = models.find((m) => m.id === selectedModelId);
	const selectedModelLabel =
		selectedModel?.label ??
		selectedModelId.replace(/^pi:/, "").split("/").pop() ??
		"Pi";
	const selectedModelProvider = selectedModel?.providerKey ?? null;

	// ── Render ───────────────────────────────────────────────────────────────
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* Header */}
			<PanelHeader
				view={view}
				models={models}
				selectedModelId={selectedModelId}
				selectedModelLabel={selectedModelLabel}
				selectedModelProvider={selectedModelProvider}
				favModelId={favModelId}
				streaming={streaming}
				onSelectModel={setSelectedModelId}
				onToggleFavourite={toggleFavourite}
				onNewSession={newSession}
				onShowHistory={() => setView("history")}
				onBackToChat={() => setView("chat")}
				onClose={onClose}
			/>

			{/* Body */}
			{view === "history" ? (
				<HistoryView
					workspaceId={workspaceId}
					activeSessionId={sessionId}
					onRestore={restoreSession}
					onNewSession={newSession}
				/>
			) : (
				<>
					<MessageFeed messages={messages} streaming={streaming && !piUiState}>
						{piUiState?.type === "select" && (
							<PiSelectCard state={piUiState} onSelect={handleSelect} />
						)}
						{piUiState?.type === "confirm" && (
							<PiConfirmCard state={piUiState} onConfirm={handleConfirm} />
						)}
						{piUiState?.type === "input" && (
							<PiInputCard
								state={piUiState}
								value={inputAnswer}
								onChange={setInputAnswer}
								onSubmit={handleInput}
								onCancel={handleInputCancel}
							/>
						)}
					</MessageFeed>

					<Composer
						value={prompt}
						onChange={setPrompt}
						onSend={() => void send()}
						disabled={streaming}
						streaming={streaming}
						sessionReady={!!sessionId}
					/>
				</>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Panel header
// ---------------------------------------------------------------------------

type PanelHeaderProps = {
	view: View;
	models: AgentModelOption[];
	selectedModelId: string;
	selectedModelLabel: string;
	selectedModelProvider: string | null;
	favModelId: string;
	streaming: boolean;
	onSelectModel: (id: string) => void;
	onToggleFavourite: (id: string) => void;
	onNewSession: () => void;
	onShowHistory: () => void;
	onBackToChat: () => void;
	onClose: () => void;
};

function PanelHeader({
	view,
	models,
	selectedModelId,
	selectedModelLabel,
	selectedModelProvider,
	favModelId,
	streaming,
	onSelectModel,
	onToggleFavourite,
	onNewSession,
	onShowHistory,
	onBackToChat,
	onClose,
}: PanelHeaderProps) {
	const fallbackModels: AgentModelOption[] =
		models.length > 0
			? models
			: [
					{
						id: DEFAULT_MODEL_ID,
						label: "claude-opus-4-7",
						provider: "pi" as const,
						cliModel: DEFAULT_MODEL_ID,
						providerKey: "anthropic",
					},
				];

	return (
		<div className="flex shrink-0 items-center justify-between border-b border-border/60 px-2 py-1.5">
			{/* Left side */}
			<div className="flex min-w-0 items-center gap-1">
				{view === "history" ? (
					<Button
						variant="ghost"
						size="icon"
						className="size-6 shrink-0 cursor-pointer"
						onClick={onBackToChat}
						title="Back to chat"
					>
						<ArrowLeft className="size-3.5" />
					</Button>
				) : (
					<Bot
						className="size-3.5 shrink-0 text-muted-foreground/60"
						strokeWidth={1.8}
					/>
				)}

				{view === "chat" ? (
					<>
						{/* Model picker */}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className="flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-muted/60"
									title="Select Pi model"
								>
									<div className="flex flex-col items-start leading-none">
										<span className="max-w-[96px] truncate text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
											{selectedModelLabel}
										</span>
										{selectedModelProvider && (
											<span className="text-[9px] uppercase tracking-wide text-muted-foreground/40">
												{selectedModelProvider}
											</span>
										)}
									</div>
									<ChevronDown className="size-2.5 shrink-0 opacity-50" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="min-w-[200px]">
								{fallbackModels.map((m) => (
									<DropdownMenuItem
										key={m.id}
										className="flex cursor-pointer items-center justify-between gap-2"
										onClick={() => onSelectModel(m.id)}
									>
										<div className="flex min-w-0 flex-col leading-none">
											<span
												className={cn(
													"truncate text-[12px]",
													selectedModelId === m.id
														? "font-medium text-foreground"
														: "text-foreground/80",
												)}
											>
												{m.label}
											</span>
											{m.providerKey && (
												<span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/50">
													{m.providerKey}
												</span>
											)}
										</div>
										<button
											type="button"
											className="shrink-0 cursor-pointer p-0.5"
											title={
												favModelId === m.id
													? "Remove favourite"
													: "Set as favourite"
											}
											onClick={(e) => {
												e.stopPropagation();
												onToggleFavourite(m.id);
												onSelectModel(m.id);
											}}
										>
											<Star
												className={cn(
													"size-3",
													favModelId === m.id
														? "fill-yellow-400 text-yellow-400"
														: "text-muted-foreground/40",
												)}
											/>
										</button>
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>

						{/* Favourite quick-toggle */}
						<button
							type="button"
							className="cursor-pointer rounded p-0.5 transition-colors hover:bg-muted/60"
							title={
								favModelId === selectedModelId
									? "Remove favourite"
									: "Favourite this model"
							}
							onClick={() => onToggleFavourite(selectedModelId)}
						>
							<Star
								className={cn(
									"size-3",
									favModelId === selectedModelId
										? "fill-yellow-400 text-yellow-400"
										: "text-muted-foreground/30",
								)}
							/>
						</button>

						{/* Streaming indicator */}
						{streaming && (
							<span className="ml-0.5 size-1.5 rounded-full bg-primary animate-pulse shrink-0" />
						)}
					</>
				) : (
					<span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
						Thread history
					</span>
				)}
			</div>

			{/* Right side */}
			<div className="flex items-center gap-0.5">
				{view === "chat" && (
					<>
						<Button
							variant="ghost"
							size="icon"
							className="size-6 cursor-pointer"
							onClick={onNewSession}
							disabled={streaming}
							title="New session"
						>
							<Plus className="size-3.5" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="size-6 cursor-pointer"
							onClick={onShowHistory}
							title="Thread history"
						>
							<Clock className="size-3.5" />
						</Button>
					</>
				)}
				<Button
					variant="ghost"
					size="icon"
					className="size-6 cursor-pointer"
					onClick={onClose}
					title="Close"
				>
					<X className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}
