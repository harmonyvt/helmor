import { GitBranch } from "lucide-react";
import type { WorkspaceDetail } from "@/lib/api";
import { cn } from "@/lib/utils";

type WorkspaceCardProps = {
	workspace: WorkspaceDetail;
	isSelected: boolean;
	isDragging: boolean;
	onClick: () => void;
	onDragStart: () => void;
	onDragEnd: () => void;
};

export function WorkspaceCard({
	workspace: ws,
	isSelected,
	isDragging,
	onClick,
	onDragStart,
	onDragEnd,
}: WorkspaceCardProps) {
	const agentType = ws.activeSessionAgentType;

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
					<span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-medium capitalize text-accent-foreground">
						{agentType}
					</span>
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
		</article>
	);
}
