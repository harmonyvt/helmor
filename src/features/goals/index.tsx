import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
	createGoalChildWorkspace,
	finalizeWorkspaceFromRepo,
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

	const detailQuery = useQuery(workspaceDetailQueryOptions(workspaceId));
	const childQuery = useQuery(goalChildWorkspacesQueryOptions(workspaceId));
	const workspace = detailQuery.data;
	const childWorkspaces = childQuery.data ?? [];

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
		mutationFn: async (title: string) => {
			const prepared = await createGoalChildWorkspace({
				goalWorkspaceId: workspaceId,
				title: title || undefined,
			});
			await finalizeWorkspaceFromRepo(prepared.workspaceId, {
				...(prepared.sourceStartBranch
					? { startBranch: prepared.sourceStartBranch, fetchStartBranch: true }
					: {}),
			});
			return prepared;
		},
		onSuccess: async (prepared) => {
			setSelectedId(prepared.workspaceId);
			setShowAddPanel(false);
			setNewWorkspaceTitle("");
			await Promise.all([
				invalidateBoard(),
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceDetail(prepared.workspaceId),
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
	const kanbanSnapshot = useMemo(
		() => createGoalKanbanSnapshot(childWorkspaces),
		[childWorkspaces],
	);

	const aiSurfaceProps: GoalAiSurfaceProps = {
		workspaceId,
		goalTitle: workspace?.goalTitle ?? null,
		goalDescription,
		kanbanSnapshot,
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
				onEditGoal={() => setShowGoalSheet(true)}
				onShowAi={() => {
					setShowAiPanel((isOpen) => !isOpen);
					setSelectedId(null);
					setShowAddPanel(false);
				}}
				onShowAddCard={() => {
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
					<aside className="flex w-72 min-h-0 shrink-0 flex-col border-l border-border/70 bg-sidebar/70">
						{showAiPanel ? (
							renderGoalAiSurface(aiSurfaceProps)
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
