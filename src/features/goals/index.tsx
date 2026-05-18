import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { useScriptStatus } from "@/features/inspector/hooks/use-script-status";
import { useSetupAutoRun } from "@/features/inspector/hooks/use-setup-auto-run";
import {
	type AssigneeReportMarker,
	createGoalChildWorkspaceAndStart,
	listAssignees,
	loadRepoScripts,
	markWorkspaceLanded,
	mergeWorkspaceChangeRequest,
	reconcileWorkspaceLandingState,
	setGoalChildWorkspaceStatus,
	updateGoalWorkspaceMeta,
	type WorkspaceDetail,
	type WorkspaceStatus,
} from "@/lib/api";
import {
	goalChildWorkspacesQueryOptions,
	goalOrchestratorStateQueryOptions,
	helmorQueryKeys,
	workspaceDetailQueryOptions,
	workspacePrCommentsQueryOptions,
} from "@/lib/query-client";
import { GoalBoard } from "./board";
import { createGoalKanbanSnapshot, type GoalLaneId } from "./board-model";
import { BranchTreeView } from "./branch-tree-view";
import { GoalCardDetailPanel } from "./card-detail";
import { GoalChangesView } from "./changes-view";
import { GoalCommentsView } from "./comments-view";
import { GoalTabBar } from "./goal-tab-bar";
import { GoalHeader } from "./header";
import { GoalMetaSheet } from "./metadata-sheet";
import { AddWorkspacePanel } from "./panels";
import { GoalSidebar } from "./sidebar";
import { GoalTeamView } from "./team-view";
import { GoalTerminalView } from "./terminal-view";
import { GoalTimelineView } from "./timeline-view";
import type { GoalTabView, GoalWorkspaceContainerProps } from "./types";

const GOAL_SIDEBAR_WIDTH_KEY = "helmor.goalSidebarWidth";
const GOAL_SIDEBAR_DEFAULT_WIDTH = 300;
const GOAL_SIDEBAR_MIN_WIDTH = 220;
const GOAL_SIDEBAR_MAX_WIDTH = 520;
const GOAL_SIDEBAR_HIT_AREA = 20;

function getInitialSidebarWidth() {
	if (typeof window === "undefined") return GOAL_SIDEBAR_DEFAULT_WIDTH;
	try {
		const stored = window.localStorage.getItem(GOAL_SIDEBAR_WIDTH_KEY);
		if (!stored) return GOAL_SIDEBAR_DEFAULT_WIDTH;
		const parsed = Number.parseInt(stored, 10);
		return Number.isFinite(parsed)
			? Math.min(
					GOAL_SIDEBAR_MAX_WIDTH,
					Math.max(GOAL_SIDEBAR_MIN_WIDTH, parsed),
				)
			: GOAL_SIDEBAR_DEFAULT_WIDTH;
	} catch {
		return GOAL_SIDEBAR_DEFAULT_WIDTH;
	}
}

const GOAL_CARD_DETAIL_WIDTH_KEY = "helmor.goalCardDetailWidth";
const GOAL_CARD_DETAIL_DEFAULT_WIDTH = 380;
const GOAL_CARD_DETAIL_MIN_WIDTH = 320;
const GOAL_CARD_DETAIL_MAX_WIDTH = 560;
const GOAL_CARD_DETAIL_HIT_AREA = 20;

function getInitialCardDetailWidth() {
	if (typeof window === "undefined") return GOAL_CARD_DETAIL_DEFAULT_WIDTH;
	try {
		const stored = window.localStorage.getItem(GOAL_CARD_DETAIL_WIDTH_KEY);
		if (!stored) return GOAL_CARD_DETAIL_DEFAULT_WIDTH;
		const parsed = Number.parseInt(stored, 10);
		return Number.isFinite(parsed)
			? Math.min(
					GOAL_CARD_DETAIL_MAX_WIDTH,
					Math.max(GOAL_CARD_DETAIL_MIN_WIDTH, parsed),
				)
			: GOAL_CARD_DETAIL_DEFAULT_WIDTH;
	} catch {
		return GOAL_CARD_DETAIL_DEFAULT_WIDTH;
	}
}

type DragState = {
	workspaceId: string;
	sourceLane: GoalLaneId;
} | null;

