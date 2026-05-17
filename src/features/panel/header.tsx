import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	Bot,
	Braces,
	Check,
	ChevronDown,
	Clock3,
	Code,
	Copy,
	Cpu,
	FolderPlus,
	GitBranch,
	History,
	MessageSquare,
	MonitorUp,
	Pencil,
	Plus,
	RotateCcw,
	Terminal,
	Trash2,
	X,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BranchPickerPopover } from "@/components/branch-picker";
import { HelmorThinkingIndicator } from "@/components/helmor-thinking-indicator";
import { ClaudeIcon, OpenAIIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HyperText } from "@/components/ui/hyper-text";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { clearPersistedDraft } from "@/features/composer/draft-storage";
import { InlineShortcutDisplay } from "@/features/shortcuts/shortcut-display";
import {
	type AgentProvider,
	type ChangeRequestInfo,
	createSession,
	deleteSession,
	exportWorkspaceDirectoriesToCodex,
	listRemoteBranches,
	listTerminalProfiles,
	loadHiddenSessions,
	prefetchRemoteRefs,
	renameSession,
	renameWorkspaceBranch,
	type TerminalProfile,
	unhideSession,
	updateIntendedTargetBranch,
	type WorkspaceDetail,
	type WorkspaceSessionSummary,
} from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import {
	getWorkspaceBranchTone,
	type WorkspaceBranchTone,
} from "@/lib/workspace-helpers";
import { useWorkspaceToast } from "@/lib/workspace-toast-context";
import { seedNewSessionInCache } from "./session-cache";
import { closeWorkspaceSession } from "./session-close";
import { terminalDefaultTitle } from "./session-terminal-labels";
import type { SessionCloseRequest } from "./use-confirm-session-close";

type WorkspacePanelHeaderProps = {
	workspace: WorkspaceDetail | null;
	changeRequest?: ChangeRequestInfo | null;
	sessions: WorkspaceSessionSummary[];
	selectedSessionId: string | null;
	activeSessionParentId?: string | null;
	sessionDisplayProviders?: Record<string, AgentProvider>;
	sending: boolean;
	sendingSessionIds?: Set<string>;
	interactionRequiredSessionIds?: Set<string>;
	loadingWorkspace: boolean;
	headerActions?: React.ReactNode;
	headerLeading?: React.ReactNode;
	onSelectSession?: (sessionId: string) => void;
	onPrefetchSession?: (sessionId: string) => void;
	onSessionsChanged?: () => void;
	onSessionRenamed?: (sessionId: string, title: string) => void;
	onWorkspaceChanged?: () => void;
	onRequestCloseSession?: (request: SessionCloseRequest) => void;
	newSessionShortcut?: string | null;
	/** When true renders a minimal single-row header with no branch info or
	 *  session tabs — suited for narrow embedded panels like the Pi surface. */
	compact?: boolean;
};

