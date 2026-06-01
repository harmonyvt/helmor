import { GitMergeIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LaneRow } from "./git-timeline-lanes";

// Horizontal spacing per lane. The SVG stretches vertically to fill the
// commit row, so we use a normalized viewBox height (0–100) and keep
// strokes crisp via `vectorEffect="non-scaling-stroke"`. The commit dot is
// rendered as an HTML overlay so it stays circular regardless of how tall
// the surrounding row ends up.
const LANE_WIDTH = 12;
const VBOX_H = 100;
const STROKE_WIDTH = 1.25;

/** Per-lane stroke palette. Cycles so each branch keeps a stable hue. */
const LANE_COLORS = [
	"hsl(214 85% 58%)", // blue
	"hsl(150 60% 45%)", // green
	"hsl(28 90% 55%)", // orange
	"hsl(280 65% 60%)", // purple
	"hsl(340 75% 58%)", // pink
	"hsl(190 70% 45%)", // teal
];

function laneColor(lane: number): string {
	return LANE_COLORS[lane % LANE_COLORS.length] ?? LANE_COLORS[0]!;
}

function laneX(lane: number): number {
	return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

export type GraphCellProps = {
	row: LaneRow;
	/** Number of lane columns. Must be >= every row's widest snapshot so
	 *  the rail width stays constant across rows in the same timeline. */
	laneCount: number;
	/** True when this commit is the tip of the current HEAD branch — dot
	 *  gets the blue accent ring. */
	isHead: boolean;
	/** True when the commit has 2+ parents — dot is drawn hollow with a
	 *  small merge glyph echo so the commit body's merge icon has a
	 *  matching visual on the rail. */
	isMerge: boolean;
};

/** SVG + overlay-dot graph cell drawn left of each commit row. Layout
 *  decisions live in `git-timeline-lanes.ts`; this file just paints. */
export function GraphCell({ row, laneCount, isHead, isMerge }: GraphCellProps) {
	const width = Math.max(1, laneCount) * LANE_WIDTH;
	const midY = VBOX_H / 2;
	const cx = laneX(row.commitLane);

	const segments: React.ReactElement[] = [];

	// 1. Pass-through verticals: lanes present on BOTH sides of this row,
	//    other than the commit's own lane (drawn explicitly below so it
	//    doesn't pass under the dot).
	const passThroughCount = Math.max(row.incoming.length, row.outgoing.length);
	for (let lane = 0; lane < passThroughCount; lane++) {
		if (lane === row.commitLane) continue;
		const hasIn = lane < row.incoming.length && row.incoming[lane] !== null;
		const hasOut = lane < row.outgoing.length && row.outgoing[lane] !== null;
		if (!hasIn || !hasOut) continue;
		segments.push(
			<line
				key={`pt-${lane}`}
				x1={laneX(lane)}
				y1={0}
				x2={laneX(lane)}
				y2={VBOX_H}
				stroke={laneColor(lane)}
				strokeWidth={STROKE_WIDTH}
				vectorEffect="non-scaling-stroke"
			/>,
		);
	}

	// 2. Incoming top-half in the commit's own lane (suppressed on tip
	//    rows where nothing flows in from above).
	if (
		row.commitLane < row.incoming.length &&
		row.incoming[row.commitLane] != null
	) {
		segments.push(
			<line
				key="in-self"
				x1={cx}
				y1={0}
				x2={cx}
				y2={midY}
				stroke={laneColor(row.commitLane)}
				strokeWidth={STROKE_WIDTH}
				vectorEffect="non-scaling-stroke"
			/>,
		);
	}

	// 3. Incoming curves from OTHER lanes also expecting this SHA (two
	//    branches converging on one commit — rare but visually important).
	for (let lane = 0; lane < row.incoming.length; lane++) {
		if (lane === row.commitLane) continue;
		const incomingSha = row.incoming[lane];
		if (incomingSha == null) continue;
		const stillPresent =
			lane < row.outgoing.length && row.outgoing[lane] === incomingSha;
		if (stillPresent) continue;
		segments.push(
			<path
				key={`in-curve-${lane}`}
				d={curve(laneX(lane), 0, cx, midY)}
				stroke={laneColor(lane)}
				strokeWidth={STROKE_WIDTH}
				vectorEffect="non-scaling-stroke"
				fill="none"
			/>,
		);
	}

	// 4. Outgoing segments to each parent. First-parent staying in the
	//    same lane = straight vertical; branch / merge parents = smooth
	//    Bézier curve into the target lane.
	row.parentLanes.forEach((lane, idx) => {
		const toX = laneX(lane);
		const color = laneColor(lane);
		if (lane === row.commitLane) {
			segments.push(
				<line
					key={`out-${idx}`}
					x1={cx}
					y1={midY}
					x2={toX}
					y2={VBOX_H}
					stroke={color}
					strokeWidth={STROKE_WIDTH}
					vectorEffect="non-scaling-stroke"
				/>,
			);
		} else {
			segments.push(
				<path
					key={`out-${idx}`}
					d={curve(cx, midY, toX, VBOX_H)}
					stroke={color}
					strokeWidth={STROKE_WIDTH}
					vectorEffect="non-scaling-stroke"
					fill="none"
				/>,
			);
		}
	});

	const dotColor = isHead
		? "var(--color-blue-500, hsl(214 100% 60%))"
		: laneColor(row.commitLane);

	// Overlay-dot pixel position. `cx` is in viewBox units that equal
	// pixels horizontally (the SVG width matches the viewBox width), so we
	// can use it directly as a `left` value.
	return (
		<div
			className="relative shrink-0 self-stretch"
			style={{ width }}
			aria-hidden="true"
		>
			<svg
				className="absolute inset-0 h-full w-full"
				viewBox={`0 0 ${width} ${VBOX_H}`}
				preserveAspectRatio="none"
			>
				<title>commit graph</title>
				{segments}
			</svg>
			<span
				className={cn(
					"absolute top-1/2 z-10 flex size-2.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2",
					isHead && "ring-2 ring-blue-500/30",
				)}
				style={{
					left: cx,
					backgroundColor: isMerge ? "var(--color-sidebar)" : dotColor,
					borderColor: dotColor,
					boxShadow: isHead ? "0 0 0 2px var(--color-sidebar)" : undefined,
				}}
			>
				{isMerge && (
					<GitMergeIcon
						className="size-1.5"
						strokeWidth={2.5}
						style={{ color: dotColor }}
					/>
				)}
			</span>
		</div>
	);
}

/** Smooth S-curve between two lane points. Quadratic-on-each-half cubic
 *  Bézier with control points on the lanes' verticals — approximates the
 *  GitLens / VS Code timeline aesthetic. */
function curve(x1: number, y1: number, x2: number, y2: number): string {
	const midY = (y1 + y2) / 2;
	return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}
