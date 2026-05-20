import { useQueries } from "@tanstack/react-query";
import { getMaterialFileIcon } from "file-extension-icon-js";
import {
	ChevronRight,
	ExternalLink,
	FileText,
	GitBranch,
	LoaderCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { PrSyncState, WorkspaceDetail } from "@/lib/api";
import type { DiffOpenOptions, InspectorFileItem } from "@/lib/editor-session";
import { workspaceChangesQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { GOAL_LANES, goalLaneForWorkspace } from "./board-model";
import { TargetBranchPicker } from "./target-branch-picker";
import { WorkspaceBranchRename } from "./workspace-branch-rename";

const STATUS_COLORS: Record<InspectorFileItem["status"], string> = {
	M: "text-yellow-500",
	A: "text-green-500",
	D: "text-red-500",
};

type ChangeSourceRole = "goal" | "card";

type ChangeSource = {
	role: ChangeSourceRole;
	workspace: WorkspaceDetail;
};

type BranchChange = InspectorFileItem & {
	status: InspectorFileItem["status"];
};

function PrStateBadge({ state }: { state: PrSyncState | null | undefined }) {
	if (!state) return null;
	const config: Record<string, { label: string; className: string }> = {
		open: {
			label: "Open",
			className:
				"bg-[color-mix(in_srgb,var(--workspace-pr-open-accent)_10%,transparent)] text-[var(--workspace-pr-open-accent)] border-[color-mix(in_srgb,var(--workspace-pr-open-accent)_30%,var(--border))]",
		},
		merged: {
			label: "Merged",
			className:
				"bg-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_10%,transparent)] text-[var(--workspace-pr-merged-accent)] border-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_30%,var(--border))]",
		},
		closed: {
			label: "Closed",
			className:
				"bg-[color-mix(in_srgb,var(--workspace-pr-closed-accent)_10%,transparent)] text-[var(--workspace-pr-closed-accent)] border-[color-mix(in_srgb,var(--workspace-pr-closed-accent)_30%,var(--border))]",
		},
	};
	const entry = config[state] ?? {
		label: state,
		className: "bg-muted text-muted-foreground border-border/60",
	};
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
				entry.className,
			)}
		>
			{entry.label}
		</span>
	);
}

type GoalChangesViewProps = {
	goalWorkspace?: WorkspaceDetail | null;
	workspaces: WorkspaceDetail[];
	activeEditorPath?: string | null;
	onOpenEditorFile?: (path: string, options?: DiffOpenOptions) => void;
	onSelectWorkspace?: (workspace: WorkspaceDetail) => void;
};

