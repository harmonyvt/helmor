import type React from "react";
import type {
	AssigneeReportMarker,
	WorkspaceDetail,
	WorkspaceStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type { GoalLaneDefinition } from "./board-model";
import { WorkspaceCard } from "./card";

type GoalLaneProps = {
	lane: GoalLaneDefinition;
	workspaces: WorkspaceDetail[];
	isDragOver: boolean;
	draggedId: string | null;
	selectedId: string | null;
	onCardClick: (workspace: WorkspaceDetail) => void;
	onAssigneeClick?: (workspace: WorkspaceDetail) => void;
	reportByWorkspaceId?: Map<string, AssigneeReportMarker>;
	onDragStart: (id: string, lane: WorkspaceStatus) => void;
	onDragEnd: () => void;
	onDragOver: (event: React.DragEvent) => void;
	onDrop: () => void;
	onDragLeave: (event: React.DragEvent) => void;
};

export function GoalLane({
	lane,
	workspaces,
	isDragOver,
	draggedId,
	selectedId,
	onCardClick,
	onAssigneeClick,
	reportByWorkspaceId,
	onDragStart,
	onDragEnd,
	onDragOver,
	onDrop,
	onDragLeave,
}: GoalLaneProps) {
	return (
		<div
			className={cn(
				"flex min-h-0 w-52 shrink-0 flex-col rounded-xl border transition-colors duration-150",
				isDragOver
					? "border-ring/60 bg-accent/30"
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
				{workspaces.map((workspace) => (
					<WorkspaceCard
						key={workspace.id}
						workspace={workspace}
						isSelected={selectedId === workspace.id}
						isDragging={draggedId === workspace.id}
						onClick={() => onCardClick(workspace)}
						onAssigneeClick={
							onAssigneeClick ? () => onAssigneeClick(workspace) : undefined
						}
						latestReport={reportByWorkspaceId?.get(workspace.id) ?? null}
						onDragStart={() => onDragStart(workspace.id, workspace.status)}
						onDragEnd={onDragEnd}
					/>
				))}
				{workspaces.length === 0 ? (
					<div
						className={cn(
							"rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground transition-colors duration-150",
							isDragOver ? "border-ring/50 bg-accent/20" : "border-border/70",
						)}
					>
						{isDragOver ? "Drop here" : "No cards"}
					</div>
				) : isDragOver ? (
					<div className="rounded-lg border-2 border-dashed border-ring/50 px-3 py-4" />
				) : null}
			</div>
		</div>
	);
}
