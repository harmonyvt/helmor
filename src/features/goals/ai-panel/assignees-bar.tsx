import {
	AlertTriangle,
	Bot,
	CalendarClock,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Loader2,
	MessageSquareText,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import type { AssigneeSummary, WorkspaceDetail } from "@/lib/api";
import { cn } from "@/lib/utils";

type AssigneeTone =
	| "running"
	| "queued"
	| "blocked"
	| "done"
	| "failed"
	| "idle";

function assigneeStatusInfo(a: AssigneeSummary): {
	label: string;
	tone: AssigneeTone;
} {
	if (a.activeRunStatus === "failed" && !a.sessionStatus?.includes("streaming"))
		return { label: "failed", tone: "failed" };
	if (a.sessionStatus === "streaming" || a.activeRunStatus === "running")
		return { label: "running", tone: "running" };
	if ((a.pendingRunCount ?? 0) > 0 || a.activeRunStatus === "queued")
		return { label: "queued", tone: "queued" };
	if (a.latestReport?.reportType === "blocked")
		return { label: "blocked", tone: "blocked" };
	if (a.latestReport?.reportType === "completed")
		return { label: "done", tone: "done" };
	return { label: "idle", tone: "idle" };
}

function parseTimestamp(value: string | null | undefined): Date | null {
	if (!value) return null;
	const normalized =
		value.includes("T") || /[zZ]$/.test(value)
			? value
			: `${value.replace(" ", "T")}Z`;
	const date = new Date(normalized);
	return Number.isNaN(date.getTime()) ? null : date;
}

function relativeTime(value: string | null | undefined): string | null {
	const date = parseTimestamp(value);
	if (!date) return null;
	const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
	if (seconds < 60) return "now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function runTimingLabel(a: AssigneeSummary): string | null {
	const run = a.latestRun;
	if (!run) return null;
	if (run.status === "queued")
		return `queued ${relativeTime(run.createdAt) ?? "recently"}`;
	if (run.status === "running")
		return `running ${relativeTime(run.startedAt ?? run.lastEventAt ?? run.createdAt) ?? "now"}`;
	if (run.status === "completed")
		return `completed ${relativeTime(run.completedAt ?? run.lastEventAt) ?? "recently"}`;
	if (run.status === "failed")
		return `failed ${relativeTime(run.completedAt ?? run.lastEventAt) ?? "recently"}`;
	return `${run.status} ${relativeTime(run.lastEventAt ?? run.createdAt) ?? ""}`.trim();
}

function assigneeSortScore(assignee: AssigneeSummary): number {
	const { tone } = assigneeStatusInfo(assignee);
	if (tone === "failed") return 50;
	if (tone === "blocked") return 40;
	if (tone === "running") return 30;
	if (tone === "queued") return 20;
	if (tone === "done") return 10;
	return 0;
}

function statusCounts(assignees: AssigneeSummary[]) {
	return assignees.reduce(
		(acc, assignee) => {
			acc[assigneeStatusInfo(assignee).tone] += 1;
			return acc;
		},
		{
			running: 0,
			queued: 0,
			blocked: 0,
			done: 0,
			failed: 0,
			idle: 0,
		} satisfies Record<AssigneeTone, number>,
	);
}

function StatusIcon({
	tone,
	size = "sm",
}: {
	tone: AssigneeTone;
	size?: "sm" | "xs";
}) {
	const cls = size === "xs" ? "size-2.5" : "size-3";
	if (tone === "running")
		return (
			<Loader2
				className={cn(cls, "shrink-0 animate-spin text-foreground/70")}
			/>
		);
	if (tone === "queued")
		return <Loader2 className={cn(cls, "shrink-0 text-muted-foreground/50")} />;
	if (tone === "blocked")
		return <AlertTriangle className={cn(cls, "shrink-0 text-destructive")} />;
	if (tone === "failed")
		return <XCircle className={cn(cls, "shrink-0 text-destructive/70")} />;
	if (tone === "done")
		return (
			<CheckCircle2
				className={cn(
					cls,
					"shrink-0 text-[color:var(--workspace-sidebar-status-progress)]",
				)}
			/>
		);
	return <Bot className={cn(cls, "shrink-0 text-muted-foreground/50")} />;
}

/** Compact circular icon chip shown in the collapsed header row. */
function AssigneeChip({
	assignee,
	cards,
	onSelectAssignee,
}: {
	assignee: AssigneeSummary;
	cards: WorkspaceDetail[];
	onSelectAssignee?: (ws: WorkspaceDetail) => void;
}) {
	const { tone } = assigneeStatusInfo(assignee);
	const ws = cards.find((c) => c.id === assignee.workspaceId);
	const handleClick =
		ws && onSelectAssignee
			? (e: React.MouseEvent) => {
					e.stopPropagation();
					onSelectAssignee(ws);
				}
			: undefined;

	const chipTitle =
		tone === "failed" && assignee.lastRunError
			? `${assignee.title} — ${assignee.lastRunError}`
			: assignee.title;

	return (
		<div
			role={handleClick ? "button" : undefined}
			title={chipTitle}
			onClick={handleClick}
			className={cn(
				"relative flex size-[18px] shrink-0 items-center justify-center rounded-full",
				tone === "blocked" && "bg-destructive/15",
				tone === "failed" && "bg-destructive/10",
				tone === "done" &&
					"bg-[color:var(--workspace-sidebar-status-progress)]/15",
				tone === "running" && "bg-foreground/10",
				(tone === "queued" || tone === "idle") && "bg-muted/40",
				handleClick && "cursor-pointer transition-opacity hover:opacity-70",
			)}
		>
			{tone === "running" && (
				<span className="absolute inset-0 animate-ping rounded-full bg-foreground/20 opacity-60" />
			)}
			<StatusIcon tone={tone} size="xs" />
		</div>
	);
}

/** A single assignee row in the expanded list. */
function AssigneeRow({
	assignee,
	onSelect,
}: {
	assignee: AssigneeSummary;
	onSelect?: () => void;
}) {
	const { tone, label } = assigneeStatusInfo(assignee);
	const pendingCount = assignee.pendingRunCount ?? 0;
	const run = assignee.latestRun;
	const timing = runTimingLabel(assignee);
	const modelLabel = run?.modelId ?? assignee.assigneeName;
	return (
		<button
			type="button"
			onClick={onSelect}
			disabled={!onSelect}
			className={cn(
				"group flex w-full flex-col gap-1.5 px-3 py-2 text-left transition-colors",
				onSelect ? "cursor-pointer hover:bg-accent/50" : "cursor-default",
			)}
		>
			<div className="flex w-full items-center gap-2">
				<StatusIcon tone={tone} />
				<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/85">
					{assignee.title}
				</span>
				<span
					className={cn(
						"shrink-0 rounded px-1.5 py-px text-[9px] font-medium",
						tone === "failed" || tone === "blocked"
							? "bg-destructive/10 text-destructive/85"
							: tone === "done"
								? "bg-[color:var(--workspace-sidebar-status-progress)]/12 text-[color:var(--workspace-sidebar-status-progress)]"
								: "bg-muted/70 text-muted-foreground/70",
					)}
				>
					{label}
				</span>
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-[10px] text-muted-foreground/65">
				<span className="inline-flex min-w-0 items-center gap-1">
					<Bot className="size-2.5 shrink-0" />
					<span className="truncate">{modelLabel}</span>
				</span>
				{timing && (
					<span className="inline-flex min-w-0 items-center gap-1">
						<CalendarClock className="size-2.5 shrink-0" />
						<span className="truncate">{timing}</span>
					</span>
				)}
				{pendingCount > 1 && (
					<span className="tabular-nums">{pendingCount - 1} queued behind</span>
				)}
			</div>
			{run?.prompt && (
				<p className="line-clamp-2 pl-5 text-[10px] leading-snug text-muted-foreground/75">
					{run.prompt.replace(
						/^Supervisor update from Goals Pi\s*\([^)]+\):\s*/i,
						"",
					)}
				</p>
			)}
			{tone === "failed" && assignee.lastRunError && (
				<p className="line-clamp-2 pl-5 text-[10px] leading-snug text-destructive/75">
					{assignee.lastRunError}
				</p>
			)}
			{tone !== "failed" && assignee.latestReport?.excerpt && (
				<p className="line-clamp-2 pl-5 text-[10px] leading-snug text-muted-foreground/70">
					{assignee.latestReport.excerpt}
				</p>
			)}
		</button>
	);
}