export function GoalChangesView({
	goalWorkspace,
	workspaces,
	activeEditorPath,
	onOpenEditorFile,
	onSelectWorkspace,
}: GoalChangesViewProps) {
	const [closedGroups, setClosedGroups] = useState<Set<string>>(
		() => new Set(),
	);
	const sources = useMemo(() => {
		const next: ChangeSource[] = [];
		if (goalWorkspace?.rootPath) {
			next.push({ role: "goal", workspace: goalWorkspace });
		}
		for (const workspace of workspaces) {
			if (workspace.rootPath) {
				next.push({ role: "card", workspace });
			}
		}
		return next;
	}, [goalWorkspace, workspaces]);

	const sourceResults = useQueries({
		queries: sources.map((source) => ({
			...workspaceChangesQueryOptions(source.workspace.rootPath ?? ""),
			enabled: Boolean(source.workspace.rootPath),
		})),
	});

	const sourceStates = sources.map((source, index) => {
		const result = sourceResults[index];
		const changes: BranchChange[] = (result.data?.items ?? [])
			.filter((item) => item.committedStatus !== null)
			.filter((item) => item.committedStatus !== undefined)
			.map((item) => ({
				...item,
				status: item.committedStatus ?? item.status,
			}));
		return {
			source,
			changes,
			isLoading: result.isLoading || (result.isFetching && !result.data),
			isError: result.isError,
		};
	});

	const cardTraceByPath = new Map<string, WorkspaceDetail[]>();
	for (const state of sourceStates) {
		if (state.source.role !== "card") continue;
		for (const change of state.changes) {
			const current = cardTraceByPath.get(change.path) ?? [];
			current.push(state.source.workspace);
			cardTraceByPath.set(change.path, current);
		}
	}

	const goalState = sourceStates.find((state) => state.source.role === "goal");
	const cardStates = sourceStates
		.filter((state) => state.source.role === "card")
		.sort(compareCardStates);
	const unavailableCards = workspaces.filter(
		(workspace) => !workspace.rootPath,
	);
	const totalChangeCount = sourceStates.reduce(
		(count, state) => count + state.changes.length,
		0,
	);
	const loadingCount = sourceStates.filter((state) => state.isLoading).length;
	const hasAnySource = sources.length > 0;

	if (!hasAnySource && workspaces.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<p className="text-sm text-muted-foreground">No cards yet.</p>
			</div>
		);
	}

	const toggleGroup = (groupId: string) => {
		setClosedGroups((current) => {
			const next = new Set(current);
			if (next.has(groupId)) {
				next.delete(groupId);
			} else {
				next.add(groupId);
			}
			return next;
		});
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-background">
			<div className="flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-sm font-semibold">
						<FileText className="size-4 shrink-0 text-muted-foreground" />
						<span>Branch changes</span>
						<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
							{totalChangeCount}
						</span>
					</div>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						Goal and card branch diffs, grouped by their source workspace.
					</p>
				</div>
				{loadingCount > 0 ? (
					<div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
						<LoaderCircle className="size-3 animate-spin" />
						<span>Loading {loadingCount}</span>
					</div>
				) : null}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto font-mono text-[11.5px]">
				{goalState ? (
					<ChangeGroup
						groupId={`goal:${goalState.source.workspace.id}`}
						sourceRole="goal"
						workspace={goalState.source.workspace}
						changes={goalState.changes}
						isLoading={goalState.isLoading}
						isError={goalState.isError}
						open={!closedGroups.has(`goal:${goalState.source.workspace.id}`)}
						onToggle={toggleGroup}
						activeEditorPath={activeEditorPath}
						onOpenEditorFile={onOpenEditorFile}
						traceCardsForPath={(path) => cardTraceByPath.get(path) ?? []}
					/>
				) : null}

				{cardStates.map((state) => (
					<ChangeGroup
						key={state.source.workspace.id}
						groupId={`card:${state.source.workspace.id}`}
						sourceRole="card"
						workspace={state.source.workspace}
						changes={state.changes}
						isLoading={state.isLoading}
						isError={state.isError}
						open={!closedGroups.has(`card:${state.source.workspace.id}`)}
						onToggle={toggleGroup}
						activeEditorPath={activeEditorPath}
						onOpenEditorFile={onOpenEditorFile}
						traceCardsForPath={() => [state.source.workspace]}
						onSelectWorkspace={
							onSelectWorkspace
								? () => onSelectWorkspace(state.source.workspace)
								: undefined
						}
					/>
				))}

				{totalChangeCount === 0 && loadingCount === 0 ? (
					<div className="px-5 py-6 text-sm text-muted-foreground">
						No branch changes yet.
					</div>
				) : null}

				{unavailableCards.length > 0 ? (
					<div className="border-t border-border/50 px-5 py-3 text-[11px] text-muted-foreground">
						{unavailableCards.length} card
						{unavailableCards.length === 1 ? "" : "s"} cannot be traced because
						their worktree is not available.
					</div>
				) : null}
			</div>
		</div>
	);
}

