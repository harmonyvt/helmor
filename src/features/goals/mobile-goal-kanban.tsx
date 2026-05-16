import { GitBranch, GitMerge, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { GroupIcon, workspaceStatusToTone } from "@/features/navigation/shared";
import type { WorkspaceDetail, WorkspaceStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	GOAL_LANES,
	type GoalLaneDefinition,
	groupGoalChildWorkspacesByLane,
	isMergedGoalWorkspace,
	isMovableGoalLaneId,
} from "./board-model";

export type MobileGoalKanbanProps = {
	workspaces: WorkspaceDetail[];
	onOpenWorkspace: (workspaceId: string) => void;
	onMoveWorkspace: (workspace: WorkspaceDetail, lane: WorkspaceStatus) => void;
};

function LaneIcon({ lane }: { lane: GoalLaneDefinition }) {
	if (lane.id === "merged") {
		return (
			<GitMerge
				className="shrink-0 text-[var(--workspace-pr-merged-accent)]"
				size={14}
				strokeWidth={2}
			/>
		);
	}
	return <GroupIcon tone={workspaceStatusToTone(lane.id)} />;
}

export default function MobileGoalKanban({
	workspaces,
	onOpenWorkspace,
	onMoveWorkspace,
}: MobileGoalKanbanProps) {
	const [activeLaneIndex, setActiveLaneIndex] = useState(0);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	const byLane = groupGoalChildWorkspacesByLane(workspaces);
	const selectedWorkspace =
		workspaces.find((ws) => ws.id === selectedId) ?? null;

	const scrollToLane = useCallback((index: number) => {
		const el = scrollContainerRef.current;
		if (!el) return;
		el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
		setActiveLaneIndex(index);
	}, []);

	const handleScroll = useCallback(() => {
		const el = scrollContainerRef.current;
		if (!el) return;
		const index = Math.round(el.scrollLeft / el.clientWidth);
		setActiveLaneIndex(index);
	}, []);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{/* Tab strip */}
			<div className="flex shrink-0 overflow-x-auto border-b border-border [scrollbar-width:none]">
				{GOAL_LANES.map((lane, i) => {
					const count = byLane.get(lane.id)?.length ?? 0;
					return (
						<button
							key={lane.id}
							type="button"
							onClick={() => scrollToLane(i)}
							className={cn(
								"flex shrink-0 cursor-pointer items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors",
								activeLaneIndex === i
									? "border-b-2 border-foreground text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							<LaneIcon lane={lane} />
							<span>{lane.label}</span>
							{count > 0 && (
								<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
									{count}
								</span>
							)}
						</button>
					);
				})}
			</div>

			{/* Scroll-snap lane container */}
			<div
				ref={scrollContainerRef}
				className="flex flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
				onScroll={handleScroll}
			>
				{GOAL_LANES.map((lane) => {
					const laneWorkspaces = byLane.get(lane.id) ?? [];
					return (
						<div
							key={lane.id}
							className="w-full shrink-0 snap-start overflow-y-auto p-3"
						>
							{laneWorkspaces.length === 0 ? (
								<div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border">
									<p className="text-xs text-muted-foreground">No workspaces</p>
								</div>
							) : (
								laneWorkspaces.map((ws) => (
									<MobileWorkspaceCard
										key={ws.id}
										workspace={ws}
										isSelected={selectedId === ws.id}
										onClick={() =>
											setSelectedId((prev) => (prev === ws.id ? null : ws.id))
										}
									/>
								))
							)}
						</div>
					);
				})}
			</div>

			{/* Action sheet */}
			{selectedWorkspace && (
				<MobileLaneActionSheet
					workspace={selectedWorkspace}
					onOpenWorkspace={() => {
						onOpenWorkspace(selectedWorkspace.id);
						setSelectedId(null);
					}}
					onMove={(lane) => {
						onMoveWorkspace(selectedWorkspace, lane);
						setSelectedId(null);
					}}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</div>
	);
}

function MobileWorkspaceCard({
	workspace: ws,
	isSelected,
	onClick,
}: {
	workspace: WorkspaceDetail;
	isSelected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"mb-2 w-full cursor-pointer rounded-lg border bg-background p-3 text-left shadow-sm transition-all",
				isSelected
					? "border-ring/60 ring-2 ring-ring/20"
					: "border-border/70 hover:border-border",
			)}
		>
			<p className="line-clamp-2 text-sm font-medium leading-snug">
				{ws.title}
			</p>
			{ws.branch || isMergedGoalWorkspace(ws) ? (
				<div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
					{ws.branch ? (
						<span className="inline-flex min-w-0 items-center gap-1">
							<GitBranch className="size-2.5 shrink-0" />
							<span className="truncate font-mono">{ws.branch}</span>
						</span>
					) : null}
					{isMergedGoalWorkspace(ws) ? (
						<span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_10%,transparent)] px-1.5 py-0.5 text-[var(--workspace-pr-merged-accent)]">
							<GitMerge className="size-2.5" />
							Merged
						</span>
					) : null}
				</div>
			) : null}
		</button>
	);
}

function MobileLaneActionSheet({
	workspace,
	onOpenWorkspace,
	onMove,
	onClose,
}: {
	workspace: WorkspaceDetail;
	onOpenWorkspace: () => void;
	onMove: (lane: WorkspaceStatus) => void;
	onClose: () => void;
}) {
	const isMerged = isMergedGoalWorkspace(workspace);
	const otherLanes = GOAL_LANES.filter(
		(lane): lane is GoalLaneDefinition & { id: WorkspaceStatus } =>
			isMovableGoalLaneId(lane.id) && lane.id !== workspace.status,
	);
	return (
		<div
			className="shrink-0 border-t border-border bg-sidebar px-4 pt-3"
			style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
		>
			<div className="mb-3 flex items-center justify-between gap-2">
				<p className="truncate text-sm font-medium">{workspace.title}</p>
				<button
					type="button"
					onClick={onClose}
					className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-accent"
				>
					<X className="size-4" />
				</button>
			</div>
			<button
				type="button"
				onClick={onOpenWorkspace}
				className="mb-3 w-full cursor-pointer rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
			>
				Open conversation
			</button>
			{isMerged ? (
				<p className="text-xs text-muted-foreground">
					Merged work has landed in the goal branch and cannot be changed here.
				</p>
			) : otherLanes.length > 0 ? (
				<div className="flex flex-wrap gap-2">
					{otherLanes.map((lane) => (
						<button
							key={lane.id}
							type="button"
							onClick={() => onMove(lane.id)}
							className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							→ {lane.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
