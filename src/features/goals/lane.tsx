import type React from "react";
import type { AssigneeReportMarker, WorkspaceDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	type GoalLaneDefinition,
	isMergedGoalWorkspace,
	isMovableGoalLaneId,
} from "./board-model";
import { WorkspaceCardWithHover } from "./card";

type GoalLaneProps = {
	lane: GoalLaneDefinition;
	workspaces: WorkspaceDetail[];
	isDragOver: boolean;
	/** True when a non-mergeable card is being dragged over the Merged lane. */
	isDragRejected?: boolean;
	draggedId: string | null;
	selectedId: string | null;
	onCardClick: (workspace: WorkspaceDetail) => void;
	onAssigneeClick?: (workspace: WorkspaceDetail) => void;
	reportByWorkspaceId?: Map<string, AssigneeReportMarker>;
	orchestratorStatusByWorkspaceId?: Map<string, string>;
	onDragStart: (id: string, lane: GoalLaneDefinition["id"]) => void;
	onDragEnd: () => void;
	onDragOver: (event: React.DragEvent) => void;
	onDrop: () => void;
	onDragLeave: (event: React.DragEvent) => void;
};

export function GoalLane({
	lane,
	workspaces,
	isDragOver,
	isDragRejected = false,
	draggedId,
	selectedId,
	onCardClick,
	onAssigneeClick,
	reportByWorkspaceId,
	orchestratorStatusByWorkspaceId,
	onDragStart,
	onDragEnd,
	onDragOver,
	onDrop,
	onDragLeave,
}: GoalLaneProps) {
	const acceptsDrop = isMovableGoalLaneId(lane.id);
	// The merged lane accepts drops via its own dialog flow.
	const showDropHint = isDragOver && (acceptsDrop || lane.id === "merged");

	return (
		<div
			className={cn(
				"flex min-h-0 w-60 shrink-0 flex-col rounded-xl border transition-colors duration-150",
				isDragRejected
					? "border-destructive/40 bg-destructive/8"
					: isDragOver && lane.id === "merged"
						? "border-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_50%,var(--ring))] bg-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_12%,transparent)]"
						: isDragOver
							? "border-ring/60 bg-accent/30"
							: lane.id === "merged"
								? "border-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_26%,var(--border))] bg-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_5%,transparent)]"
								: "border-border/70 bg-muted/20",
			)}
			onDragOver={onDragOver}
			onDrop={onDrop}
			onDragLeave={onDragLeave}
		>
			<div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2">
				<div className="flex items-center gap-2">
					<span
						className="size-2 shrink-0 rounded-full"
						style={{ backgroundColor: lane.color }}
						aria-hidden="true"
					/>
					<h2 className="text-sm font-medium">{lane.label}</h2>
				</div>
				<span className="rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
					{workspaces.length}
				</span>
			</div>

			<div className="flex flex-col gap-2 overflow-y-auto p-2">
				{workspaces.map((workspace) => {
					const canDrag = acceptsDrop && !isMergedGoalWorkspace(workspace);
					return (
						<WorkspaceCardWithHover
							key={workspace.id}
							workspace={workspace}
							isSelected={selectedId === workspace.id}
							isDragging={draggedId === workspace.id}
							canDrag={canDrag}
							onClick={() => onCardClick(workspace)}
							onAssigneeClick={
								onAssigneeClick ? () => onAssigneeClick(workspace) : undefined
							}
							latestReport={reportByWorkspaceId?.get(workspace.id) ?? null}
							orchestratorStatus={
								orchestratorStatusByWorkspaceId?.get(workspace.id) ?? null
							}
							onDragStart={() => onDragStart(workspace.id, lane.id)}
							onDragEnd={onDragEnd}
						/>
					);
				})}
				{workspaces.length === 0 ? (
					<div
						className={cn(
							"rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground transition-colors duration-150",
							isDragRejected
								? "border-destructive/40 bg-destructive/8 text-destructive"
								: isDragOver
									? "border-ring/50 bg-accent/20"
									: "border-border/70",
						)}
					>
						{isDragRejected
							? "No open PR"
							: showDropHint
								? lane.id === "merged"
									? "Drop to merge"
									: "Drop here"
								: lane.emptyLabel}
					</div>
				) : isDragRejected ? (
					<div className="rounded-lg border-2 border-dashed border-destructive/40 px-3 py-4 text-center text-xs text-destructive">
						No open PR
					</div>
				) : showDropHint ? (
					<div className="rounded-lg border-2 border-dashed border-ring/50 px-3 py-4" />
				) : null}
			</div>
		</div>
	);
}