function ChangeGroup({
	groupId,
	sourceRole,
	workspace,
	changes,
	isLoading,
	isError,
	open,
	onToggle,
	activeEditorPath,
	onOpenEditorFile,
	traceCardsForPath,
	onSelectWorkspace,
}: {
	groupId: string;
	sourceRole: ChangeSourceRole;
	workspace: WorkspaceDetail;
	changes: BranchChange[];
	isLoading: boolean;
	isError: boolean;
	open: boolean;
	onToggle: (groupId: string) => void;
	activeEditorPath?: string | null;
	onOpenEditorFile?: (path: string, options?: DiffOpenOptions) => void;
	traceCardsForPath: (path: string) => WorkspaceDetail[];
	onSelectWorkspace?: () => void;
}) {
	const lane = GOAL_LANES.find((entry) => entry.id === workspace.status);

	return (
		<section className="border-b border-border/50">
			<div className="group/header flex items-center gap-2 px-3 py-2 text-muted-foreground">
				<button
					type="button"
					onClick={() => onToggle(groupId)}
					aria-expanded={open}
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left transition-colors hover:text-foreground"
				>
					<ChevronRight
						className={cn(
							"size-3 shrink-0 transition-transform",
							open && "rotate-90",
						)}
						strokeWidth={2}
					/>
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 items-center gap-2">
							<span className="truncate text-[12px] font-semibold text-foreground">
								{sourceRole === "goal" ? "Goal branch" : workspace.title}
							</span>
							{sourceRole === "card" && lane ? (
								<span className="flex shrink-0 items-center gap-1 text-[10px]">
									<span
										className="size-1.5 rounded-full"
										style={{ backgroundColor: lane.color }}
										aria-hidden="true"
									/>
									{lane.label}
								</span>
							) : null}
							<PrStateBadge state={workspace.prSyncState ?? null} />
						</div>
						<div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10.5px]">
							<GitBranch className="size-2.5 shrink-0" />
							<WorkspaceBranchRename workspace={workspace} />
							{(workspace.intendedTargetBranch ?? workspace.defaultBranch) ? (
								<>
									<span className="shrink-0 text-muted-foreground/80">→</span>
									<TargetBranchPicker workspace={workspace} />
								</>
							) : null}
						</div>
					</div>
				</button>

				{workspace.prUrl ? (
					<a
						href={workspace.prUrl}
						target="_blank"
						rel="noreferrer"
						onClick={(event) => event.stopPropagation()}
						className="inline-flex cursor-pointer items-center gap-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
					>
						<span className="max-w-[140px] truncate">
							{workspace.prTitle ?? "View PR"}
						</span>
						<ExternalLink className="size-2.5 shrink-0" />
					</a>
				) : null}

				{onSelectWorkspace ? (
					<button
						type="button"
						onClick={onSelectWorkspace}
						className="cursor-pointer rounded-md px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
					>
						Open card
					</button>
				) : null}

				<span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-muted px-1 text-[9.5px] font-semibold text-muted-foreground">
					{isLoading ? (
						<LoaderCircle className="size-2.5 animate-spin" />
					) : (
						changes.length
					)}
				</span>
			</div>

			{open ? (
				<div className="pb-1 pl-8 pr-3">
					{isError ? (
						<div className="px-2 py-2 text-[11px] text-destructive">
							Unable to load changes for this branch.
						</div>
					) : changes.length > 0 ? (
						changes.map((change) => (
							<ChangeRow
								key={`${workspace.id}:${change.path}`}
								workspace={workspace}
								change={change}
								activeEditorPath={activeEditorPath}
								onOpenEditorFile={onOpenEditorFile}
								traceCards={traceCardsForPath(change.path)}
							/>
						))
					) : isLoading ? (
						<div className="px-2 py-2 text-[11px] text-muted-foreground">
							Loading branch changes...
						</div>
					) : (
						<div className="px-2 py-2 text-[11px] text-muted-foreground">
							No branch changes.
						</div>
					)}
				</div>
			) : null}
		</section>
	);
}

