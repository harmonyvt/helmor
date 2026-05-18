import {
	Bot,
	GitBranch,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	MessageSquare,
	X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { WorkspaceDetail, WorkspaceStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	GOAL_LANES,
	type GoalLaneDefinition,
	type GoalLaneId,
	goalLaneForWorkspace,
	groupGoalChildWorkspacesByLane,
	isMergedGoalWorkspace,
	isMovableGoalLaneId,
} from "./board-model";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MobileGoalFlowBoardProps = {
	workspaces: WorkspaceDetail[];
	onOpenWorkspace: (workspaceId: string) => void;
	onMoveWorkspace: (workspace: WorkspaceDetail, lane: WorkspaceStatus) => void;
};

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function FlowProgressBar({
	byLane,
	total,
}: {
	byLane: Map<GoalLaneId, WorkspaceDetail[]>;
	total: number;
}) {
	if (total === 0) return null;

	return (
		<div className="flex h-[3px] w-full overflow-hidden">
			{GOAL_LANES.map((lane) => {
				const count = byLane.get(lane.id)?.length ?? 0;
				if (count === 0) return null;
				const color =
					lane.id === "merged"
						? "var(--workspace-pr-merged-accent)"
						: lane.color;
				return (
					<div key={lane.id} style={{ flex: count, backgroundColor: color }} />
				);
			})}
		</div>
	);
}

// ─── Stats Summary ────────────────────────────────────────────────────────────

function FlowStatsSummary({
	byLane,
	workspaces,
}: {
	byLane: Map<GoalLaneId, WorkspaceDetail[]>;
	workspaces: WorkspaceDetail[];
}) {
	const total = workspaces.length;
	if (total === 0) return null;

	const done =
		(byLane.get("done")?.length ?? 0) + (byLane.get("merged")?.length ?? 0);
	const running = workspaces.filter(
		(ws) => ws.activeSessionStatus === "streaming",
	).length;
	const inReview = byLane.get("review")?.length ?? 0;

	return (
		<div className="flex items-center gap-1.5 px-4 pb-1.5 pt-2 text-[11px] text-muted-foreground">
			<span>
				<span className="font-semibold text-foreground">{done}</span> of {total}{" "}
				done
			</span>
			{inReview > 0 && (
				<>
					<span className="opacity-30">·</span>
					<span>
						<span className="font-semibold" style={{ color: "#a09040" }}>
							{inReview}
						</span>{" "}
						in review
					</span>
				</>
			)}
			{running > 0 && (
				<>
					<span className="opacity-30">·</span>
					<span>
						<span className="font-semibold" style={{ color: "#508a5a" }}>
							{running}
						</span>{" "}
						running
					</span>
				</>
			)}
		</div>
	);
}

// ─── Jump Chips ───────────────────────────────────────────────────────────────

function LaneJumpChips({
	byLane,
	activeChip,
	onJump,
}: {
	byLane: Map<GoalLaneId, WorkspaceDetail[]>;
	activeChip: GoalLaneId | null;
	onJump: (laneId: GoalLaneId) => void;
}) {
	return (
		<div className="flex gap-1.5 overflow-x-auto px-3 pb-3 pt-1 [scrollbar-width:none]">
			{GOAL_LANES.map((lane) => {
				const count = byLane.get(lane.id)?.length ?? 0;
				const laneColor =
					lane.id === "merged"
						? "var(--workspace-pr-merged-accent)"
						: lane.color;
				const isActive = activeChip === lane.id;

				return (
					<button
						key={lane.id}
						type="button"
						onClick={() => onJump(lane.id)}
						className={cn(
							"inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-150",
							isActive
								? "border-transparent text-white"
								: "border-border/50 bg-transparent text-muted-foreground hover:text-foreground",
						)}
						style={
							isActive
								? { backgroundColor: laneColor, borderColor: laneColor }
								: undefined
						}
					>
						<span
							className="size-1.5 shrink-0 rounded-full"
							style={{
								backgroundColor: isActive ? "rgba(255,255,255,0.5)" : laneColor,
							}}
						/>
						{lane.label}
						{count > 0 && (
							<span
								className={cn(
									"rounded-full px-1.5 py-px text-[10px] tabular-nums",
									isActive
										? "bg-white/25 text-white"
										: "bg-muted text-muted-foreground",
								)}
							>
								{count}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function RunningPulse() {
	return (
		<span className="relative flex size-1.5 shrink-0">
			<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--workspace-sidebar-status-progress)] opacity-70" />
			<span className="relative inline-flex size-1.5 rounded-full bg-[var(--workspace-sidebar-status-progress)]" />
		</span>
	);
}

type PrBadgeMeta = {
	icon: typeof GitMerge;
	label: string;
	cls: string;
};

function prBadgeMeta(prSyncState?: string | null): PrBadgeMeta | null {
	switch (prSyncState) {
		case "merged":
			return {
				icon: GitMerge,
				label: "Merged",
				cls: "bg-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_12%,transparent)] text-[var(--workspace-pr-merged-accent)]",
			};
		case "closed":
			return {
				icon: GitPullRequestClosed,
				label: "Closed",
				cls: "bg-destructive/10 text-destructive",
			};
		case "open":
			return {
				icon: GitPullRequest,
				label: "PR",
				cls: "bg-[color-mix(in_srgb,var(--workspace-pr-open-accent)_12%,transparent)] text-[var(--workspace-pr-open-accent)]",
			};
		default:
			return null;
	}
}

function FlowCard({
	workspace: ws,
	isSelected,
	onClick,
}: {
	workspace: WorkspaceDetail;
	isSelected: boolean;
	onClick: () => void;
}) {
	const isRunning = ws.activeSessionStatus === "streaming";
	const isMerged = isMergedGoalWorkspace(ws);
	const badge = prBadgeMeta(ws.prSyncState);
	const PrIcon = badge?.icon;

	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"w-full cursor-pointer rounded-xl border bg-background text-left transition-all duration-150 active:scale-[0.99]",
				isSelected
					? "border-ring/40 shadow-lg shadow-black/5"
					: isRunning
						? "border-foreground/12 hover:border-foreground/20"
						: "border-border/60 hover:border-border",
			)}
		>
			<div className="px-3.5 py-3">
				{/* Title + agent badge */}
				<div className="flex items-start gap-2">
					<p className="line-clamp-2 min-w-0 flex-1 text-[13px] font-medium leading-[1.45] tracking-[-0.005em]">
						{ws.title}
					</p>
					{ws.activeSessionAgentType && (
						<span
							className={cn(
								"mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
								isRunning
									? "bg-foreground/8 text-foreground/70"
									: "bg-muted/60 text-muted-foreground",
							)}
						>
							<Bot className="size-2.5 shrink-0" />
							{isRunning ? (
								<RunningPulse />
							) : (
								<span className="size-1.5 rounded-full bg-muted-foreground/30" />
							)}
						</span>
					)}
				</div>

				{/* Branch */}
				{ws.branch && (
					<div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/50">
						<GitBranch className="size-2.5 shrink-0" />
						<span className="truncate font-mono">{ws.branch}</span>
					</div>
				)}

				{/* Footer badges */}
				{(ws.prUrl || ws.sessionCount > 0 || isMerged) && (
					<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
						{ws.sessionCount > 0 && (
							<span className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
								<MessageSquare className="size-2.5" />
								{ws.sessionCount}
							</span>
						)}
						{isMerged && (
							<span className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_12%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--workspace-pr-merged-accent)]">
								<GitMerge className="size-2.5" />
								Landed
							</span>
						)}
						{badge && !isMerged && PrIcon && (
							<span
								className={cn(
									"inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]",
									badge.cls,
								)}
							>
								<PrIcon className="size-2.5" />
								{badge.label}
							</span>
						)}
					</div>
				)}
			</div>
		</button>
	);
}

// ─── Lane Section ─────────────────────────────────────────────────────────────

function LaneSection({
	lane,
	workspaces,
	selectedId,
	isCollapsed,
	onToggleCollapse,
	onCardClick,
	onRef,
}: {
	lane: GoalLaneDefinition;
	workspaces: WorkspaceDetail[];
	selectedId: string | null;
	isCollapsed: boolean;
	onToggleCollapse: () => void;
	onCardClick: (ws: WorkspaceDetail) => void;
	onRef: (el: HTMLDivElement | null) => void;
}) {
	const count = workspaces.length;
	const laneColor =
		lane.id === "merged" ? "var(--workspace-pr-merged-accent)" : lane.color;

	return (
		<div ref={onRef}>
			{/* Sticky section header */}
			<div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
				<button
					type="button"
					onClick={onToggleCollapse}
					className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5"
				>
					<span
						className="h-4 w-[3px] shrink-0 rounded-full"
						style={{ backgroundColor: laneColor }}
					/>
					<span className="flex-1 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
						{lane.label}
					</span>
					<span
						className="rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
						style={
							count > 0
								? {
										backgroundColor: `color-mix(in srgb, ${laneColor} 12%, transparent)`,
										color: laneColor,
									}
								: { color: "var(--color-muted-foreground)" }
						}
					>
						{count}
					</span>
					<span
						className={cn(
							"text-[9px] text-muted-foreground/40 transition-transform duration-200",
							isCollapsed ? "" : "rotate-90",
						)}
					>
						▶
					</span>
				</button>
				<div className="mx-4 h-px bg-border/30" />
			</div>

			{/* Cards */}
			{!isCollapsed && (
				<div className="space-y-2 px-3 pb-4 pt-2">
					{count === 0 ? (
						<div className="flex h-14 items-center justify-center rounded-xl border border-dashed border-border/40">
							<p className="text-[11px] text-muted-foreground/40">
								{lane.emptyLabel}
							</p>
						</div>
					) : (
						workspaces.map((ws) => (
							<FlowCard
								key={ws.id}
								workspace={ws}
								isSelected={selectedId === ws.id}
								onClick={() => onCardClick(ws)}
							/>
						))
					)}
				</div>
			)}
		</div>
	);
}

// ─── Card Action Bottom Sheet ─────────────────────────────────────────────────

function CardActionSheet({
	workspace,
	onOpen,
	onMove,
	onClose,
}: {
	workspace: WorkspaceDetail;
	onOpen: () => void;
	onMove: (lane: WorkspaceStatus) => void;
	onClose: () => void;
}) {
	const isMerged = isMergedGoalWorkspace(workspace);
	const currentLane = goalLaneForWorkspace(workspace);
	const movableLanes = GOAL_LANES.filter(
		(l): l is GoalLaneDefinition & { id: WorkspaceStatus } =>
			isMovableGoalLaneId(l.id) && l.id !== currentLane,
	);

	return (
		<>
			{/* Backdrop */}
			<button
				type="button"
				aria-label="Close"
				className="fixed inset-0 z-40 cursor-default bg-black/30 backdrop-blur-[2px]"
				onClick={onClose}
			/>

			{/* Sheet */}
			<div
				className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-background shadow-2xl"
				style={{
					paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)",
				}}
			>
				{/* Drag handle */}
				<div className="flex justify-center pb-1 pt-3">
					<div className="h-1 w-9 rounded-full bg-border" />
				</div>

				<div className="px-4 pb-1 pt-3">
					{/* Header */}
					<div className="mb-4 flex items-start gap-3">
						<p className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">
							{workspace.title}
						</p>
						<button
							type="button"
							onClick={onClose}
							className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-accent"
						>
							<X className="size-4" />
						</button>
					</div>

					{/* Primary action */}
					<button
						type="button"
						onClick={onOpen}
						className="mb-5 w-full cursor-pointer rounded-xl bg-foreground py-3 text-[14px] font-semibold text-background transition-opacity active:opacity-75"
					>
						Open workspace
					</button>

					{/* Move actions */}
					{isMerged ? (
						<p className="py-1 text-center text-[12px] text-muted-foreground">
							This workspace has landed — it cannot be moved.
						</p>
					) : movableLanes.length > 0 ? (
						<div>
							<p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
								Move to
							</p>
							<div className="grid grid-cols-2 gap-2">
								{movableLanes.map((lane) => (
									<button
										key={lane.id}
										type="button"
										onClick={() => onMove(lane.id)}
										className="cursor-pointer rounded-xl border border-border/50 py-2.5 text-[12px] font-medium transition-all active:scale-[0.97]"
										style={{ color: lane.color }}
									>
										{lane.label}
									</button>
								))}
							</div>
						</div>
					) : null}
				</div>
			</div>
		</>
	);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MobileGoalFlowBoard({
	workspaces,
	onOpenWorkspace,
	onMoveWorkspace,
}: MobileGoalFlowBoardProps) {
	const byLane = useMemo(
		() => groupGoalChildWorkspacesByLane(workspaces),
		[workspaces],
	);

	const [collapsedLanes, setCollapsedLanes] = useState<Set<GoalLaneId>>(() => {
		const set = new Set<GoalLaneId>();
		for (const lane of GOAL_LANES) {
			if ((byLane.get(lane.id)?.length ?? 0) === 0) set.add(lane.id);
		}
		return set;
	});

	const [selectedWorkspace, setSelectedWorkspace] =
		useState<WorkspaceDetail | null>(null);
	const [activeChip, setActiveChip] = useState<GoalLaneId | null>(null);

	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const sectionRefs = useRef<Map<GoalLaneId, HTMLDivElement | null>>(new Map());

	const handleJumpToLane = useCallback((laneId: GoalLaneId) => {
		setActiveChip(laneId);
		// Expand if currently collapsed
		setCollapsedLanes((prev) => {
			if (!prev.has(laneId)) return prev;
			const next = new Set(prev);
			next.delete(laneId);
			return next;
		});
		// Scroll to the section within the scroll container
		requestAnimationFrame(() => {
			const sectionEl = sectionRefs.current.get(laneId);
			const containerEl = scrollContainerRef.current;
			if (!sectionEl || !containerEl) return;
			containerEl.scrollTo({ top: sectionEl.offsetTop, behavior: "smooth" });
		});
	}, []);

	const handleToggleCollapse = useCallback((laneId: GoalLaneId) => {
		setCollapsedLanes((prev) => {
			const next = new Set(prev);
			if (next.has(laneId)) next.delete(laneId);
			else next.add(laneId);
			return next;
		});
	}, []);

	const handleCardClick = useCallback((ws: WorkspaceDetail) => {
		setSelectedWorkspace((prev) => (prev?.id === ws.id ? null : ws));
	}, []);

	return (
		<div className="relative flex h-full flex-col overflow-hidden">
			{/* Proportional lane progress bar */}
			<FlowProgressBar byLane={byLane} total={workspaces.length} />

			{/* At-a-glance stats */}
			<FlowStatsSummary byLane={byLane} workspaces={workspaces} />

			{/* Lane jump chips */}
			<LaneJumpChips
				byLane={byLane}
				activeChip={activeChip}
				onJump={handleJumpToLane}
			/>

			{/* Divider */}
			<div className="h-px shrink-0 bg-border/40" />

			{/* Vertical swimlane scroll */}
			<div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
				{GOAL_LANES.map((lane) => (
					<LaneSection
						key={lane.id}
						lane={lane}
						workspaces={byLane.get(lane.id) ?? []}
						selectedId={selectedWorkspace?.id ?? null}
						isCollapsed={collapsedLanes.has(lane.id)}
						onToggleCollapse={() => handleToggleCollapse(lane.id)}
						onCardClick={handleCardClick}
						onRef={(el) => sectionRefs.current.set(lane.id, el)}
					/>
				))}
			</div>

			{/* Bottom sheet action panel */}
			{selectedWorkspace && (
				<CardActionSheet
					workspace={selectedWorkspace}
					onOpen={() => {
						onOpenWorkspace(selectedWorkspace.id);
						setSelectedWorkspace(null);
					}}
					onMove={(lane) => {
						onMoveWorkspace(selectedWorkspace, lane);
						setSelectedWorkspace(null);
					}}
					onClose={() => setSelectedWorkspace(null)}
				/>
			)}
		</div>
	);
}