export function GoalWorkspaceContainer({
	workspaceId,
	headerLeading,
	onSelectWorkspace,
	onSelectWorkspaceSession,
	activeEditorPath,
	onOpenEditorFile,
	onSendingWorkspacesChange,
	onOpenSettings,
	commitButtonMode = "create-pr",
	commitButtonState,
	changeRequest = null,
	forgeDetection = null,
	forgeRemoteState = null,
	forgeIsRefreshing = false,
	hasGitChanges = false,
	onCommitAction,
	onOpenChangeRequest,
	onRefreshPrStatus,
}: GoalWorkspaceContainerProps) {
	const queryClient = useQueryClient();

	const [activeTab, setActiveTab] = useState<GoalTabView>("board");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [showAddPanel, setShowAddPanel] = useState(false);
	const [showGoalSheet, setShowGoalSheet] = useState(false);
	const [newWorkspaceTitle, setNewWorkspaceTitle] = useState("");
	const [dragState, setDragState] = useState<DragState>(null);
	const [dragOverLane, setDragOverLane] = useState<GoalLaneId | null>(null);
	/** Workspace waiting for merge confirmation (has open change request). */
	const [pendingMerge, setPendingMerge] = useState<WorkspaceDetail | null>(
		null,
	);
	const [pendingLandingCheck, setPendingLandingCheck] =
		useState<WorkspaceDetail | null>(null);
	const [landingCheckResult, setLandingCheckResult] = useState<
		"unlanded" | "unknown" | null
	>(null);
	const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
	const [sidebarResizeState, setSidebarResizeState] = useState<{
		pointerX: number;
		startWidth: number;
	} | null>(null);
	const [cardDetailWidth, setCardDetailWidth] = useState(
		getInitialCardDetailWidth,
	);
	const [cardDetailResizeState, setCardDetailResizeState] = useState<{
		pointerX: number;
		startWidth: number;
	} | null>(null);

	// Reset local selection state when the workspace changes so stale card
	// selections from a previously-viewed goal workspace don't persist.
	useEffect(() => {
		setSelectedId(null);
		setShowAddPanel(false);
	}, [workspaceId]);

	const detailQuery = useQuery(workspaceDetailQueryOptions(workspaceId));
	const childQuery = useQuery(goalChildWorkspacesQueryOptions(workspaceId));
	const orchestratorQuery = useQuery(
		goalOrchestratorStateQueryOptions(workspaceId),
	);
	const assigneesQuery = useQuery({
		queryKey: helmorQueryKeys.goalAssignees(workspaceId),
		queryFn: () => listAssignees(workspaceId),
		enabled: childQuery.isSuccess,
		staleTime: 5_000,
	});

	const workspace = detailQuery.data;
	const childWorkspaces = childQuery.data ?? [];

	const orchestratorStatusByWorkspaceId = useMemo(() => {
		const map = new Map<string, string>();
		for (const issue of orchestratorQuery.data?.issues ?? []) {
			if (issue.childWorkspaceId) map.set(issue.childWorkspaceId, issue.state);
		}
		for (const retry of orchestratorQuery.data?.runtime.retries ?? []) {
			const issue = orchestratorQuery.data?.issues.find(
				(candidate) => candidate.id === retry.issueId,
			);
			if (issue?.childWorkspaceId) map.set(issue.childWorkspaceId, "retry");
		}
		for (const run of orchestratorQuery.data?.runtime.running ?? []) {
			if (run.workspaceId) map.set(run.workspaceId, run.phase);
		}
		return map;
	}, [orchestratorQuery.data]);

	const reportByWorkspaceId = useMemo(() => {
		const reports = new Map<string, AssigneeReportMarker>();
		for (const assignee of assigneesQuery.data ?? []) {
			if (assignee.latestReport)
				reports.set(assignee.workspaceId, assignee.latestReport);
		}
		return reports;
	}, [assigneesQuery.data]);

	// Compute unresolved PR comment count for the Comments tab badge.
	// Only query workspaces (and the goal itself) that already have an open PR
	// so we don't fire extra requests for every card on every render.
	const openPrWorkspaceIds = useMemo(() => {
		const ids: string[] = [];
		if (workspace?.prSyncState === "open") ids.push(workspace.id);
		for (const ws of childWorkspaces) {
			if (ws.prSyncState === "open") ids.push(ws.id);
		}
		return ids;
	}, [workspace, childWorkspaces]);

	const prCommentResults = useQueries({
		queries: openPrWorkspaceIds.map((id) =>
			workspacePrCommentsQueryOptions(id),
		),
	});

	const unresolvedCommentsCount = useMemo(
		() =>
			prCommentResults.reduce((sum, r) => {
				if (!r.data) return sum;
				return sum + r.data.comments.filter((c) => !c.isThreadResolved).length;
			}, 0),
		[prCommentResults],
	);

	const repoScriptsQuery = useQuery({
		queryKey: helmorQueryKeys.repoScripts(
			workspace?.repoId ?? "__none__",
			workspaceId,
		),
		queryFn: () => loadRepoScripts(workspace!.repoId, workspaceId),
		enabled: Boolean(workspace?.repoId),
		staleTime: 0,
	});
	const setupScript = repoScriptsQuery.data?.setupScript ?? null;
	const hasSetupScript = Boolean(setupScript?.trim());
	const setupScriptState = useScriptStatus(
		workspaceId,
		"setup",
		hasSetupScript,
	);

	useSetupAutoRun({
		repoId: workspace?.repoId ?? null,
		workspaceId,
		workspaceState: workspace?.state ?? null,
		setupScript,
		scriptsLoaded: repoScriptsQuery.isSuccess,
	});

	// Persist sidebar width
	useEffect(() => {
		try {
			window.localStorage.setItem(GOAL_SIDEBAR_WIDTH_KEY, String(sidebarWidth));
		} catch {
			// ignore
		}
	}, [sidebarWidth]);

	// Sidebar resize drag — dragging right expands, left shrinks
	useEffect(() => {
		if (!sidebarResizeState) return;
		let pendingWidth: number | null = null;
		let rafId: number | null = null;
		const flush = () => {
			rafId = null;
			if (pendingWidth === null) return;
			const next = pendingWidth;
			pendingWidth = null;
			setSidebarWidth(next);
		};
		const handleMouseMove = (event: globalThis.MouseEvent) => {
			const deltaX = event.clientX - sidebarResizeState.pointerX;
			const raw = sidebarResizeState.startWidth + deltaX;
			pendingWidth = Math.min(
				GOAL_SIDEBAR_MAX_WIDTH,
				Math.max(GOAL_SIDEBAR_MIN_WIDTH, raw),
			);
			if (rafId === null) rafId = window.requestAnimationFrame(flush);
		};
		const handleMouseUp = () => {
			if (rafId !== null) {
				window.cancelAnimationFrame(rafId);
				rafId = null;
			}
			flush();
			setSidebarResizeState(null);
		};
		const prevCursor = document.body.style.cursor;
		const prevSelect = document.body.style.userSelect;
		document.body.style.cursor = "ew-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			if (rafId !== null) window.cancelAnimationFrame(rafId);
			document.body.style.cursor = prevCursor;
			document.body.style.userSelect = prevSelect;
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [sidebarResizeState]);

	const handleSidebarResizeStart = useCallback(
		(event: { clientX: number; preventDefault(): void }) => {
			event.preventDefault();
			setSidebarResizeState({
				pointerX: event.clientX,
				startWidth: sidebarWidth,
			});
		},
		[sidebarWidth],
	);

	// Persist card detail panel width
	useEffect(() => {
		try {
			window.localStorage.setItem(
				GOAL_CARD_DETAIL_WIDTH_KEY,
				String(cardDetailWidth),
			);
		} catch {
			// ignore
		}
	}, [cardDetailWidth]);

	// Card detail panel resize drag
	useEffect(() => {
		if (!cardDetailResizeState) return;
		let pendingWidth: number | null = null;
		let rafId: number | null = null;
		const flush = () => {
			rafId = null;
			if (pendingWidth === null) return;
			const next = pendingWidth;
			pendingWidth = null;
			setCardDetailWidth(next);
		};
		const handleMouseMove = (event: globalThis.MouseEvent) => {
			const deltaX = event.clientX - cardDetailResizeState.pointerX;
			const raw = cardDetailResizeState.startWidth - deltaX;
			pendingWidth = Math.min(
				GOAL_CARD_DETAIL_MAX_WIDTH,
				Math.max(GOAL_CARD_DETAIL_MIN_WIDTH, raw),
			);
			if (rafId === null) rafId = window.requestAnimationFrame(flush);
		};
		const handleMouseUp = () => {
			if (rafId !== null) {
				window.cancelAnimationFrame(rafId);
				rafId = null;
			}
			flush();
			setCardDetailResizeState(null);
		};
		const prevCursor = document.body.style.cursor;
		const prevSelect = document.body.style.userSelect;
		document.body.style.cursor = "ew-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			if (rafId !== null) window.cancelAnimationFrame(rafId);
			document.body.style.cursor = prevCursor;
			document.body.style.userSelect = prevSelect;
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [cardDetailResizeState]);

	const handleCardDetailResizeStart = useCallback(
		(event: { clientX: number; preventDefault(): void }) => {
			event.preventDefault();
			setCardDetailResizeState({
				pointerX: event.clientX,
				startWidth: cardDetailWidth,
			});
		},
		[cardDetailWidth],
	);

	const invalidateBoard = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.goalChildWorkspaces(workspaceId),
			}),
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceGroups,
			}),
		]);
	}, [queryClient, workspaceId]);

	const saveGoalMeta = useCallback(
		async (title: string, description: string) => {
			await updateGoalWorkspaceMeta(
				workspaceId,
				title.trim() || null,
				description.trim() || null,
			);
			await queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceDetail(workspaceId),
			});
			setShowGoalSheet(false);
		},
		[workspaceId, queryClient],
	);

	const selectedWorkspace = useMemo(
		() => childWorkspaces.find((ws) => ws.id === selectedId) ?? null,
		[childWorkspaces, selectedId],
	);

	const moveMutation = useMutation({
		mutationFn: ({
			childWorkspaceId,
			status,
		}: {
			childWorkspaceId: string;
			status: WorkspaceStatus;
		}) => setGoalChildWorkspaceStatus(workspaceId, childWorkspaceId, status),
		onSuccess: invalidateBoard,
	});

	const handleMoveWorkspace = useCallback(
		(childWorkspace: WorkspaceDetail, status: WorkspaceStatus) => {
			moveMutation.mutate({ childWorkspaceId: childWorkspace.id, status });
		},
		[moveMutation],
	);

	const mergeMutation = useMutation({
		mutationFn: (childWorkspaceId: string) =>
			mergeWorkspaceChangeRequest(childWorkspaceId),
		onSuccess: () => {
			setPendingMerge(null);
			invalidateBoard();
		},
		onError: () => {
			setPendingMerge(null);
		},
	});

	const handleMergeWorkspace = useCallback((workspace: WorkspaceDetail) => {
		setPendingMerge(workspace);
	}, []);

	const landingCheckMutation = useMutation({
		mutationFn: (childWorkspaceId: string) =>
			reconcileWorkspaceLandingState(childWorkspaceId),
		onSuccess: async (result) => {
			if (result.landingState === "landed") {
				setPendingLandingCheck(null);
				setLandingCheckResult(null);
				await invalidateBoard();
				return;
			}
			setLandingCheckResult(
				result.landingState === "unknown" ? "unknown" : "unlanded",
			);
		},
	});

	const manualLandingMutation = useMutation({
		mutationFn: (childWorkspaceId: string) =>
			markWorkspaceLanded(childWorkspaceId),
		onSuccess: async () => {
			setPendingLandingCheck(null);
			setLandingCheckResult(null);
			await invalidateBoard();
		},
	});

	const handleCheckLanding = useCallback(
		(workspace: WorkspaceDetail) => {
			setPendingLandingCheck(workspace);
			setLandingCheckResult(null);
			landingCheckMutation.mutate(workspace.id);
		},
		[landingCheckMutation],
	);

	const createMutation = useMutation({
		mutationFn: async (title: string) =>
			createGoalChildWorkspaceAndStart({
				goalWorkspace: workspaceId,
				title,
				finalize: true,
			}),
		onSuccess: async (created) => {
			setSelectedId(created.workspaceId);
			setShowAddPanel(false);
			setNewWorkspaceTitle("");
			await Promise.all([
				invalidateBoard(),
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceDetail(created.workspaceId),
				}),
			]);
		},
	});

	const addWorkspace = () => {
		if (!newWorkspaceTitle.trim()) return;
		createMutation.mutate(newWorkspaceTitle.trim());
	};

	const handleSelectChildWorkspace = useCallback(
		(childWorkspace: WorkspaceDetail) => {
			setSelectedId(childWorkspace.id);
			setShowAddPanel(false);
		},
		[],
	);

	const handleSelectAssignee = useCallback(
		(childWorkspace: WorkspaceDetail) => {
			const sessionId = childWorkspace.activeSessionId;
			if (!sessionId || !onSelectWorkspaceSession) {
				handleSelectChildWorkspace(childWorkspace);
				return;
			}
			onSelectWorkspaceSession(childWorkspace.id, sessionId);
		},
		[handleSelectChildWorkspace, onSelectWorkspaceSession],
	);

	const handleTabChange = useCallback((tab: GoalTabView) => {
		setActiveTab(tab);
		if (tab !== "board") {
			setSelectedId(null);
			setShowAddPanel(false);
		}
	}, []);

	const handleShowAddCard = useCallback(() => {
		setActiveTab("board");
		setSelectedId(null);
		setShowAddPanel(true);
	}, []);

	const goalTitle = workspace?.goalTitle ?? workspace?.title ?? "Goal";
	const goalDescription = workspace?.goalDescription ?? null;
	const isGoalReadyForChildren = Boolean(
		workspace?.state === "ready" &&
			workspace.branch &&
			workspace.intendedTargetBranch &&
			workspace.prSyncState === "open",
	);
	const kanbanSnapshot = useMemo(
		() => createGoalKanbanSnapshot(childWorkspaces),
		[childWorkspaces],
	);

	return (
		<div className="flex min-h-0 flex-1 overflow-hidden bg-background">
			<GoalMetaSheet
				open={showGoalSheet}
				onOpenChange={setShowGoalSheet}
				initialTitle={workspace?.goalTitle ?? ""}
				initialDescription={workspace?.goalDescription ?? ""}
				onSave={saveGoalMeta}
			/>

			{/* Merge confirmation — shown when a card with an open change request is dropped on Merged */}
			<ConfirmDialog
				open={pendingMerge !== null}
				onOpenChange={(open) => {
					if (!open) setPendingMerge(null);
				}}
				title="Merge pull request"
				description={
					<>
						Merge the pull request for{" "}
						<span className="font-medium text-foreground">
							{pendingMerge?.title}
						</span>
						? This cannot be undone.
					</>
				}
				confirmLabel="Merge"
				cancelLabel="Cancel"
				onConfirm={() => {
					if (pendingMerge) mergeMutation.mutate(pendingMerge.id);
				}}
				loading={mergeMutation.isPending}
			/>

			{/* Landing check — shown when a card without an open change request is dropped on Merged */}
			<Dialog
				open={pendingLandingCheck !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPendingLandingCheck(null);
						setLandingCheckResult(null);
					}
				}}
			>
				<DialogContent
					className="max-w-[320px] gap-0 p-4"
					showCloseButton={false}
				>
					<DialogTitle className="text-[13px] font-semibold">
						Check landed state
					</DialogTitle>
					<DialogDescription className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
						{landingCheckMutation.isPending ? (
							<>
								Checking whether{" "}
								<span className="font-medium text-foreground">
									{pendingLandingCheck?.title}
								</span>{" "}
								has landed in the goal branch.
							</>
						) : landingCheckResult === "unknown" ? (
							<>
								Helmor could not verify whether{" "}
								<span className="font-medium text-foreground">
									{pendingLandingCheck?.title}
								</span>{" "}
								has landed in the goal branch. You can mark it landed manually
								after confirming the target branch contains the work.
							</>
						) : (
							<>
								<span className="font-medium text-foreground">
									{pendingLandingCheck?.title}
								</span>{" "}
								has not landed in the goal branch yet.
							</>
						)}
					</DialogDescription>
					<div className="mt-3 flex justify-end gap-2">
						{landingCheckResult === "unknown" ? (
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									if (pendingLandingCheck) {
										manualLandingMutation.mutate(pendingLandingCheck.id);
									}
								}}
								disabled={manualLandingMutation.isPending}
							>
								Mark landed
							</Button>
						) : null}
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								setPendingLandingCheck(null);
								setLandingCheckResult(null);
							}}
						>
							Got it
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{/* Permanent left sidebar — Pi + Assignees */}
			<GoalSidebar
				workspaceId={workspaceId}
				cards={childWorkspaces}
				kanbanSnapshot={kanbanSnapshot}
				goalTitle={goalTitle}
				goalDescription={goalDescription}
				canCreateCards={isGoalReadyForChildren}
				assignees={assigneesQuery.data ?? []}
				onSendingWorkspacesChange={onSendingWorkspacesChange}
				onCardCreated={(created) => setSelectedId(created.id)}
				onSelectAssignee={handleSelectAssignee}
				width={sidebarWidth}
				hitArea={GOAL_SIDEBAR_HIT_AREA}
				minWidth={GOAL_SIDEBAR_MIN_WIDTH}
				maxWidth={GOAL_SIDEBAR_MAX_WIDTH}
				onResizeStart={handleSidebarResizeStart}
			/>

			{/* Main content column */}
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				{/* Header */}
				<GoalHeader
					headerLeading={headerLeading}
					goalTitle={goalTitle}
					goalDescription={goalDescription}
					prSyncState={workspace?.prSyncState ?? null}
					workspaceState={workspace?.state ?? null}
					hasBranch={Boolean(workspace?.branch)}
					hasTargetBranch={Boolean(workspace?.intendedTargetBranch)}
					hasSetupScript={hasSetupScript}
					setupScriptsLoaded={repoScriptsQuery.isSuccess}
					setupScriptState={setupScriptState}
					commitButtonMode={commitButtonMode}
					commitButtonState={commitButtonState}
					changeRequest={changeRequest}
					changeRequestName={forgeDetection?.labels.changeRequestName ?? "PR"}
					forgeDetection={forgeDetection}
					forgeRemoteState={forgeRemoteState}
					workspaceId={workspaceId}
					hasGitChanges={hasGitChanges}
					forgeIsRefreshing={forgeIsRefreshing}
					onCommitAction={onCommitAction}
					onOpenChangeRequest={onOpenChangeRequest}
					onRefreshPrStatus={onRefreshPrStatus}
					onEditGoal={() => setShowGoalSheet(true)}
				/>

				{/* Tab bar */}
				<GoalTabBar
					activeTab={activeTab}
					onTabChange={handleTabChange}
					canCreateCards={isGoalReadyForChildren}
					onAddCard={handleShowAddCard}
					tabBadges={
						unresolvedCommentsCount > 0
							? { comments: unresolvedCommentsCount }
							: undefined
					}
				/>

				{orchestratorQuery.data?.errors.length ? (
					<div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive">
						{orchestratorQuery.data.errors[0]}
					</div>
				) : null}

				{/* Board tab */}
				{activeTab === "board" && (
					<div className="flex min-h-0 flex-1 overflow-hidden">
						<GoalBoard
							workspaces={childWorkspaces}
							selectedId={selectedId}
							dragState={dragState}
							dragOverLane={dragOverLane}
							onSelectWorkspace={handleSelectChildWorkspace}
							onSelectAssignee={handleSelectAssignee}
							reportByWorkspaceId={reportByWorkspaceId}
							orchestratorStatusByWorkspaceId={orchestratorStatusByWorkspaceId}
							onMoveWorkspace={handleMoveWorkspace}
							onMergeWorkspace={handleMergeWorkspace}
							onCheckLanding={handleCheckLanding}
							onDragStart={(childWorkspaceId, sourceLane) =>
								setDragState({ workspaceId: childWorkspaceId, sourceLane })
							}
							onDragEnd={() => {
								setDragState(null);
								setDragOverLane(null);
							}}
							onDragOverLane={setDragOverLane}
						/>

						{/* Add card form (no selected workspace) */}
						{showAddPanel && !selectedWorkspace && (
							<aside
								className="relative flex h-full shrink-0 flex-col border-l border-border/60 bg-sidebar/60"
								style={{ width: cardDetailWidth }}
							>
								<div
									role="separator"
									aria-orientation="vertical"
									aria-label="Resize panel"
									aria-valuemin={GOAL_CARD_DETAIL_MIN_WIDTH}
									aria-valuemax={GOAL_CARD_DETAIL_MAX_WIDTH}
									aria-valuenow={cardDetailWidth}
									tabIndex={0}
									onMouseDown={handleCardDetailResizeStart}
									className="group absolute inset-y-0 z-30 cursor-ew-resize touch-none outline-none"
									style={{
										left: `${-(GOAL_CARD_DETAIL_HIT_AREA / 2)}px`,
										width: `${GOAL_CARD_DETAIL_HIT_AREA}px`,
									}}
								/>
								<AddWorkspacePanel
									value={newWorkspaceTitle}
									onChange={setNewWorkspaceTitle}
									onClose={() => setShowAddPanel(false)}
									onSubmit={addWorkspace}
									busy={createMutation.isPending}
								/>
							</aside>
						)}

						{/* Card detail panel */}
						{selectedWorkspace && (
							<aside
								className="relative flex h-full shrink-0 flex-col"
								style={{ width: cardDetailWidth }}
							>
								<div
									role="separator"
									aria-orientation="vertical"
									aria-label="Resize card detail"
									aria-valuemin={GOAL_CARD_DETAIL_MIN_WIDTH}
									aria-valuemax={GOAL_CARD_DETAIL_MAX_WIDTH}
									aria-valuenow={cardDetailWidth}
									tabIndex={0}
									onMouseDown={handleCardDetailResizeStart}
									className="group absolute inset-y-0 z-30 cursor-ew-resize touch-none outline-none"
									style={{
										left: `${-(GOAL_CARD_DETAIL_HIT_AREA / 2)}px`,
										width: `${GOAL_CARD_DETAIL_HIT_AREA}px`,
									}}
								/>
								<GoalCardDetailPanel
									workspace={selectedWorkspace}
									onClose={() => setSelectedId(null)}
									onMove={(lane) =>
										handleMoveWorkspace(selectedWorkspace, lane)
									}
									onOpen={
										onSelectWorkspace
											? () => onSelectWorkspace(selectedWorkspace.id)
											: undefined
									}
									activeEditorPath={activeEditorPath}
									onOpenEditorFile={onOpenEditorFile}
									onOpenSettings={onOpenSettings}
								/>
							</aside>
						)}
					</div>
				)}

				{/* Changes tab */}
				{activeTab === "changes" && (
					<GoalChangesView
						goalWorkspace={workspace}
						workspaces={childWorkspaces}
						activeEditorPath={activeEditorPath}
						onOpenEditorFile={onOpenEditorFile}
						onSelectWorkspace={(ws) => {
							setActiveTab("board");
							handleSelectChildWorkspace(ws);
						}}
					/>
				)}

				{/* Comments tab */}
				{activeTab === "comments" && (
					<GoalCommentsView
						goalWorkspace={workspace}
						workspaces={childWorkspaces}
						onSelectWorkspace={(ws) => {
							setActiveTab("board");
							handleSelectChildWorkspace(ws);
						}}
					/>
				)}

				{/* Team tab */}
				{activeTab === "team" && (
					<GoalTeamView
						workspaces={childWorkspaces}
						assignees={assigneesQuery.data ?? []}
						onSelectWorkspace={(wsId) => {
							const ws = childWorkspaces.find((w) => w.id === wsId);
							if (!ws) return;
							setActiveTab("board");
							handleSelectChildWorkspace(ws);
						}}
					/>
				)}

				{/* Timeline tab */}
				{activeTab === "timeline" && (
					<GoalTimelineView
						workspaces={childWorkspaces}
						reportByWorkspaceId={reportByWorkspaceId}
						onSelectWorkspace={(ws) => {
							setActiveTab("board");
							handleSelectChildWorkspace(ws);
						}}
					/>
				)}

				{/* Terminal tab */}
				{activeTab === "terminal" && (
					<GoalTerminalView
						workspaceId={workspaceId}
						repoId={workspace?.repoId ?? null}
						onOpenSettings={onOpenSettings ?? (() => {})}
					/>
				)}

				{/* Branch tree tab */}
				{activeTab === "branch-tree" && (
					<BranchTreeView
						goalWorkspace={workspace}
						workspaces={childWorkspaces}
						onSelectWorkspace={(ws) => {
							setActiveTab("board");
							handleSelectChildWorkspace(ws);
						}}
					/>
				)}
			</div>
		</div>
	);
}

export type { GoalAiSurfaceContext, GoalAiSurfaceProps } from "./types";
