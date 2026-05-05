import {
	Archive,
	ArrowRight,
	ChevronRight,
	Circle,
	Folder,
	FolderOpen,
	Layers,
} from "lucide-react";
import { memo, useCallback } from "react";
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
import type { WorkspaceRow } from "@/lib/api";
import { cn } from "@/lib/utils";
import { WorkspaceAvatar } from "./avatar";
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
	| { kind: "ungrouped-header"; count: number; isOpen: boolean }
	| { kind: "ungrouped-row"; row: WorkspaceRow }
	| { kind: "group-gap"; size: number }
	| { kind: "bottom-padding" };

export const GOAL_PROJECT_HEADER_HEIGHT = 34;
export const GOAL_HEADER_HEIGHT = 32;
export const GOAL_CHILD_HEIGHT = 30;
export const GOAL_UNGROUPED_HEADER_HEIGHT = 34;
export const GOAL_ROW_HEIGHT = 32;
export const GOAL_GROUP_GAP = 10;
export const GOAL_PROJECT_GAP = 6;
export const GOAL_BOTTOM_PADDING = 8;

export const GOAL_UNGROUPED_KEY = "goal:__ungrouped__";

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
		case "ungrouped-header":
			return GOAL_UNGROUPED_HEADER_HEIGHT;
		case "ungrouped-row":
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
		case "ungrouped-header":
			return "ungrouped-header";
		case "ungrouped-row":
			return `ungrouped-row:${item.row.id}`;
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
				const hasChildren = goal.childRows.length > 0;
				const isOpen = hasChildren
					? (sectionOpenState[sectionKey] ?? true)
					: false;

				items.push({ kind: "goal-header", goalGroup: goal, isOpen, indent: 8 });

				if (isOpen) {
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
	| "onMarkWorkspaceUnread"
	| "onOpenInFinder"
	| "onTogglePin"
	| "onSetWorkspaceStatus"
	| "archivingWorkspaceIds"
	| "markingUnreadWorkspaceId"
	| "restoringWorkspaceId"
>;

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
			className="group/trigger flex w-full cursor-pointer select-none items-center justify-between rounded-lg px-2 py-1 text-[13px] font-semibold tracking-[-0.01em] text-foreground hover:bg-accent/60"
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
	onSelect,
	onToggle,
}: {
	goalGroup: GoalGroup;
	isOpen: boolean;
	selected: boolean;
	indent?: number;
	onSelect?: (id: string) => void;
	onToggle: () => void;
}) {
	const hasChildren = goalGroup.childRows.length > 0;
	const FolderIcon = isOpen && hasChildren ? FolderOpen : Folder;

	return (
		<div
			style={indent ? { paddingLeft: `${indent}px` } : undefined}
			className={cn(
				// Subtle background lift when expanded so the header reads as
				// a section container rather than a plain row.
				"group/folder flex items-center gap-0.5 rounded-md px-1 transition-colors",
				isOpen && hasChildren && "bg-muted/30",
			)}
		>
			{/* Expand/collapse chevron */}
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
					className={cn("size-3 transition-transform", isOpen && "rotate-90")}
					strokeWidth={2.2}
				/>
			</button>

			{/* Folder label — clicking toggles expand/collapse */}
			<button
				type="button"
				onClick={onToggle}
				className={cn(
					"flex min-w-0 flex-1 cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] font-semibold leading-tight tracking-[-0.01em] transition-colors",
					selected
						? "workspace-row-selected text-foreground"
						: "text-foreground/75 hover:text-foreground",
				)}
			>
				<FolderIcon
					className={cn(
						"size-[13px] shrink-0 transition-colors",
						selected ? "text-foreground/80" : "text-muted-foreground/70",
					)}
					strokeWidth={1.7}
				/>
				<span className="truncate">{goalGroup.goalTitle}</span>
			</button>

			{/* Navigate to goal workspace — hover-reveal on the right */}
			<button
				type="button"
				onClick={() => onSelect?.(goalGroup.goalWorkspaceId)}
				className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/30 opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover/folder:opacity-100"
				aria-label="Open goal workspace"
				title="Open goal workspace"
			>
				<ArrowRight className="size-3" strokeWidth={2.2} />
			</button>

			{/* Child count badge */}
			{hasChildren ? (
				<Badge
					variant="secondary"
					className="mr-0.5 h-4 min-w-[16px] shrink-0 justify-center rounded-full px-1 text-[9.5px] leading-none"
				>
					{goalGroup.childRows.length}
				</Badge>
			) : null}
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
			data-workspace-row-id={row.id}
			onClick={() => actions.onSelect?.(row.id)}
			onMouseEnter={() => actions.onPrefetch?.(row.id)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					actions.onSelect?.(row.id);
				}
			}}
			className={cn(
				"group/child relative flex h-[30px] w-full cursor-pointer select-none items-center gap-2 rounded-md pl-8 pr-2.5 text-[13px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
				selected
					? "workspace-row-selected font-medium text-foreground"
					: "text-foreground/65 hover:bg-accent/50 hover:text-foreground/90",
			)}
		>
			{/* Tree connector — vertical spine, capped at midpoint for the last item */}
			<div
				className={cn(
					"pointer-events-none absolute left-[23px] w-px bg-border/50",
					isLast ? "bottom-1/2 top-0" : "inset-y-0",
				)}
			/>
			{/* Horizontal branch stub */}
			<div className="pointer-events-none absolute left-[23px] top-1/2 h-px w-2.5 -translate-y-1/2 bg-border/50" />

			{/* Status icon — colored by workspace status */}
			<GroupIcon tone={statusTone} />

			{/* Title */}
			<span className="row-content-fade min-w-0 flex-1 truncate text-[12.5px] font-medium leading-tight">
				{displayTitle}
			</span>

			{/* PR badge — fades on hover to make room for archive button */}
			{prNumber !== null ? (
				<span className="shrink-0 rounded px-1 py-0 text-[10px] tabular-nums font-medium text-foreground/35 transition-opacity group-hover/child:opacity-0">
					#{prNumber}
				</span>
			) : null}

			{/* Hover-reveal archive button */}
			{actions.onArchiveWorkspace ? (
				<span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 opacity-0 transition-opacity group-hover/child:pointer-events-auto group-hover/child:opacity-100">
					<Button
						aria-label="Archive workspace"
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
								? "cursor-not-allowed opacity-60"
								: "cursor-pointer hover:text-foreground",
						)}
					>
						<Archive className="size-3.5" strokeWidth={1.9} />
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
}: {
	item: GoalVirtualItem;
	selectedWorkspaceId?: string | null;
	sendingWorkspaceIds?: Set<string>;
	interactionRequiredWorkspaceIds?: Set<string>;
	flashingIds?: Set<string>;
	actions: GoalRowActions;
	onToggleSection: (key: string) => void;
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
		return (
			<GoalFolderHeader
				goalGroup={item.goalGroup}
				isOpen={item.isOpen}
				indent={item.indent}
				selected={selectedWorkspaceId === item.goalGroup.goalWorkspaceId}
				onSelect={actions.onSelect}
				onToggle={handleGoalToggle}
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
				className="group/trigger flex w-full cursor-pointer select-none items-center justify-between rounded-lg px-2 py-1 text-[13px] font-semibold tracking-[-0.01em] text-foreground hover:bg-accent/60 disabled:cursor-default"
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

	// kind === "ungrouped-row"
	return (
		<div className="pl-2">
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
