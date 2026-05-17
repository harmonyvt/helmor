import { ChevronRight, Target } from "lucide-react";
import { useState } from "react";
import { humanizeBranch } from "@/features/navigation/shared";
import type { WorkspaceRow as WorkspaceRowData } from "@/lib/api";
import { cn } from "@/lib/utils";
import { WorkspaceRow } from "./workspace-row";

export interface GoalSectionData {
	goalId: string;
	goalRow: WorkspaceRowData;
	children: WorkspaceRowData[];
}

interface GoalSectionProps {
	goalSection: GoalSectionData;
	selectedWorkspaceId: string | null;
	onWorkspaceSelect: (id: string) => void;
	onArchive?: (id: string) => void;
}

export function GoalSection({
	goalSection,
	selectedWorkspaceId,
	onWorkspaceSelect,
	onArchive,
}: GoalSectionProps) {
	const { goalRow, children } = goalSection;
	const [isOpen, setIsOpen] = useState(true);

	const displayTitle = goalRow.branch
		? humanizeBranch(goalRow.branch)
		: (goalRow.title ?? goalRow.directoryName ?? goalRow.id);

	const isGoalSelected = selectedWorkspaceId === goalRow.id;

	return (
		<div>
			{/* Goal section header — navigates to the goal workspace */}
			<div
				className={cn(
					"flex min-h-[52px] w-full cursor-pointer items-center gap-3 px-4",
					"bg-sidebar hover:bg-accent/50",
					isGoalSelected && "bg-accent",
				)}
				onClick={() => onWorkspaceSelect(goalRow.id)}
			>
				{/* Status dot */}
				<div
					className="shrink-0 rounded-full"
					style={{
						width: "3px",
						height: "20px",
						backgroundColor: "var(--workspace-sidebar-status-progress)",
					}}
				/>

				{/* Title + icon */}
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="flex min-w-0 items-center gap-1.5">
						<Target
							className="h-[11px] w-[11px] shrink-0 text-muted-foreground"
							strokeWidth={2}
						/>
						<span className="truncate text-sm font-medium text-foreground">
							{displayTitle}
						</span>
					</div>
					{goalRow.branch ? (
						<span className="truncate text-xs text-muted-foreground">
							{goalRow.branch}
						</span>
					) : null}
				</div>

				{/* Child count + expand/collapse chevron */}
				{children.length > 0 && (
					<button
						type="button"
						aria-label={isOpen ? "Collapse" : "Expand"}
						className="flex shrink-0 cursor-pointer items-center gap-1.5"
						onClick={(e) => {
							e.stopPropagation();
							setIsOpen((v) => !v);
						}}
					>
						<span className="text-xs text-muted-foreground/60">
							{children.length}
						</span>
						<ChevronRight
							className={cn(
								"h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-150",
								isOpen && "rotate-90",
							)}
							strokeWidth={2}
						/>
					</button>
				)}
			</div>

			{/* Child workspaces */}
			{isOpen && children.length > 0 && (
				<div className="ml-[22px] border-l border-border/40">
					{children.map((ws) => (
						<WorkspaceRow
							key={ws.id}
							workspace={ws}
							selected={selectedWorkspaceId === ws.id}
							onSelect={onWorkspaceSelect}
							onArchive={onArchive}
						/>
					))}
				</div>
			)}
		</div>
	);
}