type AssigneesBarProps = {
	assignees: AssigneeSummary[];
	cards: WorkspaceDetail[];
	onSelectAssignee?: (ws: WorkspaceDetail) => void;
};

export function AssigneesBar({
	assignees,
	cards,
	onSelectAssignee,
}: AssigneesBarProps) {
	const [isCollapsed, setIsCollapsed] = useState(true);

	if (!assignees.length) return null;
	const sorted = [...assignees].sort((a, b) => {
		const scoreDiff = assigneeSortScore(b) - assigneeSortScore(a);
		if (scoreDiff !== 0) return scoreDiff;
		return a.title.localeCompare(b.title);
	});
	const counts = statusCounts(assignees);
	const activeCount = counts.running + counts.queued;
	const problemCount = counts.failed + counts.blocked;

	return (
		<div className="mb-2 overflow-hidden rounded-lg border border-border/50 bg-sidebar/50">
			<button
				type="button"
				onClick={() => setIsCollapsed((v) => !v)}
				className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors hover:bg-accent/30"
			>
				<span className="text-[10px] font-semibold uppercase tracking-normal text-muted-foreground/60">
					Assignees
				</span>

				{isCollapsed && (
					<div className="ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
						{sorted.slice(0, 8).map((a) => (
							<AssigneeChip
								key={a.workspaceId}
								assignee={a}
								cards={cards}
								onSelectAssignee={onSelectAssignee}
							/>
						))}
					</div>
				)}

				<div className="ml-auto flex shrink-0 items-center gap-1">
					{activeCount > 0 && (
						<span className="inline-flex items-center gap-1 rounded-full bg-foreground/8 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground/70">
							<Loader2 className="size-2.5" />
							{activeCount}
						</span>
					)}
					{problemCount > 0 && (
						<span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-px text-[10px] tabular-nums text-destructive/80">
							<AlertTriangle className="size-2.5" />
							{problemCount}
						</span>
					)}
					<span className="rounded-full bg-muted/60 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground/60">
						{assignees.length}
					</span>
				</div>
				{isCollapsed ? (
					<ChevronDown className="size-3 shrink-0 text-muted-foreground/50" />
				) : (
					<ChevronUp className="size-3 shrink-0 text-muted-foreground/50" />
				)}
			</button>

			<div
				className={cn(
					"grid transition-[grid-template-rows] duration-200",
					isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
				)}
			>
				<div className="overflow-hidden">
					<div className="max-h-44 overflow-y-auto border-t border-border/30 pb-1">
						{sorted.map((a) => {
							const ws = cards.find((c) => c.id === a.workspaceId);
							return (
								<AssigneeRow
									key={a.workspaceId}
									assignee={a}
									onSelect={
										ws && onSelectAssignee
											? () => onSelectAssignee(ws)
											: undefined
									}
								/>
							);
						})}
						{sorted.some((a) => a.latestRun) && (
							<div className="flex items-center gap-1.5 border-t border-border/20 px-3 pt-1.5 pb-1 text-[10px] text-muted-foreground/55">
								<MessageSquareText className="size-2.5 shrink-0" />
								<span className="truncate">
									Status comes from durable assignee runs and latest reports.
								</span>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