export const WorkspacePanelHeader = memo(function WorkspacePanelHeader({
	workspace,
	changeRequest = null,
	sessions,
	selectedSessionId,
	activeSessionParentId = null,
	sessionDisplayProviders,
	sending,
	sendingSessionIds,
	interactionRequiredSessionIds,
	loadingWorkspace,
	headerActions,
	headerLeading,
	onSelectSession,
	onPrefetchSession,
	onSessionsChanged,
	onSessionRenamed,
	onWorkspaceChanged,
	onRequestCloseSession,
	newSessionShortcut,
	compact = false,
}: WorkspacePanelHeaderProps) {
	const branchTone = getWorkspaceBranchTone({
		workspaceState: workspace?.state,
		status: workspace?.status,
		changeRequest,
	});
	const [showHistory, setShowHistory] = useState(false);
	const [hiddenSessions, setHiddenSessions] = useState<
		WorkspaceSessionSummary[]
	>([]);
	const pushToast = useWorkspaceToast();
	const queryClient = useQueryClient();
	const branchesQuery = useQuery({
		queryKey: ["remoteBranches", workspace?.id],
		queryFn: () => listRemoteBranches({ workspaceId: workspace!.id }),
		enabled: false,
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
	});
	const terminalProfilesQuery = useQuery({
		queryKey: ["terminalProfiles"],
		queryFn: listTerminalProfiles,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const remoteBranches = branchesQuery.data ?? [];
	const loadingBranches = branchesQuery.isFetching;
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const [editingBranch, setEditingBranch] = useState<string | null>(null);
	const [newSessionOpen, setNewSessionOpen] = useState(false);
	const [branchCopied, setBranchCopied] = useState(false);
	const [exportingDirectories, setExportingDirectories] = useState(false);
	const [directoriesExported, setDirectoriesExported] = useState(false);
	const tabsScrollRef = useRef<HTMLDivElement>(null);
	const [hasRightOverflow, setHasRightOverflow] = useState(false);
	const [hasLeftOverflow, setHasLeftOverflow] = useState(false);
	const selectedSession =
		sessions.find((s) => s.id === selectedSessionId) ?? null;
	const selectedSessionParentId =
		selectedSession?.parentSessionId ?? activeSessionParentId ?? null;

	const updateOverflow = useCallback(() => {
		const el = tabsScrollRef.current;
		if (!el) return;
		setHasRightOverflow(el.scrollWidth - el.scrollLeft - el.clientWidth > 1);
		setHasLeftOverflow(el.scrollLeft > 1);
	}, []);

	useEffect(() => {
		const el = tabsScrollRef.current;
		if (!el) return;
		updateOverflow();
		const ro = new ResizeObserver(updateOverflow);
		ro.observe(el);
		return () => ro.disconnect();
	}, [updateOverflow, sessions.length]);

	useEffect(() => {
		const el = tabsScrollRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
			if (e.deltaY === 0) return;
			e.preventDefault();
			el.scrollLeft += e.deltaY;
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	const handleStartBranchRename = useCallback(() => {
		if (!workspace?.branch) {
			return;
		}
		setEditingBranch(workspace.branch);
	}, [workspace?.branch]);

	const handleCommitBranchRename = useCallback(async () => {
		if (editingBranch === null || !workspace) {
			return;
		}
		const trimmed = editingBranch.trim();
		if (trimmed && trimmed !== workspace.branch) {
			const detailKey = helmorQueryKeys.workspaceDetail(workspace.id);
			const previous = queryClient.getQueryData<WorkspaceDetail | null>(
				detailKey,
			);
			if (previous) {
				queryClient.setQueryData<WorkspaceDetail | null>(detailKey, {
					...previous,
					branch: trimmed,
				});
			}
			try {
				await renameWorkspaceBranch(workspace.id, trimmed);
				onWorkspaceChanged?.();
			} catch (error: unknown) {
				if (previous) {
					queryClient.setQueryData<WorkspaceDetail | null>(detailKey, previous);
				}
				pushToast(
					error instanceof Error ? error.message : String(error),
					"Branch rename failed",
					"destructive",
				);
			}
		}
		setEditingBranch(null);
	}, [editingBranch, onWorkspaceChanged, pushToast, queryClient, workspace]);

	const handleCancelBranchRename = useCallback(() => {
		setEditingBranch(null);
	}, []);

	const handleExportWorkspacesToCodex = useCallback(async () => {
		if (!workspace || exportingDirectories) {
			return;
		}
		setExportingDirectories(true);
		try {
			const result = await exportWorkspaceDirectoriesToCodex(workspace.id);
			queryClient.setQueryData(
				helmorQueryKeys.workspaceLinkedDirectories(workspace.id),
				result.directories,
			);
			void queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey[0] === "slashCommands" &&
					query.queryKey[3] === workspace.id,
			});
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceCandidateDirectories(workspace.id),
			});
			setDirectoriesExported(true);
			setTimeout(() => setDirectoriesExported(false), 1500);
			pushToast(
				result.added === 0
					? "Codex already has all workspace folders"
					: `Added ${result.added} workspace folder${result.added === 1 ? "" : "s"}`,
				"Workspace folders exported",
				"default",
			);
		} catch (error: unknown) {
			pushToast(
				error instanceof Error ? error.message : String(error),
				"Codex export failed",
				"destructive",
			);
		} finally {
			setExportingDirectories(false);
		}
	}, [exportingDirectories, pushToast, queryClient, workspace]);

	const handleCreateSession = useCallback(
		async (mode: "thread" | "terminal", runtimeOverride?: string | null) => {
			if (!workspace) {
				return;
			}
			const runtime = mode === "terminal" ? (runtimeOverride ?? "shell") : null;
			try {
				const result = await createSession(workspace.id, {
					surfaceMode: mode,
					runtime,
				});
				seedNewSessionInCache({
					queryClient,
					workspaceId: workspace.id,
					sessionId: result.sessionId,
					workspace,
					existingSessions: sessions,
					createdAt: new Date().toISOString(),
					mode,
					runtime,
				});

				void queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.repoScripts(workspace.repoId, workspace.id),
				});
				onSessionsChanged?.();
				onSelectSession?.(result.sessionId);
			} catch (error) {
				console.error("Failed to create session:", error);
			}
		},
		[onSelectSession, onSessionsChanged, queryClient, sessions, workspace],
	);

	const handleCreateThread = useCallback(() => {
		setNewSessionOpen(false);
		void handleCreateSession("thread");
	}, [handleCreateSession]);

	const handleCreateTerminalProfile = useCallback(
		(runtime: string) => {
			setNewSessionOpen(false);
			void handleCreateSession("terminal", runtime);
		},
		[handleCreateSession],
	);

	const handleHideSession = useCallback(
		async (sessionId: string, event: React.MouseEvent) => {
			event.stopPropagation();
			if (!workspace) {
				return;
			}
			const targetSession =
				sessions.find((session) => session.id === sessionId) ?? null;
			if (!targetSession) {
				return;
			}

			// When the caller provided a shared confirm-close hook
			// (`onRequestCloseSession`), delegate — it handles the running-
			// session confirmation dialog itself. Otherwise fall back to an
			// unconditional close.
			if (onRequestCloseSession) {
				onRequestCloseSession({
					workspace,
					sessions,
					session: targetSession,
					activateAdjacent: targetSession.id === selectedSessionId,
					provider: sessionDisplayProviders?.[targetSession.id] ?? null,
					onSessionsChanged,
				});
				return;
			}

			await closeWorkspaceSession({
				queryClient,
				workspace,
				sessions,
				sessionId,
				activateAdjacent: sessionId === selectedSessionId,
				onSelectSession,
				onSessionsChanged,
				pushToast,
			});
		},
		[
			onRequestCloseSession,
			onSelectSession,
			onSessionsChanged,
			pushToast,
			queryClient,
			selectedSessionId,
			sessionDisplayProviders,
			sessions,
			workspace,
		],
	);

	const handleToggleHistory = useCallback(
		async (open: boolean) => {
			if (open && workspace) {
				const hidden = await loadHiddenSessions(workspace.id);
				setHiddenSessions(hidden);
			}
			setShowHistory(open);
		},
		[workspace],
	);

	const handleUnhide = useCallback(
		async (sessionId: string) => {
			await unhideSession(sessionId);
			setHiddenSessions((current) => {
				const next = current.filter((session) => session.id !== sessionId);
				if (next.length === 0) {
					setShowHistory(false);
				}
				return next;
			});
			onSessionsChanged?.();
			onSelectSession?.(sessionId);
		},
		[onSelectSession, onSessionsChanged],
	);

	const handleDelete = useCallback(
		async (sessionId: string) => {
			await deleteSession(sessionId);
			clearPersistedDraft(`session:${sessionId}`);
			setHiddenSessions((current) => {
				const next = current.filter((session) => session.id !== sessionId);
				if (next.length === 0) {
					setShowHistory(false);
				}
				return next;
			});
			onSessionsChanged?.();
		},
		[onSessionsChanged],
	);

	const handleStartRename = useCallback(
		(session: WorkspaceSessionSummary, event: React.MouseEvent) => {
			event.stopPropagation();
			setEditingSessionId(session.id);
			setEditingTitle(displaySessionTitle(session));
		},
		[],
	);

	const handleCommitRename = useCallback(async () => {
		if (!editingSessionId) {
			return;
		}
		const trimmed = editingTitle.trim();
		if (trimmed) {
			await renameSession(editingSessionId, trimmed);
			onSessionRenamed?.(editingSessionId, trimmed);
		}
		setEditingSessionId(null);
		setEditingTitle("");
	}, [editingSessionId, editingTitle, onSessionRenamed]);

	const handleCancelRename = useCallback(() => {
		setEditingSessionId(null);
		setEditingTitle("");
	}, []);

	const stopTabActionPointerDown = useCallback((event: React.PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
	}, []);

	if (compact) {
		return (
			<header className="relative z-20">
				{/* Single compact row: scrollable tabs + new-session + close */}
				<div className="flex items-center gap-0.5 border-b border-border/40 px-2 pb-1">
					<div className="group/tabs-scroll relative min-w-0 flex-1">
						{hasLeftOverflow && (
							<div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent" />
						)}
						{hasRightOverflow && (
							<div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background to-transparent" />
						)}
						<div
							ref={tabsScrollRef}
							onScroll={updateOverflow}
							className="scrollbar-none min-w-0 flex-1 overflow-x-auto"
						>
							{loadingWorkspace ? (
								<div className="flex h-[1.85rem] items-center gap-1.5 px-2 text-[12px] text-muted-foreground">
									<Clock3 className="size-3 animate-pulse" strokeWidth={1.8} />
									Loading
								</div>
							) : sessions.length > 0 ? (
								<Tabs
									value={selectedSessionId ?? sessions[0]?.id}
									onValueChange={(value) => onSelectSession?.(value)}
									className="min-w-max gap-0"
								>
									<TabsList
										aria-label="Sessions"
										className="inline-flex w-max min-w-full justify-start self-start bg-transparent p-0 rounded-none h-auto gap-px"
									>
										{sessions.map((session) => {
											const selected = session.id === selectedSessionId;
											const isActivelySending = sendingSessionIds
												? sendingSessionIds.has(session.id)
												: selected && sending;
											const isInteractionRequired =
												interactionRequiredSessionIds?.has(session.id) ?? false;
											const isActive =
												isActivelySending && !isInteractionRequired;
											const hasUnread = session.unreadCount > 0;
											const hasStatusDot =
												isInteractionRequired || (!selected && hasUnread);

											return (
												<TabsTrigger
													key={session.id}
													value={session.id}
													onMouseEnter={() => onPrefetchSession?.(session.id)}
													onFocus={() => onPrefetchSession?.(session.id)}
													className="group/tab relative h-[26px] w-auto min-w-[4rem] max-w-[8rem] shrink-0 flex-none justify-start gap-1 overflow-hidden rounded-md pr-4 text-[11.5px] text-muted-foreground/70 aria-selected:border-transparent aria-selected:shadow-none data-[state=active]:text-foreground dark:aria-selected:border-transparent"
												>
													<span className="tab-content-fade flex min-w-0 flex-1 items-center gap-1">
														{session.parentSessionId ? (
															<Bot
																className="size-3 shrink-0 text-muted-foreground/60"
																strokeWidth={1.8}
															/>
														) : null}
														<SessionProviderIcon
															agentType={
																sessionDisplayProviders?.[session.id] ??
																session.agentType
															}
															surfaceKind={session.surfaceKind}
															active={isActive}
														/>
														<span
															className={cn(
																"truncate font-medium",
																hasStatusDot && !selected
																	? "text-foreground"
																	: undefined,
															)}
														>
															{displaySessionTitle(session)}
														</span>
														{hasStatusDot ? (
															<span
																aria-label={
																	isInteractionRequired
																		? "Interaction required"
																		: "Unread session"
																}
																className={cn(
																	"size-1.5 shrink-0 rounded-full",
																	isInteractionRequired
																		? "bg-yellow-500"
																		: "bg-chart-2",
																)}
															/>
														) : null}
													</span>
													<span className="pointer-events-none invisible absolute inset-y-0 right-0 flex items-center pr-0.5 group-hover/tab:pointer-events-auto group-hover/tab:visible">
														<span
															role="button"
															aria-label="Close session"
															onPointerDown={stopTabActionPointerDown}
															onClick={(event) =>
																handleHideSession(session.id, event)
															}
															className="flex cursor-pointer items-center justify-center rounded-sm p-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
														>
															<X className="size-3" strokeWidth={2} />
														</span>
													</span>
												</TabsTrigger>
											);
										})}
									</TabsList>
								</Tabs>
							) : (
								<div className="flex h-[1.85rem] items-center gap-1.5 px-2 text-[12px] text-muted-foreground">
									<AlertCircle className="size-3" strokeWidth={1.8} />
									No sessions
								</div>
							)}
						</div>
					</div>

					<NewSessionMenu
						open={newSessionOpen}
						onOpenChange={setNewSessionOpen}
						onCreateThread={handleCreateThread}
						onCreateTerminal={handleCreateTerminalProfile}
						terminalProfiles={
							terminalProfilesQuery.data ?? DEFAULT_TERMINAL_PROFILES
						}
					/>

					{headerActions ? (
						<div className="flex shrink-0 items-center">{headerActions}</div>
					) : null}
				</div>
			</header>
		);
	}

	return (
		<header className="relative z-20">
			<div
				aria-label="Workspace header"
				className="flex h-9 items-center justify-between gap-3 px-[18px]"
				data-tauri-drag-region
			>
				<div className="relative z-0 flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-[12.5px]">
					{headerLeading}
					<span className="group/branch relative inline-flex items-center gap-1 overflow-hidden px-1 py-0.5 font-medium text-foreground">
						<GitBranch
							className={cn(
								"size-3.5 shrink-0",
								getBranchToneClassName(branchTone),
							)}
							strokeWidth={1.9}
						/>
						{editingBranch !== null ? (
							<Input
								autoFocus
								value={editingBranch}
								onChange={(event) => setEditingBranch(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										void handleCommitBranchRename();
									} else if (event.key === "Escape") {
										handleCancelBranchRename();
									}
								}}
								onBlur={() => void handleCommitBranchRename()}
								onClick={(event) => event.stopPropagation()}
								className="h-5 w-32 truncate rounded-md border-border bg-background px-1.5 py-0 text-[12.5px] font-medium text-foreground"
							/>
						) : (
							<>
								<HyperText
									key={workspace?.id}
									text={workspace?.branch ?? "No branch"}
									className="truncate"
								/>
								{workspace?.branch && workspace.state !== "archived" ? (
									<span className="pointer-events-none invisible absolute inset-y-0 right-0 flex items-center gap-0.5 bg-[linear-gradient(to_right,transparent_0%,var(--background)_35%,var(--background)_100%)] pl-5 pr-1 group-hover/branch:pointer-events-auto group-hover/branch:visible">
										<span
											role="button"
											aria-label="Rename branch"
											onClick={handleStartBranchRename}
											className="flex cursor-pointer items-center justify-center rounded-sm p-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
										>
											<Pencil className="size-3" strokeWidth={2} />
										</span>
										<span
											role="button"
											aria-label="Copy branch name"
											onClick={() => {
												if (!workspace.branch) {
													return;
												}
												void navigator.clipboard.writeText(workspace.branch);
												setBranchCopied(true);
												setTimeout(() => setBranchCopied(false), 1500);
											}}
											className="flex cursor-pointer items-center justify-center rounded-sm p-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
										>
											{branchCopied ? (
												<Check
													className="size-3 text-green-400"
													strokeWidth={2}
												/>
											) : (
												<Copy className="size-3" strokeWidth={2} />
											)}
										</span>
									</span>
								) : null}
							</>
						)}
					</span>
					{workspace?.intendedTargetBranch ? (
						<>
							<ArrowRight
								className="relative top-px size-3 shrink-0 self-center text-muted-foreground"
								strokeWidth={1.8}
							/>
							{workspace.state === "archived" ? (
								<span className="px-1 py-0.5 font-medium text-muted-foreground">
									{workspace.remote ?? "origin"}/
									{workspace.intendedTargetBranch}
								</span>
							) : (
								<BranchPicker
									currentBranch={workspace.intendedTargetBranch ?? ""}
									displayRemote={workspace.remote ?? "origin"}
									branches={remoteBranches}
									loading={loadingBranches}
									onOpen={() => {
										void branchesQuery.refetch();
										void prefetchRemoteRefs({ workspaceId: workspace.id })
											.then((result) => {
												if (result.fetched) {
													void branchesQuery.refetch();
												}
											})
											.catch(() => {});
									}}
									onSelect={(branch: string) => {
										if (branch === workspace.intendedTargetBranch) {
											return;
										}
										const detailKey = helmorQueryKeys.workspaceDetail(
											workspace.id,
										);
										const previousDetail =
											queryClient.getQueryData<WorkspaceDetail | null>(
												detailKey,
											);
										if (previousDetail) {
											queryClient.setQueryData<WorkspaceDetail | null>(
												detailKey,
												{
													...previousDetail,
													intendedTargetBranch: branch,
												},
											);
										}

										// Invalidate changes so diff section shows loading.
										if (workspace.rootPath) {
											void queryClient.invalidateQueries({
												queryKey: helmorQueryKeys.workspaceChanges(
													workspace.rootPath,
												),
											});
										}

										void updateIntendedTargetBranch(workspace.id, branch)
											.then(({ reset }) => {
												onWorkspaceChanged?.();
												// Recompute sync status vs. new target now; don't wait for 10s poll.
												void queryClient.invalidateQueries({
													queryKey: helmorQueryKeys.workspaceGitActionStatus(
														workspace.id,
													),
												});
												if (workspace.rootPath) {
													void queryClient.invalidateQueries({
														queryKey: helmorQueryKeys.workspaceChanges(
															workspace.rootPath,
														),
													});
												}
												if (reset) {
													pushToast(
														`Local branch reset to ${workspace.remote ?? "origin"}/${branch}`,
														`Switched to ${branch}`,
														"default",
													);
												} else {
													pushToast(
														"Target branch updated",
														`Switched to ${branch}`,
														"default",
													);
												}
											})
											.catch((error: unknown) => {
												if (previousDetail) {
													queryClient.setQueryData<WorkspaceDetail | null>(
														detailKey,
														previousDetail,
													);
												}
												pushToast(
													error instanceof Error
														? error.message
														: String(error),
													"Branch switch failed",
													"destructive",
												);
											});
									}}
								/>
							)}
						</>
					) : null}
					{workspace && workspace.state !== "archived" ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									aria-label="Export workspace folders to Codex"
									variant="ghost"
									size="icon-sm"
									disabled={exportingDirectories}
									onClick={handleExportWorkspacesToCodex}
									className="shrink-0 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
								>
									{directoriesExported ? (
										<Check
											className="size-3.5 text-green-400"
											strokeWidth={2}
										/>
									) : (
										<FolderPlus
											className={cn(
												"size-3.5",
												exportingDirectories && "animate-pulse",
											)}
											strokeWidth={1.8}
										/>
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent
								side="bottom"
								sideOffset={4}
								className="flex h-[24px] items-center rounded-md px-2 text-[12px] leading-none"
							>
								<span>Export workspaces to Codex</span>
							</TooltipContent>
						</Tooltip>
					) : null}
				</div>
				{headerActions ? (
					<div className="relative z-10 flex shrink-0 items-center gap-1 bg-background pl-1">
						{headerActions}
					</div>
				) : null}
			</div>

			{selectedSessionParentId ? (
				<button
					type="button"
					onClick={() => onSelectSession?.(selectedSessionParentId)}
					className="flex cursor-pointer items-center gap-1 px-3 pb-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
				>
					<ArrowLeft className="size-3" strokeWidth={2} />
					Back to parent
				</button>
			) : null}
			<div className="flex items-center px-4 pb-1">
				<div className="group/tabs-scroll relative min-w-0 flex-1">
					{hasLeftOverflow && (
						<div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-background to-transparent" />
					)}
					{hasRightOverflow && (
						<div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background to-transparent" />
					)}
					<div
						ref={tabsScrollRef}
						onScroll={updateOverflow}
						className="scrollbar-none min-w-0 flex-1 overflow-x-auto"
					>
						{loadingWorkspace ? (
							<div className="flex h-[1.85rem] items-center gap-1.5 px-2 text-[12px] text-muted-foreground">
								<Clock3 className="size-3 animate-pulse" strokeWidth={1.8} />
								Loading
							</div>
						) : sessions.length > 0 ? (
							<Tabs
								value={selectedSessionId ?? sessions[0]?.id}
								onValueChange={(value) => {
									onSelectSession?.(value);
								}}
								className="min-w-max gap-0"
							>
								<TabsList
									aria-label="Sessions"
									className="inline-flex min-w-full w-max justify-start self-start bg-transparent p-0 rounded-none h-auto gap-px"
								>
									{sessions.map((session) => {
										const selected = session.id === selectedSessionId;
										const isActivelySending = sendingSessionIds
											? sendingSessionIds.has(session.id)
											: selected && sending;
										const hasUnread = session.unreadCount > 0;
										const isInteractionRequired =
											interactionRequiredSessionIds?.has(session.id) ?? false;
										const isActive =
											isActivelySending && !isInteractionRequired;
										const hasStatusDot =
											isInteractionRequired || (!selected && hasUnread);
										const isEditing = editingSessionId === session.id;

										return (
											<Tooltip key={session.id}>
												<TooltipTrigger asChild>
													<TabsTrigger
														value={session.id}
														onMouseEnter={() => {
															onPrefetchSession?.(session.id);
														}}
														onFocus={() => {
															onPrefetchSession?.(session.id);
														}}
														className="group/tab relative h-[28px] w-auto min-w-[5rem] max-w-[12rem] shrink-0 flex-none justify-start gap-1.5 overflow-hidden rounded-md pr-5 text-[12px] text-muted-foreground/70 aria-selected:border-transparent aria-selected:shadow-none data-[state=active]:text-foreground dark:aria-selected:border-transparent"
													>
														{/* Content wrapper: text fades out on the right when hovered so
														    the action icons can sit on the tab's own background. */}
														<span className="tab-content-fade flex min-w-0 flex-1 items-center gap-1.5">
															{session.parentSessionId ? (
																<Bot
																	className="size-3 shrink-0 text-muted-foreground/60"
																	strokeWidth={1.8}
																/>
															) : null}
															<SessionProviderIcon
																agentType={
																	sessionDisplayProviders?.[session.id] ??
																	session.agentType
																}
																surfaceKind={session.surfaceKind}
																active={isActive}
															/>
															{isEditing ? (
																<Input
																	autoFocus
																	value={editingTitle}
																	onChange={(event) =>
																		setEditingTitle(event.target.value)
																	}
																	onKeyDown={(event) => {
																		if (event.key === "Enter") {
																			event.preventDefault();
																			void handleCommitRename();
																		} else if (event.key === "Escape") {
																			handleCancelRename();
																		}
																	}}
																	onBlur={() => void handleCommitRename()}
																	onClick={(event) => event.stopPropagation()}
																	className="h-auto min-w-0 flex-1 truncate border-0 bg-transparent px-0 py-0 text-[13px] font-medium text-inherit shadow-none outline-none focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none"
																/>
															) : (
																<span
																	className={cn(
																		"truncate font-medium",
																		hasStatusDot && !selected
																			? "text-foreground"
																			: undefined,
																	)}
																>
																	{displaySessionTitle(session)}
																</span>
															)}
															{hasStatusDot && !isEditing ? (
																<span
																	aria-label={
																		isInteractionRequired
																			? "Interaction required"
																			: "Unread session"
																	}
																	className={cn(
																		"size-1.5 shrink-0 rounded-full",
																		isInteractionRequired
																			? "bg-yellow-500"
																			: "bg-chart-2",
																	)}
																/>
															) : null}
														</span>
														{!isEditing ? (
															<span className="pointer-events-none invisible absolute inset-y-0 right-0 flex items-center gap-0.5 pr-1 group-hover/tab:pointer-events-auto group-hover/tab:visible">
																<span
																	role="button"
																	aria-label="Rename session"
																	onPointerDown={stopTabActionPointerDown}
																	onClick={(event) =>
																		handleStartRename(session, event)
																	}
																	className="flex cursor-pointer items-center justify-center rounded-sm p-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
																>
																	<Pencil className="size-3" strokeWidth={2} />
																</span>
																<span
																	role="button"
																	aria-label="Close session"
																	onPointerDown={stopTabActionPointerDown}
																	onClick={(event) =>
																		handleHideSession(session.id, event)
																	}
																	className="flex cursor-pointer items-center justify-center rounded-sm p-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
																>
																	<X className="size-3" strokeWidth={2} />
																</span>
															</span>
														) : null}
													</TabsTrigger>
												</TooltipTrigger>
												<TooltipContent
													side="bottom"
													sideOffset={4}
													className="flex h-[22px] items-center rounded-md px-1.5 text-[11px] leading-none"
												>
													<span>{displaySessionTitle(session)}</span>
												</TooltipContent>
											</Tooltip>
										);
									})}
								</TabsList>
							</Tabs>
						) : (
							<div className="flex h-[1.85rem] items-center gap-1.5 px-2 text-[12px] text-muted-foreground">
								<AlertCircle className="size-3" strokeWidth={1.8} />
								No sessions
							</div>
						)}
					</div>
				</div>

				<NewSessionMenu
					open={newSessionOpen}
					onOpenChange={setNewSessionOpen}
					onCreateThread={handleCreateThread}
					onCreateTerminal={handleCreateTerminalProfile}
					terminalProfiles={
						terminalProfilesQuery.data ?? DEFAULT_TERMINAL_PROFILES
					}
					shortcut={newSessionShortcut}
				/>

				<DropdownMenu open={showHistory} onOpenChange={handleToggleHistory}>
					<DropdownMenuTrigger asChild>
						<Button
							aria-label="Session history"
							variant="ghost"
							size="icon-sm"
							className={cn(
								"ml-1 shrink-0 text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:border-transparent focus-visible:ring-0",
								showHistory && "bg-accent/60 text-foreground",
							)}
						>
							<History className="size-3.5" strokeWidth={1.8} />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						className="max-h-96 w-56 overscroll-contain"
					>
						{hiddenSessions.length > 0 ? (
							hiddenSessions.map((session) => (
								<Tooltip key={session.id}>
									<TooltipTrigger asChild>
										<div className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-accent/60">
											<div className="flex min-w-0 items-center gap-1.5">
												<SessionProviderIcon
													agentType={session.agentType}
													surfaceKind={session.surfaceKind}
													active={false}
												/>
												<span className="truncate">
													{displaySessionTitle(session)}
												</span>
											</div>
											<div className="flex shrink-0 items-center gap-0.5">
												<Button
													aria-label="Restore session"
													onClick={() => handleUnhide(session.id)}
													variant="ghost"
													size="icon-xs"
													className="text-muted-foreground hover:text-foreground"
												>
													<RotateCcw className="size-3" strokeWidth={1.8} />
												</Button>
												<Button
													aria-label="Delete session permanently"
													onClick={() => handleDelete(session.id)}
													variant="ghost"
													size="icon-xs"
													className="text-muted-foreground hover:text-destructive"
												>
													<Trash2 className="size-3" strokeWidth={1.8} />
												</Button>
											</div>
										</div>
									</TooltipTrigger>
									<TooltipContent
										side="left"
										sideOffset={4}
										className="flex h-[22px] items-center rounded-md px-1.5 text-[11px] leading-none"
									>
										<span>{displaySessionTitle(session)}</span>
									</TooltipContent>
								</Tooltip>
							))
						) : (
							<div className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
								No hidden sessions
							</div>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</header>
	);
});

