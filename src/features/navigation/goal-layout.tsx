import {
	Archive,
	ArrowRight,
	Bot,
	ChevronRight,
	Circle,
	Folder,
	FolderOpen,
	Layers,
	LoaderCircle,
	Trash2,
} from "lucide-react";
import { memo, useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ShineBorder } from "@/components/ui/shine-border";
import { GOAL_LANES, isMovableGoalLaneId } from "@/features/goals/board-model";
import type { WorkspaceRow, WorkspaceStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { WorkspaceAvatar } from "./avatar";
import { type DeleteGoalAction, DeleteGoalDialog } from "./delete-goal-dialog";
import { WorkspaceRowItem, type WorkspaceRowItemProps } from "./row-item";
import {
	GroupIcon,
	humanizeBranch,
	STATUS_OPTIONS,
	workspaceStatusToTone,
} from "./shared";
import type {
	GoalGroup,
	GoalProjectGroup,
	GoalProjection,
} from "./sidebar-projection";

// ---------------------------------------------------------------------------
// Virtual item types
// ---------------------------------------------------------------------------

export type GoalVirtualItem =
	| { kind: "project-header"; projectGroup: GoalProjectGroup; isOpen: boolean }
	| {
			kind: "goal-header";
			goalGroup: GoalGroup;
			isOpen: boolean;
			indent: number;
	  }
	| {
			kind: "goal-child";
			row: WorkspaceRow;
			goalWorkspaceId: string;
			isLast: boolean;
			indent: number;
	  }
	| {
			kind: "goal-lane-drop";
			lane: WorkspaceStatus;
			laneLabel: string;
			laneColor: string;
			goalWorkspaceId: string;
			indent: number;
	  }
	| { kind: "ungrouped-header"; count: number; isOpen: boolean }
	| { kind: "ungrouped-row"; row: WorkspaceRow }
	| { kind: "archived-goals-header"; count: number; isOpen: boolean }
	| { kind: "archived-goal-row"; row: WorkspaceRow }
	| { kind: "group-gap"; size: number }
	| { kind: "bottom-padding" };

export const GOAL_PROJECT_HEADER_HEIGHT = 36;
export const GOAL_HEADER_HEIGHT = 36;
export const GOAL_CHILD_HEIGHT = 32;
export const GOAL_LANE_DROP_HEIGHT = 30;
export const GOAL_UNGROUPED_HEADER_HEIGHT = 36;
export const GOAL_ROW_HEIGHT = 32;
export const GOAL_GROUP_GAP = 16;
export const GOAL_PROJECT_GAP = 10;
export const GOAL_BOTTOM_PADDING = 8;

export const GOAL_UNGROUPED_KEY = "goal:__ungrouped__";
export const GOAL_ARCHIVED_KEY = "goal:__archived__";

export function goalProjectSectionKey(repoName: string): string {
	return `goal-project:${repoName}`;
}

export function goalSectionKey(goalWorkspaceId: string): string {
	return `goal:${goalWorkspaceId}`;
}

export function getGoalItemHeight(item: GoalVirtualItem): number {
	switch (item.kind) {
		case "project-header":
			return GOAL_PROJECT_HEADER_HEIGHT;
		case "goal-header":
			return GOAL_HEADER_HEIGHT;
		case "goal-child":
			return GOAL_CHILD_HEIGHT;
		case "goal-lane-drop":
			return GOAL_LANE_DROP_HEIGHT;
		case "ungrouped-header":
			return GOAL_UNGROUPED_HEADER_HEIGHT;
		case "ungrouped-row":
			return GOAL_ROW_HEIGHT;
		case "archived-goals-header":
			return GOAL_UNGROUPED_HEADER_HEIGHT;
		case "archived-goal-row":
			return GOAL_ROW_HEIGHT;
		case "group-gap":
			return item.size;
		case "bottom-padding":
			return GOAL_BOTTOM_PADDING;
	}
}

export function getGoalItemKey(item: GoalVirtualItem, index: number): string {
	switch (item.kind) {
		case "project-header":
			return `project-header:${item.projectGroup.repoName}`;
		case "goal-header":
			return `goal-header:${item.goalGroup.goalWorkspaceId}`;
		case "goal-child":
			return `goal-child:${item.goalWorkspaceId}:${item.row.id}`;
		case "goal-lane-drop":
			return `goal-lane-drop:${item.goalWorkspaceId}:${item.lane}`;
		case "ungrouped-header":
			return "ungrouped-header";
		case "ungrouped-row":
			return `ungrouped-row:${item.row.id}`;
		case "archived-goals-header":
			return "archived-goals-header";
		case "archived-goal-row":
			return `archived-goal-row:${item.row.id}`;
		case "group-gap":
			return `gap:${index}`;
		case "bottom-padding":
			return "bottom-padding";
	}
}

// ---------------------------------------------------------------------------
// Virtual list builder
// ---------------------------------------------------------------------------

export function buildGoalViewVirtualItems(
	projection: GoalProjection,
	sectionOpenState: Record<string, boolean>,
	/** When set, this goal is force-expanded and lane drop targets are injected. */
	dragExpandedGoalId: string | null = null,
): GoalVirtualItem[] {
	const items: GoalVirtualItem[] = [];

	const hasProjects = projection.projectGroups.length > 0;

	for (let pi = 0; pi < projection.projectGroups.length; pi++) {
		const project = projection.projectGroups[pi];
		const projectKey = goalProjectSectionKey(project.repoName);
		const projectOpen = sectionOpenState[projectKey] ?? true;

		if (pi > 0) {
			items.push({ kind: "group-gap", size: GOAL_GROUP_GAP });
		}

		items.push({
			kind: "project-header",
			projectGroup: project,
			isOpen: projectOpen,
		});

		if (projectOpen) {
			for (let gi = 0; gi < project.goalGroups.length; gi++) {
				const goal = project.goalGroups[gi];
				if (gi > 0) {
					items.push({ kind: "group-gap", size: GOAL_PROJECT_GAP });
				}

				const sectionKey = goalSectionKey(goal.goalWorkspaceId);
				const isDragExpanded = dragExpandedGoalId === goal.goalWorkspaceId;
				const hasChildren = goal.childRows.length > 0;
				// Force-open if this goal is being hovered during a drag
				const isOpen = isDragExpanded
					? true
					: hasChildren
						? (sectionOpenState[sectionKey] ?? true)
						: false;

				items.push({ kind: "goal-header", goalGroup: goal, isOpen, indent: 8 });

				if (isOpen) {
					// Inject lane drop targets first when this goal is drag-expanded
					if (isDragExpanded) {
						for (const lane of GOAL_LANES) {
							if (!isMovableGoalLaneId(lane.id)) continue;
							items.push({
								kind: "goal-lane-drop",
								lane: lane.id,
								laneLabel: lane.label,
								laneColor: lane.color,
								goalWorkspaceId: goal.goalWorkspaceId,
								indent: 8,
							});
						}
					}
					for (let ci = 0; ci < goal.childRows.length; ci++) {
						items.push({
							kind: "goal-child",
							row: goal.childRows[ci],
							goalWorkspaceId: goal.goalWorkspaceId,
							isLast: ci === goal.childRows.length - 1,
							indent: 8,
						});
					}
				}
			}
		}
	}

	// Ungrouped section (workspaces with no goal relationship)
	if (projection.ungroupedRows.length > 0) {
		if (hasProjects) {
			items.push({ kind: "group-gap", size: GOAL_GROUP_GAP });
		}
		const ungroupedOpen = sectionOpenState[GOAL_UNGROUPED_KEY] ?? true;
		items.push({
			kind: "ungrouped-header",
			count: projection.ungroupedRows.length,
			isOpen: ungroupedOpen,
		});
		if (ungroupedOpen) {
			for (const row of projection.ungroupedRows) {
				items.push({ kind: "ungrouped-row", row });
			}
		}
	}

	// Archived goals section (collapsed by default)
	if (projection.archivedGoalRows.length > 0) {
		const hasContent = hasProjects || projection.ungroupedRows.length > 0;
		if (hasContent) {
			items.push({ kind: "group-gap", size: GOAL_GROUP_GAP });
		}
		const archivedOpen = sectionOpenState[GOAL_ARCHIVED_KEY] ?? false;
		items.push({
			kind: "archived-goals-header",
			count: projection.archivedGoalRows.length,
			isOpen: archivedOpen,
		});
		if (archivedOpen) {
			for (const row of projection.archivedGoalRows) {
				items.push({ kind: "archived-goal-row", row });
			}
		}
	}

	items.push({ kind: "bottom-padding" });
	return items;
}

// ---------------------------------------------------------------------------
// Shared action props
// ---------------------------------------------------------------------------

export type GoalRowActions = Pick<
	WorkspaceRowItemProps,
	| "onSelect"
	| "onPrefetch"
	| "onArchiveWorkspace"
	| "onConvertWorkspaceToGoal"
	| "onRestoreWorkspace"
	| "onDeleteWorkspace"
	| "onMarkWorkspaceUnread"
	| "onOpenInFinder"
	| "onTogglePin"
	| "onSetWorkspaceStatus"
	| "archivingWorkspaceIds"
	| "convertingGoalWorkspaceIds"
	| "markingUnreadWorkspaceId"
	| "restoringWorkspaceId"
> & {
	onAssignWorkspaceToGoal?: (
		workspaceId: string,
		goalWorkspaceId: string,
		status: WorkspaceStatus,
	) => void;
	onDragStartWorkspace?: (workspaceId: string) => void;
	onDragEndWorkspace?: () => void;
	/** Navigate to the goal workspace AND open the Pi AI panel. */
	onOpenGoalAiSurface?: (goalWorkspaceId: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPrNumber(prUrl: string | null | undefined): number | null {
	if (!prUrl) return null;
	const match = prUrl.match(/\/(\d+)\/?$/);
	return match ? Number.parseInt(match[1], 10) : null;
}

// ---------------------------------------------------------------------------
// GoalProjectHeader
// ---------------------------------------------------------------------------

function GoalProjectHeader({
	projectGroup,
	isOpen,
	onToggle,
}: {
	projectGroup: GoalProjectGroup;
	isOpen: boolean;
	onToggle: () => void;
}) {
	const goalCount = projectGroup.goalGroups.length;
	return (
		<button
			type="button"
			onClick={onToggle}
			className="group/trigger flex h-9 w-full cursor-pointer select-none items-center justify-between rounded-lg px-2 py-1 text-[13px] font-semibold tracking-[-0.01em] text-foreground hover:bg-accent/60"
		>
			<span className="flex min-w-0 items-center gap-2">
				<WorkspaceAvatar
					title={projectGroup.repoName}
					repoInitials={projectGroup.repoInitials ?? null}
					repoIconSrc={projectGroup.repoIconSrc ?? null}
				/>
				<span className="truncate">{projectGroup.repoName}</span>
			</span>
			<span className="relative flex h-5 min-w-5 shrink-0 items-center justify-center">
				<Badge
					variant="secondary"
					className="h-4 min-w-[16px] justify-center rounded-full px-1 text-[9.5px] leading-none transition-opacity group-hover/trigger:opacity-0"
				>
					{goalCount}
				</Badge>
				<ChevronRight
					className={cn(
						"absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground opacity-0 transition-all group-hover/trigger:opacity-100",
						isOpen && "rotate-90",
					)}
					strokeWidth={2}
				/>
			</span>
		</button>
	);
}

// ---------------------------------------------------------------------------
// GoalFolderHeader
//
// Click semantics:
//   • Folder icon + title  → toggle expand/collapse
//   • ArrowRight button    → navigate to the goal workspace view
// ---------------------------------------------------------------------------

function GoalFolderHeader({
	goalGroup,
	isOpen,
	selected,
	indent,
	actions,
	isDragTarget,
	isGoalAiRunning,
	onSelect,
	onToggle,
	onDragEnter,
	onDragLeave,
}: {
	goalGroup: GoalGroup;
	isOpen: boolean;
	selected: boolean;
	indent?: number;
	actions: GoalRowActions;
	isDragTarget?: boolean;
	/** When true, Pi is actively streaming for this goal — shows a ring on the folder icon. */
	isGoalAiRunning?: boolean;
	onSelect?: (id: string) => void;
	onToggle: () => void;
	onDragEnter?: (e: React.DragEvent) => void;
	onDragLeave?: (e: React.DragEvent) => void;
}) {
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	const hasChildren = goalGroup.childRows.length > 0;
	const FolderIcon =
		isOpen && (hasChildren || isDragTarget) ? FolderOpen : Folder;
	const workspaceIds = [
		...goalGroup.childRows.map((row) => row.id),
		goalGroup.goalWorkspaceId,
	];
	const isBusy = workspaceIds.some(
		(workspaceId) =>
			(actions.archivingWorkspaceIds?.has(workspaceId) ?? false) ||
			actions.markingUnreadWorkspaceId === workspaceId ||
			actions.restoringWorkspaceId === workspaceId,
	);
	const workspaceActionsDisabled = Boolean(
		actions.markingUnreadWorkspaceId || actions.restoringWorkspaceId,
	);
	const archiveLabel = hasChildren
		? `Archive goal and ${goalGroup.childRows.length} workspace${goalGroup.childRows.length === 1 ? "" : "s"}`
		: "Archive goal";

	const archiveGoalWorkspaces = () => {
		for (const workspaceId of workspaceIds) {
			actions.onArchiveWorkspace?.(workspaceId);
		}
	};

	const handleDeleteConfirm = (deleteAction: DeleteGoalAction) => {
		if (deleteAction === "archive") {
			for (const childRow of goalGroup.childRows) {
				actions.onArchiveWorkspace?.(childRow.id);
			}
		}
		actions.onDeleteWorkspace?.(goalGroup.goalWorkspaceId);
	};

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div
						style={indent ? { paddingLeft: `${indent}px` } : undefined}
						className={cn(
							"group/folder flex h-9 items-center gap-1 rounded-md px-1 transition-colors",
							isOpen && (hasChildren || isDragTarget) && "bg-accent/25",
							isDragTarget && "ring-1 ring-ring/40",
						)}
						onDragEnter={onDragEnter}
						onDragLeave={onDragLeave}
						onDragOver={(e) => e.preventDefault()}
					>
						<button
							type="button"
							onClick={onToggle}
							tabIndex={hasChildren ? 0 : -1}
							className={cn(
								"flex size-5 shrink-0 items-center justify-center rounded transition-colors",
								hasChildren
									? "cursor-pointer text-muted-foreground/50 hover:text-foreground"
									: "pointer-events-none opacity-0",
							)}
							aria-label={isOpen ? "Collapse" : "Expand"}
						>
							<ChevronRight
								className={cn(
									"size-3 transition-transform",
									isOpen && "rotate-90",
								)}
								strokeWidth={2.2}
							/>
						</button>

						<button
							type="button"
							onClick={onToggle}
							className={cn(
								"flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 rounded-md px-1.5 py-1.5 text-[13px] font-semibold leading-tight tracking-[-0.01em] transition-colors",
								selected
									? "workspace-row-selected text-foreground"
									: "text-foreground/85 hover:text-foreground",
							)}
						>
							<span className="relative inline-flex shrink-0 items-center justify-center">
								<FolderIcon
									className={cn(
										"size-3.5 transition-colors",
										selected
											? "text-foreground/80"
											: "text-muted-foreground/60",
									)}
									strokeWidth={1.7}
								/>
								{isGoalAiRunning && (
									<ShineBorder
										borderWidth={1.5}
										duration={4}
										shineColor={["#A07CFE", "#FE8FB5", "#FFBE7B"]}
										style={{
											inset: "-3px",
											width: "calc(100% + 6px)",
											height: "calc(100% + 6px)",
											borderRadius: "4px",
										}}
									/>
								)}
							</span>
							<span className="truncate">{goalGroup.goalTitle}</span>
						</button>

						{actions.onOpenGoalAiSurface ? (
							<button
								type="button"
								onClick={() =>
									actions.onOpenGoalAiSurface?.(goalGroup.goalWorkspaceId)
								}
								className={cn(
									"flex size-5 shrink-0 cursor-pointer items-center justify-center rounded transition-all hover:bg-accent hover:text-foreground",
									isGoalAiRunning
										? "text-chart-2 opacity-100"
										: "text-muted-foreground/30 opacity-0 group-hover/folder:opacity-100",
								)}
								aria-label="Open Goal AI surface"
								title="Open Goal AI surface"
							>
								<Bot className="size-3" strokeWidth={2.2} />
							</button>
						) : null}

						<button
							type="button"
							onClick={() => onSelect?.(goalGroup.goalWorkspaceId)}
							className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/30 opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover/folder:opacity-100"
							aria-label="Open goal workspace"
							title="Open goal workspace"
						>
							<ArrowRight className="size-3" strokeWidth={2.2} />
						</button>

						{isBusy ? (
							<LoaderCircle
								className="mr-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground"
								strokeWidth={2.1}
							/>
						) : hasChildren ? (
							<Badge
								variant="secondary"
								className="mr-0.5 h-4 min-w-[16px] shrink-0 justify-center rounded-full px-1 text-[9.5px] leading-none"
							>
								{goalGroup.childRows.length}
							</Badge>
						) : null}
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent className="min-w-56">
					<ContextMenuItem
						disabled={
							isBusy || workspaceActionsDisabled || !actions.onArchiveWorkspace
						}
						onClick={archiveGoalWorkspaces}
					>
						<Archive className="size-4 shrink-0" strokeWidth={1.6} />
						<span>{archiveLabel}</span>
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						disabled={
							isBusy || workspaceActionsDisabled || !actions.onDeleteWorkspace
						}
						onClick={() => setDeleteDialogOpen(true)}
						className="text-destructive focus:text-destructive"
					>
						<Trash2 className="size-4 shrink-0" strokeWidth={1.6} />
						<span>Delete goal...</span>
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<DeleteGoalDialog
				open={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
				goalTitle={goalGroup.goalTitle}
				childCount={goalGroup.childRows.length}
				onConfirm={handleDeleteConfirm}
			/>
		</>
	);
}

// ---------------------------------------------------------------------------
// GoalLaneDropTarget
// ---------------------------------------------------------------------------

function GoalLaneDropTarget({
	lane,
	laneLabel,
	laneColor,
	goalWorkspaceId,
	indent,
	isDragOver,
	onDragOver,
	onDragLeave,
	onDrop,
}: {
	lane: WorkspaceStatus;
	laneLabel: string;
	laneColor: string;
	goalWorkspaceId: string;
	indent?: number;
	isDragOver: boolean;
	onDragOver: (lane: WorkspaceStatus) => void;
	onDragLeave: () => void;
	onDrop: (goalId: string, lane: WorkspaceStatus) => void;
}) {
	return (
		<div
			style={indent ? { paddingLeft: `${indent + 20}px` } : undefined}
			className={cn(
				"flex h-[30px] cursor-default select-none items-center gap-2 rounded-md px-2 transition-colors duration-100",
				isDragOver ? "bg-accent/60 ring-1 ring-ring/50" : "hover:bg-accent/30",
			)}
			onDragOver={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onDragOver(lane);
			}}
			onDragLeave={(e) => {
				if (
					!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)
				) {
					onDragLeave();
				}
			}}
			onDrop={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onDrop(goalWorkspaceId, lane);
			}}
		>
			<span
				className="size-2 shrink-0 rounded-full"
				style={{ backgroundColor: laneColor }}
				aria-hidden="true"
			/>
			<span
				className={cn(
					"text-[11.5px] font-medium leading-none transition-colors",
					isDragOver ? "text-foreground" : "text-muted-foreground",
				)}
			>
				{laneLabel}
			</span>
			{isDragOver && (
				<span className="ml-auto text-[10px] text-muted-foreground">
					Drop here
				</span>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// GoalChildRow
// ---------------------------------------------------------------------------

function GoalChildRow({
	row,
	isLast,
	selected,
	indent,
	isSending: _isSending,
	isInteractionRequired: _isInteractionRequired,
	actions,
	workspaceActionsDisabled,
}: {
	row: WorkspaceRow;
	isLast: boolean;
	selected: boolean;
	indent?: number;
	isSending?: boolean;
	isInteractionRequired?: boolean;
	actions: GoalRowActions;
	workspaceActionsDisabled: boolean;
}) {
	const statusTone = workspaceStatusToTone(row.status);
	const prNumber = extractPrNumber(row.prUrl);
	const displayTitle = row.branch ? humanizeBranch(row.branch) : row.title;
	const effectiveStatus = row.status ?? "in-progress";
	const isBusy =
		(actions.archivingWorkspaceIds?.has(row.id) ?? false) ||
		actions.markingUnreadWorkspaceId === row.id ||
		actions.restoringWorkspaceId === row.id;

	const rowBody = (
		<div
			role="button"
			tabIndex={0}
			aria-label={displayTitle}
			draggable
			data-workspace-row-id={row.id}
			onClick={() => actions.onSelect?.(row.id)}
			onMouseEnter={() => actions.onPrefetch?.(row.id)}
			onDragStart={(e) => {
				e.dataTransfer.effectAllowed = "move";
				actions.onDragStartWorkspace?.(row.id);
			}}
			onDragEnd={() => {
				actions.onDragEndWorkspace?.();
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					actions.onSelect?.(row.id);
				}
			}}
			className={cn(
				"group/child relative flex h-8 w-full cursor-pointer select-none items-center gap-2 rounded-md pl-8 pr-2.5 text-[13px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
				selected
					? "workspace-row-selected font-medium text-foreground"
					: "text-foreground/75 hover:bg-accent/50 hover:text-foreground/95",
			)}
		>
			{/* Tree connector — vertical spine, capped at midpoint for the last item */}
			<div
				className={cn(
					"pointer-events-none absolute left-[23px] w-px bg-border/65",
					isLast ? "bottom-1/2 top-0" : "inset-y-0",
				)}
			/>
			{/* Horizontal branch stub */}
			<div className="pointer-events-none absolute left-[23px] top-1/2 h-px w-2.5 -translate-y-1/2 bg-border/65" />

			{/* Status icon — colored by workspace status */}
			<GroupIcon tone={statusTone} />

			{/* Title */}
			<span className="row-content-fade min-w-0 flex-1 truncate text-[13px] font-medium leading-tight">
				{displayTitle}
			</span>

			{/* PR badge — fades on hover (or while busy) to make room for action button */}
			{prNumber !== null ? (
				<span
					className={cn(
						"shrink-0 rounded px-1 py-0 text-[10px] tabular-nums font-medium text-foreground/35 transition-opacity",
						isBusy ? "opacity-0" : "group-hover/child:opacity-0",
					)}
				>
					#{prNumber}
				</span>
			) : null}

			{/* Archive button — always visible while busy (shows spinner), hover-reveal otherwise */}
			{actions.onArchiveWorkspace ? (
				<span
					className={cn(
						"pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 transition-opacity",
						isBusy
							? "pointer-events-auto opacity-100"
							: "opacity-0 group-hover/child:pointer-events-auto group-hover/child:opacity-100",
					)}
				>
					<Button
						aria-label={isBusy ? "Archiving…" : "Archive workspace"}
						disabled={workspaceActionsDisabled || isBusy}
						onClick={(e) => {
							e.stopPropagation();
							if (!workspaceActionsDisabled && !isBusy) {
								actions.onArchiveWorkspace?.(row.id);
							}
						}}
						variant="ghost"
						size="icon-xs"
						className={cn(
							"size-5 rounded-md p-0 text-muted-foreground",
							workspaceActionsDisabled || isBusy
								? "cursor-not-allowed"
								: "cursor-pointer hover:text-foreground",
						)}
					>
						{isBusy ? (
							<LoaderCircle
								className="size-3.5 animate-spin"
								strokeWidth={2.1}
							/>
						) : (
							<Archive className="size-3.5" strokeWidth={1.9} />
						)}
					</Button>
				</span>
			) : null}
		</div>
	);

	return (
		<div style={indent ? { paddingLeft: `${indent}px` } : undefined}>
			<ContextMenu>
				<ContextMenuTrigger className="block">{rowBody}</ContextMenuTrigger>
				<ContextMenuContent className="min-w-48">
					<ContextMenuSub>
						<ContextMenuSubTrigger>
							<Circle className="size-4 shrink-0" strokeWidth={1.6} />
							<span>Set status</span>
						</ContextMenuSubTrigger>
						<ContextMenuSubContent>
							{STATUS_OPTIONS.map((opt) => (
								<ContextMenuItem
									key={opt.value}
									onClick={() =>
										actions.onSetWorkspaceStatus?.(row.id, opt.value)
									}
								>
									<GroupIcon tone={opt.tone} />
									<span className="flex-1">{opt.label}</span>
									{effectiveStatus === opt.value ? (
										<span className="ml-auto text-foreground">✓</span>
									) : null}
								</ContextMenuItem>
							))}
						</ContextMenuSubContent>
					</ContextMenuSub>

					{actions.onOpenInFinder ? (
						<ContextMenuItem
							disabled={isBusy || workspaceActionsDisabled}
							onClick={() => actions.onOpenInFinder?.(row.id)}
						>
							<Folder className="size-4 shrink-0" strokeWidth={1.6} />
							<span>Open in Finder</span>
						</ContextMenuItem>
					) : null}

					<ContextMenuSeparator />

					<ContextMenuItem
						disabled={isBusy || workspaceActionsDisabled}
						onClick={() => actions.onArchiveWorkspace?.(row.id)}
					>
						<Archive className="size-4 shrink-0" strokeWidth={1.6} />
						<span>Archive</span>
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export const GoalVirtualItemRenderer = memo(function GoalVirtualItemRenderer({
	item,
	selectedWorkspaceId,
	sendingWorkspaceIds,
	interactionRequiredWorkspaceIds,
	flashingIds,
	actions,
	onToggleSection,
	draggedWorkspaceId,
	hoveredGoalId,
	dragOverLane,
	onDragEnterGoal,
	onDragOverLane,
	onDropIntoLane,
}: {
	item: GoalVirtualItem;
	selectedWorkspaceId?: string | null;
	sendingWorkspaceIds?: Set<string>;
	interactionRequiredWorkspaceIds?: Set<string>;
	flashingIds?: Set<string>;
	actions: GoalRowActions;
	onToggleSection: (key: string) => void;
	draggedWorkspaceId?: string | null;
	hoveredGoalId?: string | null;
	dragOverLane?: WorkspaceStatus | null;
	onDragEnterGoal?: (goalId: string) => void;
	onDragOverLane?: (lane: WorkspaceStatus | null) => void;
	onDropIntoLane?: (goalId: string, lane: WorkspaceStatus) => void;
}) {
	const handleProjectToggle = useCallback(() => {
		if (item.kind === "project-header") {
			onToggleSection(goalProjectSectionKey(item.projectGroup.repoName));
		}
	}, [item, onToggleSection]);

	const handleGoalToggle = useCallback(() => {
		if (item.kind === "goal-header") {
			onToggleSection(goalSectionKey(item.goalGroup.goalWorkspaceId));
		}
	}, [item, onToggleSection]);

	const handleUngroupedToggle = useCallback(() => {
		onToggleSection(GOAL_UNGROUPED_KEY);
	}, [onToggleSection]);

	const handleArchivedToggle = useCallback(() => {
		onToggleSection(GOAL_ARCHIVED_KEY);
	}, [onToggleSection]);

	if (item.kind === "group-gap" || item.kind === "bottom-padding") {
		return null;
	}

	if (item.kind === "project-header") {
		return (
			<GoalProjectHeader
				projectGroup={item.projectGroup}
				isOpen={item.isOpen}
				onToggle={handleProjectToggle}
			/>
		);
	}

	if (item.kind === "goal-header") {
		const isDragTarget =
			draggedWorkspaceId != null &&
			hoveredGoalId === item.goalGroup.goalWorkspaceId;
		const isGoalAiRunning = sendingWorkspaceIds?.has(
			item.goalGroup.goalWorkspaceId,
		);
		return (
			<GoalFolderHeader
				goalGroup={item.goalGroup}
				isOpen={item.isOpen}
				indent={item.indent}
				selected={selectedWorkspaceId === item.goalGroup.goalWorkspaceId}
				actions={actions}
				isDragTarget={isDragTarget}
				isGoalAiRunning={isGoalAiRunning}
				onSelect={actions.onSelect}
				onToggle={handleGoalToggle}
				onDragEnter={(e) => {
					if (draggedWorkspaceId != null) {
						e.preventDefault();
						onDragEnterGoal?.(item.goalGroup.goalWorkspaceId);
					}
				}}
				onDragLeave={(e) => {
					// Only clear when leaving the folder header entirely —
					// not when entering a child element inside it.
					if (
						!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)
					) {
						// Don't clear hoveredGoalId on folder leave — the user may be
						// moving the cursor down into the lane drop targets. The
						// onDragLeaveGoal is only called when leaving the lane targets.
					}
				}}
			/>
		);
	}

	if (item.kind === "goal-lane-drop") {
		const isDragOver =
			dragOverLane === item.lane && hoveredGoalId === item.goalWorkspaceId;
		return (
			<GoalLaneDropTarget
				lane={item.lane}
				laneLabel={item.laneLabel}
				laneColor={item.laneColor}
				goalWorkspaceId={item.goalWorkspaceId}
				indent={item.indent}
				isDragOver={isDragOver}
				onDragOver={(lane) => onDragOverLane?.(lane)}
				onDragLeave={() => onDragOverLane?.(null)}
				onDrop={(goalId, lane) => onDropIntoLane?.(goalId, lane)}
			/>
		);
	}

	if (item.kind === "goal-child") {
		return (
			<GoalChildRow
				row={item.row}
				isLast={item.isLast}
				indent={item.indent}
				selected={selectedWorkspaceId === item.row.id}
				isSending={sendingWorkspaceIds?.has(item.row.id)}
				isInteractionRequired={interactionRequiredWorkspaceIds?.has(
					item.row.id,
				)}
				actions={actions}
				workspaceActionsDisabled={Boolean(
					actions.markingUnreadWorkspaceId || actions.restoringWorkspaceId,
				)}
			/>
		);
	}

	if (item.kind === "ungrouped-header") {
		return (
			<button
				type="button"
				className="group/trigger flex h-9 w-full cursor-pointer select-none items-center justify-between rounded-lg px-2 py-1 text-[13px] font-semibold tracking-[-0.01em] text-foreground hover:bg-accent/60 disabled:cursor-default"
				disabled={item.count === 0}
				onClick={handleUngroupedToggle}
			>
				<span className="flex items-center gap-2">
					<Layers
						className="size-[14px] shrink-0 text-muted-foreground"
						strokeWidth={1.9}
					/>
					<span>Workspaces</span>
				</span>
				{item.count > 0 ? (
					<span className="relative flex h-5 min-w-5 items-center justify-center">
						<Badge
							variant="secondary"
							className="h-4 min-w-[16px] justify-center rounded-full px-1 text-[9.5px] leading-none transition-opacity group-hover/trigger:opacity-0"
						>
							{item.count}
						</Badge>
						<ChevronRight
							className={cn(
								"absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground opacity-0 transition-all group-hover/trigger:opacity-100",
								item.isOpen && "rotate-90",
							)}
							strokeWidth={2}
						/>
					</span>
				) : null}
			</button>
		);
	}

	if (item.kind === "archived-goals-header") {
		return (
			<button
				type="button"
				className="group/trigger flex h-9 w-full cursor-pointer select-none items-center justify-between rounded-lg px-2 py-1 text-[13px] font-semibold tracking-[-0.01em] text-foreground hover:bg-accent/60 disabled:cursor-default"
				disabled={item.count === 0}
				onClick={handleArchivedToggle}
			>
				<span className="flex items-center gap-2">
					<Archive
						className="size-[14px] shrink-0 text-muted-foreground"
						strokeWidth={1.9}
					/>
					<span>Archived</span>
				</span>
				{item.count > 0 ? (
					<span className="relative flex h-5 min-w-5 items-center justify-center">
						<Badge
							variant="secondary"
							className="h-4 min-w-[16px] justify-center rounded-full px-1 text-[9.5px] leading-none transition-opacity group-hover/trigger:opacity-0"
						>
							{item.count}
						</Badge>
						<ChevronRight
							className={cn(
								"absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground opacity-0 transition-all group-hover/trigger:opacity-100",
								item.isOpen && "rotate-90",
							)}
							strokeWidth={2}
						/>
					</span>
				) : null}
			</button>
		);
	}

	if (item.kind === "archived-goal-row") {
		return (
			<div className="pl-2">
				<WorkspaceRowItem
					row={item.row}
					selected={selectedWorkspaceId === item.row.id}
					isSending={false}
					isInteractionRequired={false}
					isFlashing={flashingIds?.has(item.row.id)}
					workspaceActionsDisabled={Boolean(
						actions.markingUnreadWorkspaceId || actions.restoringWorkspaceId,
					)}
					onSelect={actions.onSelect}
					onPrefetch={actions.onPrefetch}
					onRestoreWorkspace={actions.onRestoreWorkspace}
					onDeleteWorkspace={actions.onDeleteWorkspace}
					archivingWorkspaceIds={actions.archivingWorkspaceIds}
					markingUnreadWorkspaceId={actions.markingUnreadWorkspaceId}
					restoringWorkspaceId={actions.restoringWorkspaceId}
				/>
			</div>
		);
	}

	// kind === "ungrouped-row" — wrap in a draggable div
	return (
		<div
			className="pl-2"
			draggable
			onDragStart={(e) => {
				e.dataTransfer.effectAllowed = "move";
				actions.onDragStartWorkspace?.(item.row.id);
			}}
			onDragEnd={() => {
				actions.onDragEndWorkspace?.();
			}}
		>
			<WorkspaceRowItem
				row={item.row}
				selected={selectedWorkspaceId === item.row.id}
				isSending={sendingWorkspaceIds?.has(item.row.id)}
				isInteractionRequired={interactionRequiredWorkspaceIds?.has(
					item.row.id,
				)}
				isFlashing={flashingIds?.has(item.row.id)}
				workspaceActionsDisabled={Boolean(
					actions.markingUnreadWorkspaceId || actions.restoringWorkspaceId,
				)}
				{...actions}
			/>
		</div>
	);
});
