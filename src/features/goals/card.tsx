import {
	AlertTriangle,
	Bot,
	GitBranch,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	MessageSquare,
} from "lucide-react";
import { useState } from "react";
import { WorkspaceHoverCard } from "@/features/navigation/workspace-hover-card";
import type {
	AssigneeReportMarker,
	PrSyncState,
	WorkspaceDetail,
	WorkspaceRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type WorkspaceCardProps = {
	workspace: WorkspaceDetail;
	isSelected: boolean;
	isDragging: boolean;
	canDrag?: boolean;
	onClick: () => void;
	onAssigneeClick?: () => void;
	latestReport?: AssigneeReportMarker | null;
	orchestratorStatus?: string | null;
	onDragStart: () => void;
	onDragEnd: () => void;
};

function agentStatus(
	ws: WorkspaceDetail,
	latestReport?: AssigneeReportMarker | null,
) {
	if (latestReport?.reportType === "blocked") return "blocked";
	if (latestReport?.reportType === "completed") return "completed";
	if (ws.activeSessionStatus === "streaming") return "running";
	return "idle";
}

function AgentStatusDot({ status }: { status: string }) {
	if (status === "running") {
		return (
			<span className="relative flex size-1.5 shrink-0">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
				<span className="relative inline-flex size-1.5 rounded-full bg-current" />
			</span>
		);
	}
	return (
		<span
			className={cn(
				"size-1.5 shrink-0 rounded-full",
				status === "blocked" && "bg-current",
				status === "completed" && "bg-current",
				status === "idle" && "bg-current opacity-30",
			)}
		/>
	);
}

function prBadgeMeta(prSyncState?: PrSyncState | null) {
	switch (prSyncState) {
		case "merged":
			return {
				label: "Merged",
				Icon: GitMerge,
				className:
					"bg-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_10%,transparent)] text-[var(--workspace-pr-merged-accent)]",
			};
		case "closed":
			return {
				label: "Closed",
				Icon: GitPullRequestClosed,
				className: "bg-destructive/10 text-destructive",
			};
		case "open":
			return {
				label: "Open",
				Icon: GitPullRequest,
				className:
					"bg-[color-mix(in_srgb,var(--workspace-pr-open-accent)_10%,transparent)] text-[var(--workspace-pr-open-accent)]",
			};
		default:
			return {
				label: "PR",
				Icon: GitPullRequest,
				className: "bg-muted/60 text-muted-foreground/70",
			};
	}
}

function detailToRow(ws: WorkspaceDetail): WorkspaceRow {
	return {
		id: ws.id,
		title: ws.title,
		directoryName: ws.directoryName,
		workspaceKind: ws.workspaceKind,
		goalWorkspaceId: ws.goalWorkspaceId,
		repoName: ws.repoName,
		repoIconSrc: ws.repoIconSrc,
		repoInitials: ws.repoInitials,
		status: ws.status,
		branch: ws.branch,
		activeSessionId: ws.activeSessionId,
		activeSessionTitle: ws.activeSessionTitle,
		activeSessionAgentType: ws.activeSessionAgentType,
		activeSessionStatus: ws.activeSessionStatus,
		primarySessionId: ws.activeSessionId,
		primarySessionTitle: ws.activeSessionTitle,
		prTitle: ws.prTitle,
		prSyncState: ws.prSyncState,
		prUrl: ws.prUrl,
		sessionCount: ws.sessionCount,
	};
}

export function WorkspaceCard({
	workspace: ws,
	isSelected,
	isDragging,
	canDrag = true,
	onClick,
	onAssigneeClick,
	latestReport,
	orchestratorStatus,
	onDragStart,
	onDragEnd,
}: WorkspaceCardProps) {
	const agentType = ws.activeSessionAgentType;
	const status = agentStatus(ws, latestReport);
	const isBlocked = status === "blocked";
	const isRunning = status === "running";
	const isCompleted = status === "completed";
	const prBadge = prBadgeMeta(ws.prSyncState);
	const PrBadgeIcon = prBadge.Icon;

	return (
		<article
			draggable={canDrag}
			onDragStart={canDrag ? onDragStart : undefined}
			onDragEnd={canDrag ? onDragEnd : undefined}
			onClick={onClick}
			className={cn(
				"group cursor-pointer select-none rounded-lg border bg-background/90 px-3 py-2.5 transition-all duration-150",
				isSelected
					? "border-ring/50 shadow-[0_0_0_2px_color-mix(in_oklch,var(--ring)_15%,transparent)] shadow-md"
					: isBlocked
						? "border-destructive/30 hover:border-destructive/50 hover:shadow-sm"
						: isRunning
							? "border-foreground/15 hover:border-foreground/25 hover:shadow-sm"
							: "border-border/50 hover:border-border/80 hover:shadow-sm",
				isDragging && "scale-[0.97] opacity-40",
			)}
		>
			{/* Title + agent status inline */}
			<div className="flex items-start gap-2">
				<h3 className="line-clamp-2 min-w-0 flex-1 text-[13px] font-medium leading-[1.4] tracking-[-0.005em]">
					{ws.title}
				</h3>
				{agentType && (
					<button
						type="button"
						className={cn(
							"mt-px inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize transition-opacity hover:opacity-70",
							isBlocked
								? "bg-destructive/12 text-destructive"
								: isCompleted
									? "bg-[color-mix(in_oklch,var(--workspace-sidebar-status-progress)_15%,transparent)] text-[color:var(--workspace-sidebar-status-progress)]"
									: isRunning
										? "bg-foreground/8 text-foreground/70"
										: "bg-muted/80 text-muted-foreground",
						)}
						onClick={(e) => {
							if (!onAssigneeClick) return;
							e.stopPropagation();
							onAssigneeClick();
						}}
						title={`Open active ${agentType} assignee`}
					>
						<Bot className="size-2.5 shrink-0" />
						<AgentStatusDot status={status} />
					</button>
				)}
			</div>

			{/* Branch */}
			{ws.branch && (
				<div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/60">
					<GitBranch className="size-2.5 shrink-0" />
					<span className="truncate font-mono">{ws.branch}</span>
				</div>
			)}

			{/* Footer badges */}
			{(ws.prUrl || ws.sessionCount > 0 || orchestratorStatus) && (
				<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
					{ws.sessionCount > 0 && (
						<span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
							<MessageSquare className="size-2.5" />
							{ws.sessionCount}
						</span>
					)}
					{ws.prUrl && (
						<span
							className={cn(
								"inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]",
								prBadge.className,
							)}
						>
							<PrBadgeIcon className="size-2.5" />
							{prBadge.label}
						</span>
					)}
					{orchestratorStatus && (
						<span
							className={cn(
								"rounded-md px-1.5 py-0.5 text-[10px] capitalize",
								orchestratorStatus === "running" ||
									orchestratorStatus === "claimed"
									? "bg-foreground/8 text-foreground/60"
									: orchestratorStatus === "failed" ||
											orchestratorStatus === "blocked"
										? "bg-destructive/12 text-destructive"
										: "bg-muted/60 text-muted-foreground/60",
							)}
						>
							{orchestratorStatus.replaceAll("-", " ")}
						</span>
					)}
				</div>
			)}

			{/* Report excerpt — no side-stripe */}
			{latestReport && (
				<div
					className={cn(
						"mt-2 rounded-md px-2 py-1.5 text-[10px] leading-snug",
						isBlocked
							? "bg-destructive/10 text-destructive"
							: isCompleted
								? "bg-[color-mix(in_oklch,var(--workspace-sidebar-status-progress)_12%,transparent)] text-[color:var(--workspace-sidebar-status-progress)]"
								: "bg-muted/50 text-muted-foreground",
					)}
				>
					<div className="flex min-w-0 items-start gap-1.5">
						{isBlocked && (
							<AlertTriangle className="mt-px size-2.5 shrink-0 opacity-80" />
						)}
						<span className="line-clamp-2">{latestReport.excerpt}</span>
					</div>
				</div>
			)}
		</article>
	);
}

export function WorkspaceCardWithHover(props: WorkspaceCardProps) {
	const { workspace: ws, isDragging } = props;
	const isSending = ws.activeSessionStatus === "streaming";
	// Track drag locally so we can suppress the hover card the moment a drag
	// starts — before the board re-renders and propagates isDragging back down.
	const [localDragging, setLocalDragging] = useState(false);

	return (
		<WorkspaceHoverCard
			row={detailToRow(ws)}
			isSending={isSending}
			disabled={localDragging || isDragging}
		>
			<div>
				<WorkspaceCard
					{...props}
					onDragStart={() => {
						setLocalDragging(true);
						props.onDragStart();
					}}
					onDragEnd={() => {
						setLocalDragging(false);
						props.onDragEnd();
					}}
				/>
			</div>
		</WorkspaceHoverCard>
	);
}
