import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useScriptStatus } from "@/features/inspector/hooks/use-script-status";
import { useSetupAutoRun } from "@/features/inspector/hooks/use-setup-auto-run";
import {
	createGoalChildWorkspaceAndStart,
	loadRepoScripts,
	setGoalChildWorkspaceStatus,
	updateGoalWorkspaceMeta,
	type WorkspaceDetail,
	type WorkspaceStatus,
} from "@/lib/api";
import {
	goalChildWorkspacesQueryOptions,
	helmorQueryKeys,
	workspaceDetailQueryOptions,
} from "@/lib/query-client";
import { GoalsAiPanel } from "./ai-panel";
import { GoalBoard } from "./board";
import { createGoalKanbanSnapshot } from "./board-model";
import { GoalHeader } from "./header";
import { GoalMetaSheet } from "./metadata-sheet";
import { AddWorkspacePanel, WorkspaceDetailPanel } from "./panels";
import type { GoalAiSurfaceProps, GoalWorkspaceContainerProps } from "./types";

const GOALS_AI_PANEL_WIDTH_KEY = "helmor.goalsAiPanelWidth";
const GOALS_AI_PANEL_DEFAULT_WIDTH = 420;
const GOALS_AI_PANEL_MIN_WIDTH = 320;
const GOALS_AI_PANEL_MAX_WIDTH = 720;
const GOALS_AI_PANEL_HIT_AREA = 20;

function getInitialGoalsAiPanelWidth() {
	if (typeof window === "undefined") return GOALS_AI_PANEL_DEFAULT_WIDTH;
	try {
		const stored = window.localStorage.getItem(GOALS_AI_PANEL_WIDTH_KEY);
		if (!stored) return GOALS_AI_PANEL_DEFAULT_WIDTH;
		const parsed = Number.parseInt(stored, 10);
		return Number.isFinite(parsed)
			? Math.min(
					GOALS_AI_PANEL_MAX_WIDTH,
					Math.max(GOALS_AI_PANEL_MIN_WIDTH, parsed),
				)
			: GOALS_AI_PANEL_DEFAULT_WIDTH;
	} catch {
		return GOALS_AI_PANEL_DEFAULT_WIDTH;
	}
}

type DragState = {
	workspaceId: string;
	sourceLane: WorkspaceStatus;
} | null;

