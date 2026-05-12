import { AlertTriangle, Bot, GitBranch } from "lucide-react";
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

/** Sonar-ping dot for running, filled dot for other statuses. */
function AgentStatusDot({ status }: { status: string }) {
	if (status === "running") {
		return (
			<span className="relative flex size-1.5 shrink-0">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
				<span className="relative inline-flex size-1.5 rounded-full bg-blue-500" />
			</span>
		);
	}
	return (
		<span
			className={cn(
				"size-1.5 shrink-0 rounded-full",
				status === "blocked" && "bg-destructive",
				status === "completed" && "bg-emerald-500",
				(status === "idle" || !status) && "bg-muted-foreground/30",
			)}
		/>
	);
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
	const isBlocked = status === "blocked";
	const isRunning = status === "running";
	const isCompleted = status === "completed";

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
					: isBlocked
						? "border-destructive/40 hover:border-destructive/60 hover:shadow-md"
						: isRunning
							? "border-blue-500/30 hover:border-blue-500/50 hover:shadow-md"
							: "border-border/70 hover:border-border hover:shadow-md",
				isDragging && "scale-[0.97] opacity-40",
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
						className={cn(
							"inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize transition-opacity hover:opacity-75",
							isBlocked
								? "bg-destructive/15 text-destructive"
								: isCompleted
									? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
									: "bg-accent text-accent-foreground",
						)}
						onClick={(event) => {
							if (!onAssigneeClick) return;
							event.stopPropagation();
							onAssigneeClick();
						}}
						title={`Open ${agentType} assignee thread`}
					>
						<Bot className="size-2.5 shrink-0" />
						<span>{agentType}</span>
						<AgentStatusDot status={status} />
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
						"mt-2 flex overflow-hidden rounded text-[10px] leading-snug",
						isBlocked
							? "bg-destructive/10 text-destructive"
							: isCompleted
								? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
								: "bg-muted/60 text-muted-foreground",
					)}
					title={latestReport.excerpt}
				>
					{/* Left-bar accent */}
					<span
						className={cn(
							"w-0.5 shrink-0 self-stretch",
							isBlocked
								? "bg-destructive"
								: isCompleted
									? "bg-emerald-500"
									: "bg-muted-foreground/30",
						)}
					/>
					<div className="flex min-w-0 flex-1 items-start gap-1.5 px-2 py-1">
						{isBlocked && (
							<AlertTriangle className="mt-px size-2.5 shrink-0 opacity-80" />
						)}
						<span className="line-clamp-2">{latestReport.excerpt}</span>
					</div>
				</div>
			) : null}
		</article>
	);
}
