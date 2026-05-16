import type React from "react";
import type {
	AssigneeReportMarker,
	WorkspaceDetail,
	WorkspaceStatus,
} from "@/lib/api";
import {
	GOAL_LANES,
	type GoalLaneId,
	groupGoalChildWorkspacesByLane,
	hasOpenChangeRequest,
	isMovableGoalLaneId,
} from "./board-model";
import { GoalLane } from "./lane";

type DragState = {
	workspaceId: string;
	sourceLane: GoalLaneId;
} | null;

type GoalBoardProps = {
	workspaces: WorkspaceDetail[];
	selectedId: string | null;
	dragState: DragState;
	dragOverLane: GoalLaneId | null;
	onSelectWorkspace: (workspace: WorkspaceDetail) => void;
	onSelectAssignee?: (workspace: WorkspaceDetail) => void;
	reportByWorkspaceId?: Map<string, AssigneeReportMarker>;
	orchestratorStatusByWorkspaceId?: Map<string, string>;
	onMoveWorkspace: (
		workspace: WorkspaceDetail,
		status: WorkspaceStatus,
	) => void;
	/** Called when a card with an open change request is dropped on Merged. */
	onMergeWorkspace: (workspace: WorkspaceDetail) => void;
	/** Called when a card without an open change request is dropped on Merged. */
	onCheckLanding: (workspace: WorkspaceDetail) => void;
	onDragStart: (workspaceId: string, sourceLane: GoalLaneId) => void;
	onDragEnd: () => void;
	onDragOverLane: (lane: GoalLaneId | null) => void;
};

export function GoalBoard({
	workspaces,
	selectedId,
	dragState,
	dragOverLane,
	onSelectWorkspace,
	onSelectAssignee,
	reportByWorkspaceId,
	orchestratorStatusByWorkspaceId,
	onMoveWorkspace,
	onMergeWorkspace,
	onCheckLanding,
	onDragStart,
	onDragEnd,
	onDragOverLane,
}: GoalBoardProps) {
	const byLane = groupGoalChildWorkspacesByLane(workspaces);

	// Resolve the workspace being dragged so we can choose the Merged-lane flow.
	const draggedWorkspace = dragState
		? (workspaces.find((w) => w.id === dragState.workspaceId) ?? null)
		: null;
	const draggedHasOpenChangeRequest = hasOpenChangeRequest(draggedWorkspace);

	const handleDragOver = (laneId: GoalLaneId, event: React.DragEvent) => {
		if (laneId === "merged") {
			// Always preventDefault so the drop event fires; we handle
			// accept/reject inside handleDrop and show the appropriate dialog.
			event.preventDefault();
			onDragOverLane(laneId);
			return;
		}
		if (!isMovableGoalLaneId(laneId)) return;
		event.preventDefault();
		onDragOverLane(laneId);
	};

	const handleDrop = (laneId: GoalLaneId) => {
		if (laneId === "merged") {
			if (dragState) {
				const workspace = workspaces.find(
					(w) => w.id === dragState.workspaceId,
				);
				if (workspace) {
					if (draggedHasOpenChangeRequest) {
						onMergeWorkspace(workspace);
					} else {
						onCheckLanding(workspace);
					}
				}
			}
			onDragEnd();
			return;
		}

		if (
			!dragState ||
			dragState.sourceLane === laneId ||
			!isMovableGoalLaneId(laneId)
		) {
			onDragEnd();
			return;
		}
		const workspace = workspaces.find(
			(candidate) => candidate.id === dragState.workspaceId,
		);
		if (workspace) onMoveWorkspace(workspace, laneId as WorkspaceStatus);
		onDragEnd();
	};

	const handleDragLeave = (event: React.DragEvent) => {
		if (
			!(event.currentTarget as HTMLElement).contains(
				event.relatedTarget as Node,
			)
		) {
			onDragOverLane(null);
		}
	};

	return (
		<div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
			<div className="flex h-full gap-3 p-4">
				{GOAL_LANES.map((lane) => {
					const isOver = dragOverLane === lane.id;
					const isDragRejected =
						isOver && lane.id === "merged" && !draggedHasOpenChangeRequest;
					return (
						<GoalLane
							key={lane.id}
							lane={lane}
							workspaces={byLane.get(lane.id) ?? []}
							isDragOver={isOver}
							isDragRejected={isDragRejected}
							draggedId={dragState?.workspaceId ?? null}
							selectedId={selectedId}
							onCardClick={onSelectWorkspace}
							onAssigneeClick={onSelectAssignee}
							reportByWorkspaceId={reportByWorkspaceId}
							orchestratorStatusByWorkspaceId={orchestratorStatusByWorkspaceId}
							onDragStart={onDragStart}
							onDragEnd={onDragEnd}
							onDragOver={(event) => handleDragOver(lane.id, event)}
							onDrop={() => handleDrop(lane.id)}
							onDragLeave={handleDragLeave}
						/>
					);
				})}
			</div>
		</div>
	);
}
