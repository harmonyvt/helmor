import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Loader2,
} from "lucide-react";
import { useState } from "react";
import type { AssigneeSummary, WorkspaceDetail } from "@/lib/api";
import { cn } from "@/lib/utils";

type AssigneeTone = "running" | "blocked" | "done" | "idle";

function assigneeStatusInfo(a: AssigneeSummary): {
	label: string;
	tone: AssigneeTone;
} {
	if (a.latestReport?.reportType === "blocked")
		return { label: "blocked", tone: "blocked" };
	if (a.latestReport?.reportType === "completed")
		return { label: "done", tone: "done" };
	if (a.sessionStatus === "streaming")
		return { label: "running", tone: "running" };
	return { label: "idle", tone: "idle" };
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
	if (tone === "blocked")
		return <AlertTriangle className={cn(cls, "shrink-0 text-destructive")} />;
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

	return (
		<div
			role={handleClick ? "button" : undefined}
			title={assignee.title}
			onClick={handleClick}
			className={cn(
				"relative flex size-[18px] shrink-0 items-center justify-center rounded-full",
				tone === "blocked" && "bg-destructive/15",
				tone === "done" &&
					"bg-[color:var(--workspace-sidebar-status-progress)]/15",
				tone === "running" && "bg-foreground/10",
				tone === "idle" && "bg-muted/40",
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
	const { tone } = assigneeStatusInfo(assignee);
	return (
		<button
			type="button"
			onClick={onSelect}
			disabled={!onSelect}
			className={cn(
				"group flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
				onSelect ? "cursor-pointer hover:bg-accent/50" : "cursor-default",
			)}
		>
			<StatusIcon tone={tone} />
			<span className="min-w-0 flex-1 truncate text-[12px] text-foreground/80">
				{assignee.title}
			</span>
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
	const [isCollapsed, setIsCollapsed] = useState(false);

	if (!assignees.length) return null;

	return (
		<div className="mb-2 overflow-hidden rounded-lg border border-border/50 bg-sidebar/50">
			{/* Header — always visible, toggles expand/collapse */}
			<button
				type="button"
				onClick={() => setIsCollapsed((v) => !v)}
				className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors hover:bg-accent/30"
			>
				<span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
					Assignees
				</span>

				{/* Icon chips visible only when collapsed */}
				{isCollapsed && (
					<div className="ml-1 flex items-center gap-1">
						{assignees.map((a) => (
							<AssigneeChip
								key={a.workspaceId}
								assignee={a}
								cards={cards}
								onSelectAssignee={onSelectAssignee}
							/>
						))}
					</div>
				)}

				<span className="ml-auto rounded-full bg-muted/60 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground/60">
					{assignees.length}
				</span>
				{isCollapsed ? (
					<ChevronDown className="size-3 shrink-0 text-muted-foreground/50" />
				) : (
					<ChevronUp className="size-3 shrink-0 text-muted-foreground/50" />
				)}
			</button>

			{/* Collapsible list — animated via grid-rows transition */}
			<div
				className={cn(
					"grid transition-[grid-template-rows] duration-200",
					isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
				)}
			>
				<div className="overflow-hidden">
					<div className="max-h-44 overflow-y-auto border-t border-border/30 pb-1">
						{assignees.map((a) => {
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
					</div>
				</div>
			</div>
		</div>
	);
}
