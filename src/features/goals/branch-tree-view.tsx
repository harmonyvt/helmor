/**
 * BranchTreeView — Visualises the goal workspace branch as the primary trunk,
 * with all child-workspace branches hanging off it.
 *
 * Layout (top → down):
 *
 *   [upstream target]          e.g. "main"
 *          │  (dashed)
 *   [goal branch]              primary branch — always centred
 *          │
 *   ┌──────┼──────┐
 *  [ws1]  [ws2]  [ws3]         child workspace branches
 */
import {
	GitBranch,
	GitFork,
	GitMerge,
	GitPullRequest,
	XCircle,
} from "lucide-react";
import { useId, useMemo } from "react";
import type { WorkspaceDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { goalLaneForWorkspace } from "./board-model";

// ─── Layout constants ────────────────────────────────────────────────────────

const UPSTREAM_W = 160;
const UPSTREAM_H = 44;

const GOAL_W = 240;
const GOAL_H = 92;

const CHILD_W = 200;
const CHILD_H = 86;
const CHILD_GAP = 18;

const VERT_GAP = 64;
const PAD_X = 56;
const PAD_Y = 40;

// ─── Lane accent colours ──────────────────────────────────────────────────────
// Raw hex values derived from board-model.ts lane definitions so we can build
// both the dot indicator and the card border/background via inline style.

const LANE_HEX: Record<string, string> = {
	"in-progress": "#508a5a",
	review: "#a09040",
	done: "#4a8ab0",
	// merged and canceled handled separately below
};

type CardAccent = {
	dotColor: string;
	borderStyle: string;
	bgStyle: string;
	isSubdued: boolean;
};

function cardAccent(ws: WorkspaceDetail): CardAccent {
	const lane = goalLaneForWorkspace(ws);

	if (lane === "merged") {
		return {
			dotColor: "var(--workspace-pr-merged-accent)",
			borderStyle:
				"color-mix(in srgb, var(--workspace-pr-merged-accent) 30%, var(--border))",
			bgStyle:
				"color-mix(in srgb, var(--workspace-pr-merged-accent) 5%, transparent)",
			isSubdued: false,
		};
	}

	if (lane === "canceled") {
		return {
			dotColor: "var(--muted-foreground)",
			borderStyle: "var(--border)",
			bgStyle: "transparent",
			isSubdued: true,
		};
	}

	const hex = LANE_HEX[lane];
	if (hex) {
		return {
			dotColor: hex,
			borderStyle: `color-mix(in srgb, ${hex} 38%, var(--border))`,
			bgStyle: `color-mix(in srgb, ${hex} 6%, transparent)`,
			isSubdued: false,
		};
	}

	// backlog / unknown
	return {
		dotColor: "var(--muted-foreground)",
		borderStyle: "var(--border)",
		bgStyle: "transparent",
		isSubdued: false,
	};
}

// ─── Connector path helpers ───────────────────────────────────────────────────

/** Cubic-bezier connector from (x1, y1) to (x2, y2), bending at the midpoint. */
function curvePath(x1: number, y1: number, x2: number, y2: number): string {
	const my = (y1 + y2) / 2;
	return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

// ─── Small PR badge ───────────────────────────────────────────────────────────

function PrBadge({
	prSyncState,
	prTitle,
}: {
	prSyncState: string;
	prTitle?: string | null;
}) {
	if (prSyncState === "open") {
		return (
			<div className="flex items-center gap-1">
				<GitPullRequest
					className="size-3 shrink-0 text-[var(--workspace-pr-open-accent)]"
					strokeWidth={2}
				/>
				<span className="truncate text-[10px] text-muted-foreground/60">
					{prTitle ? trimTitle(prTitle) : "PR open"}
				</span>
			</div>
		);
	}
	if (prSyncState === "merged") {
		return (
			<div className="flex items-center gap-1">
				<GitMerge className="size-3 shrink-0 text-success" strokeWidth={2} />
				<span className="truncate text-[10px] text-muted-foreground/60">
					{prTitle ? trimTitle(prTitle) : "Merged"}
				</span>
			</div>
		);
	}
	if (prSyncState === "closed") {
		return (
			<div className="flex items-center gap-1">
				<XCircle
					className="size-3 shrink-0 text-muted-foreground/50"
					strokeWidth={2}
				/>
				<span className="text-[10px] text-muted-foreground/50">Closed</span>
			</div>
		);
	}
	return null;
}

function trimTitle(t: string, max = 24): string {
	return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ─── Component ────────────────────────────────────────────────────────────────

export type BranchTreeViewProps = {
	goalWorkspace: WorkspaceDetail | undefined | null;
	workspaces: WorkspaceDetail[];
	onSelectWorkspace?: (workspace: WorkspaceDetail) => void;
};

const LANE_ORDER: Record<string, number> = {
	"in-progress": 0,
	review: 1,
	done: 2,
	backlog: 3,
	canceled: 4,
	merged: 5,
};

export function BranchTreeView({
	goalWorkspace,
	workspaces,
	onSelectWorkspace,
}: BranchTreeViewProps) {
	const gradId = useId();

	const sorted = useMemo(
		() =>
			[...workspaces].sort(
				(a, b) =>
					(LANE_ORDER[goalLaneForWorkspace(a)] ?? 99) -
					(LANE_ORDER[goalLaneForWorkspace(b)] ?? 99),
			),
		[workspaces],
	);

	const N = sorted.length;
	const upstream = goalWorkspace?.intendedTargetBranch ?? null;

	// ── horizontal geometry ──────────────────────────────────────────────────
	const childRowW = N > 0 ? N * CHILD_W + (N - 1) * CHILD_GAP : 0;
	const innerW = Math.max(GOAL_W, childRowW, UPSTREAM_W);
	const totalW = innerW + PAD_X * 2;
	const cx = totalW / 2; // centre-x of the entire canvas

	// ── vertical row top-edges ───────────────────────────────────────────────
	const upstreamRowY = PAD_Y;
	const goalRowY = upstream ? upstreamRowY + UPSTREAM_H + VERT_GAP : PAD_Y;
	const childRowY = goalRowY + GOAL_H + VERT_GAP;
	const totalH = (N > 0 ? childRowY + CHILD_H : goalRowY + GOAL_H) + PAD_Y;

	// ── child x-positions ────────────────────────────────────────────────────
	const childStart = cx - childRowW / 2;
	const childLeft = sorted.map(
		(_, i) => childStart + i * (CHILD_W + CHILD_GAP),
	);
	const childCenter = childLeft.map((x) => x + CHILD_W / 2);

	if (!goalWorkspace) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<p className="text-sm text-muted-foreground">Loading…</p>
			</div>
		);
	}

	return (
		<div className="min-h-0 flex-1 overflow-auto">
			{/* Scroll wrapper — centred horizontally when content < viewport */}
			<div
				className="relative mx-auto"
				style={{
					width: totalW,
					height: totalH,
					minWidth: "fit-content",
				}}
			>
				{/* ── SVG connector lines ──────────────────────────────────────── */}
				<svg
					aria-hidden="true"
					className="pointer-events-none absolute inset-0"
					width={totalW}
					height={totalH}
					style={{ overflow: "visible" }}
				>
					{/* Subtle gradient on the goal node ring */}
					<defs>
						<linearGradient id={`${gradId}-ring`} x1="0" y1="0" x2="1" y2="1">
							<stop
								offset="0%"
								stopColor="var(--foreground)"
								stopOpacity="0.2"
							/>
							<stop
								offset="100%"
								stopColor="var(--foreground)"
								stopOpacity="0.08"
							/>
						</linearGradient>
					</defs>

					{/* upstream → goal (dashed) */}
					{upstream && (
						<path
							d={curvePath(cx, upstreamRowY + UPSTREAM_H, cx, goalRowY)}
							fill="none"
							stroke="currentColor"
							strokeWidth={1.5}
							strokeDasharray="4 3"
							className="text-border/60"
						/>
					)}

					{/* goal → each child */}
					{childCenter.map((childCx, i) => (
						<path
							key={sorted[i].id}
							d={curvePath(cx, goalRowY + GOAL_H, childCx, childRowY)}
							fill="none"
							stroke="currentColor"
							strokeWidth={1.5}
							className="text-border/60"
						/>
					))}
				</svg>

				{/* ── Upstream node ────────────────────────────────────────────── */}
				{upstream && (
					<div
						className="absolute flex items-center gap-1.5 rounded-md border border-border/50 bg-sidebar px-3 text-[11px] text-muted-foreground"
						style={{
							left: cx - UPSTREAM_W / 2,
							top: upstreamRowY,
							width: UPSTREAM_W,
							height: UPSTREAM_H,
						}}
					>
						<GitBranch
							className="size-3.5 shrink-0 opacity-60"
							strokeWidth={1.8}
						/>
						<span className="min-w-0 truncate font-mono">{upstream}</span>
						<span className="ml-auto shrink-0 rounded bg-muted/70 px-1 py-0.5 text-[9px] uppercase tracking-wider opacity-70">
							target
						</span>
					</div>
				)}

				{/* ── Goal node (primary branch) ───────────────────────────────── */}
				<div
					className="absolute flex flex-col justify-center gap-1.5 rounded-2xl bg-background px-4 py-3.5 shadow-sm"
					style={{
						left: cx - GOAL_W / 2,
						top: goalRowY,
						width: GOAL_W,
						height: GOAL_H,
						border: "2px solid",
						borderColor: `color-mix(in srgb, var(--foreground) 18%, var(--border))`,
					}}
				>
					<div className="flex items-center gap-2">
						<GitFork
							className="size-4 shrink-0 text-foreground/60"
							strokeWidth={1.8}
						/>
						<span className="min-w-0 truncate text-[12px] font-semibold text-foreground/90">
							{goalWorkspace.goalTitle ?? goalWorkspace.title}
						</span>
						<span className="ml-auto shrink-0 rounded bg-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-foreground/50">
							goal
						</span>
					</div>

					{goalWorkspace.branch && (
						<p className="truncate pl-6 font-mono text-[10px] text-muted-foreground/55">
							{goalWorkspace.branch}
						</p>
					)}

					{goalWorkspace.prSyncState &&
						goalWorkspace.prSyncState !== "none" && (
							<div className="pl-6">
								<PrBadge
									prSyncState={goalWorkspace.prSyncState}
									prTitle={goalWorkspace.prTitle}
								/>
							</div>
						)}
				</div>

				{/* ── Empty state (no child workspaces yet) ────────────────────── */}
				{N === 0 && (
					<div
						className="absolute flex flex-col items-center gap-1.5 text-center"
						style={{
							left: cx - 130,
							top: childRowY,
							width: 260,
						}}
					>
						<p className="text-sm text-muted-foreground">No branches yet.</p>
						<p className="text-xs text-muted-foreground/60">
							Add cards to the board and branches will appear here.
						</p>
					</div>
				)}

				{/* ── Child workspace nodes ────────────────────────────────────── */}
				{sorted.map((ws, i) => {
					const accent = cardAccent(ws);
					const lane = goalLaneForWorkspace(ws);
					const hasPr = ws.prSyncState && ws.prSyncState !== "none";

					return (
						<div
							key={ws.id}
							role={onSelectWorkspace ? "button" : undefined}
							tabIndex={onSelectWorkspace ? 0 : undefined}
							className={cn(
								"absolute flex flex-col justify-center gap-1.5 rounded-xl px-3 py-3 text-left transition-all",
								accent.isSubdued && "opacity-55",
								onSelectWorkspace &&
									"cursor-pointer hover:brightness-[1.04] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							)}
							style={{
								left: childLeft[i],
								top: childRowY,
								width: CHILD_W,
								height: CHILD_H,
								border: "1px solid",
								borderColor: accent.borderStyle,
								backgroundColor: accent.bgStyle,
							}}
							onClick={
								onSelectWorkspace ? () => onSelectWorkspace(ws) : undefined
							}
							onKeyDown={
								onSelectWorkspace
									? (e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												onSelectWorkspace(ws);
											}
										}
									: undefined
							}
						>
							{/* Title row with lane dot */}
							<div className="flex items-center gap-1.5">
								<span
									aria-hidden="true"
									className="size-2 shrink-0 rounded-full"
									style={{ backgroundColor: accent.dotColor }}
								/>
								<span className="min-w-0 truncate text-[11px] font-medium leading-tight text-foreground/90">
									{ws.title}
								</span>
								{/* Lane label badge */}
								<span
									className="ml-auto shrink-0 rounded px-1 py-0.5 text-[9px] uppercase tracking-wider"
									style={{
										backgroundColor: `color-mix(in srgb, ${accent.dotColor} 10%, transparent)`,
										color: accent.dotColor,
									}}
								>
									{lane}
								</span>
							</div>

							{/* Branch name */}
							{ws.branch && (
								<p className="truncate pl-3.5 font-mono text-[10px] text-muted-foreground/50">
									{ws.branch}
								</p>
							)}

							{/* PR badge */}
							{hasPr && (
								<div className="pl-3.5">
									<PrBadge prSyncState={ws.prSyncState!} prTitle={ws.prTitle} />
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