function getBranchToneClassName(tone: WorkspaceBranchTone) {
	switch (tone) {
		case "open":
			return "text-[var(--workspace-branch-status-open)]";
		case "merged":
			return "text-[var(--workspace-branch-status-merged)]";
		case "closed":
			return "text-[var(--workspace-branch-status-closed)]";
		case "inactive":
			return "text-[var(--workspace-branch-status-inactive)]";
		default:
			return "text-[var(--workspace-branch-status-working)]";
	}
}

function SessionProviderIcon({
	agentType,
	surfaceKind,
	active,
}: {
	agentType?: string | null;
	surfaceKind?: string | null;
	active: boolean;
}) {
	if (surfaceKind === "terminal") {
		return <MonitorUp className="size-3 shrink-0 text-muted-foreground" />;
	}
	if (active) {
		return <HelmorThinkingIndicator size={14} />;
	}
	if (agentType === "codex") {
		return <OpenAIIcon className="size-3 shrink-0 text-muted-foreground" />;
	}
	return <ClaudeIcon className="size-3 shrink-0 text-muted-foreground" />;
}

const DEFAULT_TERMINAL_PROFILES: TerminalProfile[] = [
	{
		id: "shell",
		label: "Shell",
		command: null,
		args: [],
		env: [],
		tmuxBacked: true,
	},
	{
		id: "claude",
		label: "Claude",
		command: "claude",
		args: ["--permission-mode", "bypassPermissions"],
		env: [],
		tmuxBacked: true,
	},
	{
		id: "codex",
		label: "Codex",
		command: "codex",
		args: ["--no-alt-screen", "--dangerously-bypass-approvals-and-sandbox"],
		env: [],
		tmuxBacked: true,
	},
	{
		id: "opencode",
		label: "OpenCode",
		command: "opencode",
		args: [],
		env: [
			{ key: "OPENCODE_CONFIG_CONTENT", value: '{"permission":"allow"}' },
			{ key: "OPENCODE_YOLO", value: "true" },
			{ key: "OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS", value: "true" },
		],
		tmuxBacked: true,
	},
	{ id: "pi", label: "Pi", command: "pi", args: [], env: [], tmuxBacked: true },
];

