import { Bot, Circle, GitBranch } from "lucide-react";
import type { AssigneeReportMarker, WorkspaceDetail } from "@/lib/api";
import { cn } from "@/lib/utils";

type WorkspaceCardProps = {
	workspace: WorkspaceDetail;
	isSelected: boolean;
	isDragging: boolean;
	onClick: () => void;
	onAssigneeClick?: () => void;
	latestReport?: AssigneeReportMarker | null;
	onDragStart: () => void;
	onDragEnd: () => void;
};

function assigneeStatus(
	ws: WorkspaceDetail,
	latestReport?: AssigneeReportMarker | null,
) {
	if (latestReport?.reportType === "blocked") return "blocked";
	if (latestReport?.reportType === "completed") return "completed";
	if (ws.activeSessionStatus === "streaming") return "running";
	return "idle";
}

function statusClass(status: string) {
	switch (status) {
		case "running":
			return "fill-blue-500 text-blue-500";
		case "blocked":
			return "fill-destructive text-destructive";
		case "completed":
			return "fill-emerald-500 text-emerald-500";
		default:
			return "fill-muted-foreground/50 text-muted-foreground/50";
	}
}

export function WorkspaceCard({
	workspace: ws,
	isSelected,
	isDragging,
	onClick,
	onAssigneeClick,
	latestReport,
	onDragStart,
	onDragEnd,
}: WorkspaceCardProps) {
	const agentType = ws.activeSessionAgentType;
	const status = assigneeStatus(ws, latestReport);

	return (
		<article
			draggable
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onClick={onClick}
			className={cn(
				"cursor-pointer select-none rounded-lg border bg-background p-3 shadow-sm transition-all duration-150",
				isSelected
					? "border-ring/60 shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_20%,transparent)]"
					: "border-border/70 hover:border-border hover:shadow-md",
				isDragging && "opacity-40 scale-[0.97]",
			)}
		>
			<h3 className="line-clamp-2 text-sm font-medium leading-5">{ws.title}</h3>
			{ws.branch ? (
				<div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
					<GitBranch className="size-2.5 shrink-0" />
					<span className="truncate font-mono">{ws.branch}</span>
				</div>
			) : null}
			<div className="mt-2 flex flex-wrap gap-1.5">
				{agentType ? (
					<button
						type="button"
						className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-medium capitalize text-accent-foreground hover:bg-accent/80"
						onClick={(event) => {
							if (!onAssigneeClick) return;
							event.stopPropagation();
							onAssigneeClick();
						}}
						title={`Open ${agentType} assignee thread`}
					>
						<Bot className="size-2.5" />
						<span>{agentType}</span>
						<Circle className={cn("size-1.5", statusClass(status))} />
					</button>
				) : null}
				{ws.prUrl ? (
					<span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						PR
					</span>
				) : null}
				{ws.sessionCount > 0 ? (
					<span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						{ws.sessionCount} {ws.sessionCount === 1 ? "thread" : "threads"}
					</span>
				) : null}
			</div>
			{latestReport ? (
				<div
					className={cn(
						"mt-2 line-clamp-2 rounded-md px-1.5 py-1 text-[10px] leading-snug",
						latestReport.reportType === "blocked"
							? "bg-destructive/10 text-destructive"
							: "bg-muted text-muted-foreground",
					)}
				>
					<span className="font-medium capitalize">
						{latestReport.reportType}
					</span>
					{": "}
					{latestReport.excerpt}
				</div>
			) : null}
		</article>
	);
}
