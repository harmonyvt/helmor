import type React from "react";
import type {
	AssigneeReportMarker,
	WorkspaceDetail,
	WorkspaceStatus,
} from "@/lib/api";
import { GOAL_LANES, groupGoalChildWorkspacesByLane } from "./board-model";
import { GoalLane } from "./lane";

type DragState = {
	workspaceId: string;
	sourceLane: WorkspaceStatus;
} | null;

type GoalBoardProps = {
	workspaces: WorkspaceDetail[];
	selectedId: string | null;
	dragState: DragState;
	dragOverLane: WorkspaceStatus | null;
	onSelectWorkspace: (workspace: WorkspaceDetail) => void;
	onSelectAssignee?: (workspace: WorkspaceDetail) => void;
	reportByWorkspaceId?: Map<string, AssigneeReportMarker>;
	orchestratorStatusByWorkspaceId?: Map<string, string>;
	onMoveWorkspace: (
		workspace: WorkspaceDetail,
		status: WorkspaceStatus,
	) => void;
	onDragStart: (workspaceId: string, sourceLane: WorkspaceStatus) => void;
	onDragEnd: () => void;
	onDragOverLane: (lane: WorkspaceStatus | null) => void;
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
	onDragStart,
	onDragEnd,
	onDragOverLane,
}: GoalBoardProps) {
	const byLane = groupGoalChildWorkspacesByLane(workspaces);

	const handleDragOver = (laneId: WorkspaceStatus, event: React.DragEvent) => {
		event.preventDefault();
		onDragOverLane(laneId);
	};

	const handleDrop = (laneId: WorkspaceStatus) => {
		if (!dragState || dragState.sourceLane === laneId) {
			onDragEnd();
			return;
		}
		const workspace = workspaces.find(
			(candidate) => candidate.id === dragState.workspaceId,
		);
		if (workspace) onMoveWorkspace(workspace, laneId);
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
				{GOAL_LANES.map((lane) => (
					<GoalLane
						key={lane.id}
						lane={lane}
						workspaces={byLane.get(lane.id) ?? []}
						isDragOver={dragOverLane === lane.id}
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
				))}
			</div>
		</div>
	);
}