/** Maps a terminal profile id to a unique icon and human-readable description. */
function terminalProfileMeta(profile: TerminalProfile): {
	Icon: LucideIcon;
	description: string;
} {
	switch (profile.id) {
		case "shell":
			return { Icon: Terminal, description: "Login shell" };
		case "claude":
			return { Icon: Bot, description: "Claude Code" };
		case "codex":
			return { Icon: Braces, description: "OpenAI Codex CLI" };
		case "opencode":
			return { Icon: Code, description: "Open-source code agent" };
		case "pi":
			return { Icon: Cpu, description: "Pi coding agent" };
		default:
			return { Icon: MonitorUp, description: profile.command ?? profile.id };
	}
}

function NewSessionMenu({
	open,
	onOpenChange,
	onCreateThread,
	onCreateTerminal,
	terminalProfiles,
	shortcut,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreateThread: () => void;
	onCreateTerminal: (runtime: string) => void;
	terminalProfiles: TerminalProfile[];
	shortcut?: string | null;
}) {
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							aria-label="New session"
							variant="ghost"
							size="icon-sm"
							className="ml-0.5 shrink-0 cursor-pointer text-muted-foreground hover:bg-accent/60 hover:text-foreground"
						>
							<Plus className="size-3.5" strokeWidth={1.8} />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent
					side="bottom"
					sideOffset={4}
					className="flex h-[24px] items-center gap-2 rounded-md px-2 text-[12px] leading-none"
				>
					<span>New session</span>
					{shortcut ? (
						<InlineShortcutDisplay
							hotkey={shortcut}
							className="text-background/60"
						/>
					) : null}
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end" className="w-48">
				<DropdownMenuLabel>New session</DropdownMenuLabel>
				<DropdownMenuItem onSelect={onCreateThread}>
					<MessageSquare className="size-3.5" strokeWidth={1.8} />
					<div className="flex flex-col">
						<span>Chat with AI</span>
						<span className="text-[11px] text-muted-foreground">
							Create a Thread
						</span>
					</div>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<MonitorUp className="size-3.5" strokeWidth={1.8} />
						<div className="flex flex-col">
							<span>Run a terminal</span>
							<span className="text-[11px] text-muted-foreground">
								Choose profile
							</span>
						</div>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="w-52">
						{terminalProfiles.map((profile) => {
							const { Icon, description } = terminalProfileMeta(profile);
							return (
								<DropdownMenuItem
									key={profile.id}
									onSelect={() => onCreateTerminal(profile.id)}
								>
									<Icon className="size-3.5" strokeWidth={1.8} />
									<div className="flex flex-col">
										<span>{profile.label}</span>
										<span className="text-[11px] text-muted-foreground">
											{description}
										</span>
									</div>
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function displaySessionTitle(session: WorkspaceSessionSummary): string {
	if (session.surfaceMode === "task_monitor") {
		return session.title && session.title !== "Untitled"
			? session.title
			: "Task Monitor";
	}
	if (session.surfaceMode === "agent_terminal") {
		return session.title && session.title !== "Untitled"
			? session.title
			: terminalDefaultTitle(session);
	}
	if (session.surfaceMode === "terminal") {
		return session.title && session.title !== "Untitled"
			? session.title
			: terminalDefaultTitle(session);
	}
	if (session.title && session.title !== "Untitled") {
		return session.title;
	}
	return "Untitled";
}

// BranchPicker: thin wrapper around shared BranchPickerPopover with header trigger styling.
function BranchPicker({
	currentBranch,
	displayRemote,
	branches,
	loading,
	onOpen,
	onSelect,
}: {
	currentBranch: string;
	displayRemote: string;
	branches: string[];
	loading: boolean;
	onOpen: () => void;
	onSelect: (branch: string) => void;
}) {
	return (
		<BranchPickerPopover
			currentBranch={currentBranch}
			branches={branches}
			loading={loading}
			onOpen={onOpen}
			onSelect={onSelect}
		>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				className="h-6 min-w-0 max-w-[180px] gap-1 rounded-md px-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
			>
				<span className="truncate">
					{displayRemote}/{currentBranch}
				</span>
				<ChevronDown data-icon="inline-end" strokeWidth={2} />
			</Button>
		</BranchPickerPopover>
	);
}
