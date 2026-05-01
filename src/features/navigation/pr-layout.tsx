import {
	ChevronRight,
	GitBranch,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
} from "lucide-react";
import { memo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WorkspaceAvatar } from "./avatar";
import { WorkspaceRowItem, type WorkspaceRowItemProps } from "./row-item";
import type {
	PrGroupTone,
	ProjectGroup,
	PrStatusGroup,
	StackedWorkspaceRow,
} from "./sidebar-projection";

// ---------------------------------------------------------------------------
// Virtual item types
// ---------------------------------------------------------------------------

export type PrVirtualItem =
	| {
			kind: "repo-header";
			projectGroup: ProjectGroup;
			isOpen: boolean;
	  }
	| {
			kind: "pr-group-header";
			prGroup: PrStatusGroup;
			repoName: string;
			isOpen: boolean;
	  }
	| { kind: "pr-row"; stacked: StackedWorkspaceRow }
	| { kind: "group-gap"; size: number }
	| { kind: "bottom-padding" };

export const REPO_HEADER_HEIGHT = 36;
export const PR_GROUP_HEADER_HEIGHT = 28;
export const PR_ROW_HEIGHT = 32;
export const PR_GROUP_GAP = 8;
export const PR_BOTTOM_PADDING = 8;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildPrViewVirtualItems(
	projectGroups: ProjectGroup[],
	sectionOpenState: Record<string, boolean>,
): PrVirtualItem[] {
	const items: PrVirtualItem[] = [];

	for (let gi = 0; gi < projectGroups.length; gi++) {
		const project = projectGroups[gi];
		const repoKey = `repo:${project.repoName}`;
		const repoOpen = sectionOpenState[repoKey] ?? true;

		if (gi > 0) {
			items.push({ kind: "group-gap", size: PR_GROUP_GAP });
		}

		items.push({
			kind: "repo-header",
			projectGroup: project,
			isOpen: repoOpen,
		});

		if (repoOpen) {
			for (const prGroup of project.prGroups) {
				const subKey = `pr-sub:${project.repoName}:${prGroup.id}`;
				const subOpen = sectionOpenState[subKey] ?? true;

				items.push({
					kind: "pr-group-header",
					prGroup,
					repoName: project.repoName,
					isOpen: subOpen,
				});

				if (subOpen) {
					for (const stacked of prGroup.rows) {
						items.push({ kind: "pr-row", stacked });
					}
				}
			}
		}
	}

	items.push({ kind: "bottom-padding" });
	return items;
}

export function getPrItemHeight(item: PrVirtualItem): number {
	switch (item.kind) {
		case "repo-header":
			return REPO_HEADER_HEIGHT;
		case "pr-group-header":
			return PR_GROUP_HEADER_HEIGHT;
		case "pr-row":
			return PR_ROW_HEIGHT;
		case "group-gap":
			return item.size;
		case "bottom-padding":
			return PR_BOTTOM_PADDING;
	}
}

export function getPrItemKey(item: PrVirtualItem, index: number): string {
	switch (item.kind) {
		case "repo-header":
			return `repo-header:${item.projectGroup.repoName}`;
		case "pr-group-header":
			return `pr-group-header:${item.repoName}:${item.prGroup.id}`;
		case "pr-row":
			return `pr-row:${item.stacked.row.id}`;
		case "group-gap":
			return `gap:${index}`;
		case "bottom-padding":
			return "bottom-padding";
	}
}

// ---------------------------------------------------------------------------
// PR status icon
// ---------------------------------------------------------------------------

const PR_GROUP_TONE_CLASSES: Record<PrGroupTone, string> = {
	"pr-open": "text-[var(--workspace-sidebar-status-review)]",
	"pr-merged": "text-[var(--workspace-sidebar-status-done)]",
	"pr-closed": "text-[var(--workspace-sidebar-status-canceled)]",
	"pr-none": "text-[var(--workspace-sidebar-status-backlog)]",
};

function PrGroupIcon({ tone }: { tone: PrGroupTone }) {
	const className = cn("size-[12px] shrink-0", PR_GROUP_TONE_CLASSES[tone]);
	switch (tone) {
		case "pr-open":
			return <GitPullRequest className={className} strokeWidth={2} />;
		case "pr-merged":
			return <GitMerge className={className} strokeWidth={2} />;
		case "pr-closed":
			return <GitPullRequestClosed className={className} strokeWidth={2} />;
		case "pr-none":
			return <GitBranch className={className} strokeWidth={2} />;
	}
}