function ChangeRow({
	workspace,
	change,
	activeEditorPath,
	onOpenEditorFile,
	traceCards,
}: {
	workspace: WorkspaceDetail;
	change: BranchChange;
	activeEditorPath?: string | null;
	onOpenEditorFile?: (path: string, options?: DiffOpenOptions) => void;
	traceCards: WorkspaceDetail[];
}) {
	const selected = change.absolutePath === activeEditorPath;
	const targetRef = getTargetRef(workspace);
	const directory = change.path.includes("/")
		? change.path.slice(0, change.path.lastIndexOf("/"))
		: "";
	const canOpen = Boolean(onOpenEditorFile && workspace.rootPath);
	const traceLabel = describeTrace(traceCards);

	const openChange = () => {
		if (!onOpenEditorFile || !workspace.rootPath) return;
		onOpenEditorFile(change.absolutePath, {
			fileStatus: change.status,
			originalRef: targetRef,
			modifiedRef: targetRef ? "HEAD" : undefined,
			workspaceRootPath: workspace.rootPath,
			workspaceId: workspace.id,
		});
	};

	return (
		<div
			className={cn(
				"group/row flex items-center gap-1.5 rounded-sm py-[2px] pl-2 pr-2 text-muted-foreground transition-colors hover:bg-accent/60",
				canOpen && "cursor-pointer",
				selected && "bg-accent text-foreground",
			)}
			role={canOpen ? "button" : undefined}
			tabIndex={canOpen ? 0 : undefined}
			onClick={canOpen ? openChange : undefined}
			onKeyDown={
				canOpen
					? (event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								openChange();
							}
						}
					: undefined
			}
		>
			<img
				src={getMaterialFileIcon(change.name)}
				alt=""
				className="size-4 shrink-0"
			/>
			<span className="min-w-0 max-w-[34%] truncate text-foreground">
				{change.name}
			</span>
			<span className="min-w-0 flex-1 truncate text-[10px]">{directory}</span>
			{traceLabel ? (
				<span className="min-w-0 max-w-[26%] truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
					{traceLabel}
				</span>
			) : null}
			<LineStats insertions={change.insertions} deletions={change.deletions} />
			<span
				className={cn(
					"inline-flex h-4 w-4 shrink-0 items-center justify-center text-[10px] font-semibold",
					STATUS_COLORS[change.status],
				)}
			>
				{change.status}
			</span>
		</div>
	);
}

function LineStats({
	insertions,
	deletions,
}: {
	insertions: number;
	deletions: number;
}) {
	if (insertions === 0 && deletions === 0) {
		return null;
	}

	return (
		<span className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums">
			{insertions > 0 ? (
				<span className="text-chart-2">+{insertions}</span>
			) : null}
			{deletions > 0 ? (
				<span className="text-destructive">-{deletions}</span>
			) : null}
		</span>
	);
}

function getTargetRef(workspace: WorkspaceDetail) {
	const target = workspace.intendedTargetBranch ?? workspace.defaultBranch;
	if (!target) return undefined;
	return `${workspace.remote ?? "origin"}/${target}`;
}

function describeTrace(cards: WorkspaceDetail[]) {
	if (cards.length === 0) return null;
	if (cards.length === 1) return `From ${cards[0].title}`;
	return `From ${cards.length} cards`;
}

function compareCardStates(
	left: { source: ChangeSource; changes: BranchChange[] },
	right: { source: ChangeSource; changes: BranchChange[] },
) {
	const laneOrder = Object.fromEntries(
		GOAL_LANES.map((lane, index) => [lane.id, index]),
	);
	const leftHasChanges = left.changes.length > 0 ? 0 : 1;
	const rightHasChanges = right.changes.length > 0 ? 0 : 1;
	if (leftHasChanges !== rightHasChanges)
		return leftHasChanges - rightHasChanges;
	const leftLane = laneOrder[goalLaneForWorkspace(left.source.workspace)] ?? 99;
	const rightLane =
		laneOrder[goalLaneForWorkspace(right.source.workspace)] ?? 99;
	if (leftLane !== rightLane) return leftLane - rightLane;
	return left.source.workspace.title.localeCompare(
		right.source.workspace.title,
	);
}