export function GoalWorkspaceContainer({
	workspaceId,
	headerLeading,
	onSelectWorkspace,
	renderAiSurface,
}: GoalWorkspaceContainerProps) {
	const queryClient = useQueryClient();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [showAddPanel, setShowAddPanel] = useState(false);
	const [showAiPanel, setShowAiPanel] = useState(false);
	const [showGoalSheet, setShowGoalSheet] = useState(false);
	const [newWorkspaceTitle, setNewWorkspaceTitle] = useState("");
	const [dragState, setDragState] = useState<DragState>(null);
	const [dragOverLane, setDragOverLane] = useState<WorkspaceStatus | null>(
		null,
	);
	const [aiPanelWidth, setAiPanelWidth] = useState(getInitialGoalsAiPanelWidth);
	const [aiPanelResizeState, setAiPanelResizeState] = useState<{
		pointerX: number;
		startWidth: number;
	} | null>(null);

	const detailQuery = useQuery(workspaceDetailQueryOptions(workspaceId));
	const childQuery = useQuery(goalChildWorkspacesQueryOptions(workspaceId));
	const workspace = detailQuery.data;
	const childWorkspaces = childQuery.data ?? [];
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

	useEffect(() => {
		try {
			window.localStorage.setItem(
				GOALS_AI_PANEL_WIDTH_KEY,
				String(aiPanelWidth),
			);
		} catch {
			// ignore
		}
	}, [aiPanelWidth]);

	useEffect(() => {
		if (!aiPanelResizeState) return;
		let pendingWidth: number | null = null;
		let rafId: number | null = null;
		const flush = () => {
			rafId = null;
			if (pendingWidth === null) return;
			const next = pendingWidth;
			pendingWidth = null;
			setAiPanelWidth(next);
		};
		const handleMouseMove = (event: globalThis.MouseEvent) => {
			const deltaX = event.clientX - aiPanelResizeState.pointerX;
			const raw = aiPanelResizeState.startWidth - deltaX;
			pendingWidth = Math.min(
				GOALS_AI_PANEL_MAX_WIDTH,
				Math.max(GOALS_AI_PANEL_MIN_WIDTH, raw),
			);
			if (rafId === null) rafId = window.requestAnimationFrame(flush);
		};
		const handleMouseUp = () => {
			if (rafId !== null) {
				window.cancelAnimationFrame(rafId);
				rafId = null;
			}
			flush();
			setAiPanelResizeState(null);
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
	}, [aiPanelResizeState]);

	const handleAiPanelResizeStart = useCallback(
		(event: { clientX: number; preventDefault(): void }) => {
			event.preventDefault();
			setAiPanelResizeState({
				pointerX: event.clientX,
				startWidth: aiPanelWidth,
			});
		},
		[aiPanelWidth],
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
		() =>
			childWorkspaces.find((workspace) => workspace.id === selectedId) ?? null,
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
			setShowAiPanel(false);
		},
		[],
	);

	const isPanelOpen = selectedWorkspace !== null || showAddPanel || showAiPanel;
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

	const aiSurfaceProps: GoalAiSurfaceProps = {
		workspaceId,
		goalTitle: workspace?.goalTitle ?? null,
		goalDescription,
		kanbanSnapshot,
		canCreateCards: isGoalReadyForChildren,
		onClose: () => setShowAiPanel(false),
	};

	const renderGoalAiSurface =
		renderAiSurface ??
		((props: GoalAiSurfaceProps) => (
			<GoalsAiPanel
				workspaceId={props.workspaceId}
				cards={childWorkspaces}
				kanbanSnapshot={props.kanbanSnapshot}
				goalTitle={props.goalTitle}
				goalDescription={props.goalDescription}
				canCreateCards={isGoalReadyForChildren}
				onClose={props.onClose}
				onCardCreated={(createdWorkspace) => setSelectedId(createdWorkspace.id)}
			/>
		));

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-background">
			<GoalMetaSheet
				open={showGoalSheet}
				onOpenChange={setShowGoalSheet}
				initialTitle={workspace?.goalTitle ?? ""}
				initialDescription={workspace?.goalDescription ?? ""}
				onSave={saveGoalMeta}
			/>

			<GoalHeader
				headerLeading={headerLeading}
				goalTitle={goalTitle}
				goalDescription={goalDescription}
				prUrl={workspace?.prUrl}
				prSyncState={workspace?.prSyncState ?? null}
				workspaceState={workspace?.state ?? null}
				hasBranch={Boolean(workspace?.branch)}
				hasTargetBranch={Boolean(workspace?.intendedTargetBranch)}
				hasSetupScript={hasSetupScript}
				setupScriptsLoaded={repoScriptsQuery.isSuccess}
				setupScriptState={setupScriptState}
				canCreateCards={isGoalReadyForChildren}
				onEditGoal={() => setShowGoalSheet(true)}
				onShowAi={() => {
					if (!isGoalReadyForChildren) return;
					setShowAiPanel((isOpen) => !isOpen);
					setSelectedId(null);
					setShowAddPanel(false);
				}}
				onShowAddCard={() => {
					if (!isGoalReadyForChildren) return;
					setShowAddPanel(true);
					setSelectedId(null);
					setShowAiPanel(false);
				}}
			/>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<GoalBoard
					workspaces={childWorkspaces}
					selectedId={selectedId}
					dragState={dragState}
					dragOverLane={dragOverLane}
					onSelectWorkspace={handleSelectChildWorkspace}
					onMoveWorkspace={handleMoveWorkspace}
					onDragStart={(childWorkspaceId, sourceLane) => {
						setDragState({ workspaceId: childWorkspaceId, sourceLane });
					}}
					onDragEnd={() => {
						setDragState(null);
						setDragOverLane(null);
					}}
					onDragOverLane={setDragOverLane}
				/>

				{isPanelOpen ? (
					<aside
						className="relative flex min-h-0 shrink-0 flex-col border-l border-border/70 bg-sidebar/70"
						style={{ width: showAiPanel ? aiPanelWidth : 288 }}
					>
						{showAiPanel ? (
							<>
								<div
									role="separator"
									aria-orientation="vertical"
									aria-label="Resize AI panel"
									aria-valuemin={GOALS_AI_PANEL_MIN_WIDTH}
									aria-valuemax={GOALS_AI_PANEL_MAX_WIDTH}
									aria-valuenow={aiPanelWidth}
									tabIndex={0}
									onMouseDown={handleAiPanelResizeStart}
									className="group absolute inset-y-0 z-30 cursor-ew-resize touch-none outline-none"
									style={{
										left: `${-(GOALS_AI_PANEL_HIT_AREA / 2)}px`,
										width: `${GOALS_AI_PANEL_HIT_AREA}px`,
									}}
								/>
								{renderGoalAiSurface(aiSurfaceProps)}
							</>
						) : selectedWorkspace ? (
							<WorkspaceDetailPanel
								workspace={selectedWorkspace}
								parentWorkspaceTitle={workspace?.title ?? "Goal"}
								onClose={() => setSelectedId(null)}
								onMove={(lane) => handleMoveWorkspace(selectedWorkspace, lane)}
								onOpen={
									onSelectWorkspace
										? () => onSelectWorkspace(selectedWorkspace.id)
										: undefined
								}
							/>
						) : showAddPanel ? (
							<AddWorkspacePanel
								value={newWorkspaceTitle}
								onChange={setNewWorkspaceTitle}
								onClose={() => setShowAddPanel(false)}
								onSubmit={addWorkspace}
								busy={createMutation.isPending}
							/>
						) : null}
					</aside>
				) : null}
			</div>
		</div>
	);
}

export type { GoalAiSurfaceContext, GoalAiSurfaceProps } from "./types";