// ---------------------------------------------------------------------------
// Shared action props (subset of WorkspaceRowItemProps)
// ---------------------------------------------------------------------------

export type PrRowActions = Pick<
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
// Renderer
// ---------------------------------------------------------------------------

export const PrVirtualItemRenderer = memo(function PrVirtualItemRenderer({
	item,
	selectedWorkspaceId,
	sendingWorkspaceIds,
	interactionRequiredWorkspaceIds,
	actions,
	onToggleSection,
}: {
	item: PrVirtualItem;
	selectedWorkspaceId?: string | null;
	sendingWorkspaceIds?: Set<string>;
	interactionRequiredWorkspaceIds?: Set<string>;
	actions: PrRowActions;
	onToggleSection: (key: string) => void;
}) {
	const handleRepoToggle = useCallback(() => {
		if (item.kind === "repo-header") {
			onToggleSection(`repo:${item.projectGroup.repoName}`);
		}
	}, [item, onToggleSection]);

	const handleSubToggle = useCallback(() => {
		if (item.kind === "pr-group-header") {
			onToggleSection(`pr-sub:${item.repoName}:${item.prGroup.id}`);
		}
	}, [item, onToggleSection]);

	if (item.kind === "group-gap" || item.kind === "bottom-padding") {
		return null;
	}

	if (item.kind === "repo-header") {
		const { projectGroup, isOpen } = item;
		return (
			<button
				type="button"
				onClick={handleRepoToggle}
				className="group/trigger flex w-full select-none items-center justify-between rounded-lg px-2 py-1 text-[13px] font-semibold tracking-[-0.01em] text-foreground hover:bg-accent/60 cursor-pointer"
			>
				<span className="flex items-center gap-2 min-w-0">
					<WorkspaceAvatar
						title={projectGroup.repoName}
						repoInitials={projectGroup.repoInitials ?? null}
						repoIconSrc={projectGroup.repoIconSrc ?? null}
					/>
					<span className="truncate">{projectGroup.repoName}</span>
				</span>
				<span className="relative flex h-5 min-w-5 items-center justify-center shrink-0">
					<Badge
						variant="secondary"
						className="h-4 min-w-[16px] justify-center rounded-full px-1 text-[9.5px] leading-none transition-opacity group-hover/trigger:opacity-0"
					>
						{projectGroup.totalCount}
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

	if (item.kind === "pr-group-header") {
		const { prGroup, isOpen } = item;
		return (
			<button
				type="button"
				onClick={handleSubToggle}
				className="group/trigger flex w-full select-none items-center justify-between rounded-md px-2 py-0.5 text-[12px] font-medium text-foreground/60 hover:bg-accent/40 hover:text-foreground/80 cursor-pointer"
			>
				<span className="flex items-center gap-1.5">
					<PrGroupIcon tone={prGroup.id} />
					<span>{prGroup.label}</span>
				</span>
				<span className="relative flex h-4 min-w-4 items-center justify-center">
					<span className="text-[10px] tabular-nums transition-opacity group-hover/trigger:opacity-0">
						{prGroup.rows.length}
					</span>
					<ChevronRight
						className={cn(
							"absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-all group-hover/trigger:opacity-100",
							isOpen && "rotate-90",
						)}
						strokeWidth={2}
					/>
				</span>
			</button>
		);
	}

	// kind === "pr-row"
	const { stacked } = item;
	const leftPad = 8 + stacked.depth * 14;
	return (
		<div style={{ paddingLeft: `${leftPad}px` }}>
			<WorkspaceRowItem
				row={stacked.row}
				selected={selectedWorkspaceId === stacked.row.id}
				isSending={sendingWorkspaceIds?.has(stacked.row.id)}
				isInteractionRequired={interactionRequiredWorkspaceIds?.has(
					stacked.row.id,
				)}
				workspaceActionsDisabled={Boolean(
					actions.markingUnreadWorkspaceId || actions.restoringWorkspaceId,
				)}
				{...actions}
			/>
		</div>
	);
});
