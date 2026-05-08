import { Archive } from "lucide-react";
import { useRef, useState } from "react";
import { humanizeBranch } from "@/features/navigation/shared";
import type { WorkspaceRow as WorkspaceRowData } from "@/lib/api";
import { parsePrUrl } from "@/lib/pr-url";
import { cn } from "@/lib/utils";

export interface WorkspaceRowProps {
	workspace: WorkspaceRowData;
	selected: boolean;
	onSelect: (id: string) => void;
	onArchive?: (id: string) => void;
}

function statusDotColor(status: WorkspaceRowData["status"]): string {
	switch (status) {
		case "in-progress":
			return "var(--workspace-sidebar-status-progress)";
		case "review":
			return "var(--workspace-sidebar-status-review)";
		case "done":
			return "var(--workspace-sidebar-status-backlog)";
		case "canceled":
			return "var(--workspace-sidebar-status-canceled)";
		default:
			return "var(--workspace-sidebar-status-backlog)";
	}
}

function prAccentColor(
	prSyncState: WorkspaceRowData["prSyncState"],
): string | null {
	switch (prSyncState) {
		case "open":
			return "var(--workspace-pr-open-accent)";
		case "merged":
			return "var(--workspace-pr-merged-accent)";
		case "closed":
			return "var(--workspace-pr-closed-accent)";
		default:
			return null;
	}
}

export function WorkspaceRow({
	workspace,
	selected,
	onSelect,
	onArchive,
}: WorkspaceRowProps) {
	const [swipeX, setSwipeX] = useState(0);
	const [swiping, setSwiping] = useState(false);
	const startXRef = useRef(0);
	const swipeXRef = useRef(0);

	const displayTitle = workspace.branch
		? humanizeBranch(workspace.branch)
		: (workspace.title ?? workspace.directoryName ?? workspace.id);

	const unreadCount =
		(workspace.workspaceUnread ?? 0) + (workspace.unreadSessionCount ?? 0);

	const parsedPr = parsePrUrl(workspace.prUrl);
	const prNumber = parsedPr?.number ?? null;
	const accent = prAccentColor(workspace.prSyncState);

	function handlePointerDown(e: React.PointerEvent) {
		startXRef.current = e.clientX;
		swipeXRef.current = swipeX;
		setSwiping(true);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: React.PointerEvent) {
		if (!swiping) return;
		const delta = e.clientX - startXRef.current + swipeXRef.current;
		const clamped = Math.max(-120, Math.min(0, delta));
		setSwipeX(clamped);
	}

	function handlePointerUp() {
		if (!swiping) return;
		setSwiping(false);
		if (swipeX < -80) {
			setSwipeX(-80);
		} else {
			setSwipeX(0);
		}
	}

	function handlePointerCancel() {
		setSwiping(false);
		setSwipeX(0);
	}

	return (
		<div className="relative w-full overflow-hidden">
			{/* Archive action behind the row */}
			<button
				type="button"
				aria-label="Archive workspace"
				className="absolute inset-y-0 right-0 flex w-20 cursor-pointer items-center justify-center bg-destructive"
				onClick={() => onArchive?.(workspace.id)}
			>
				<Archive className="h-4 w-4 text-destructive-foreground" />
			</button>

			{/* Row content */}
			<div
				className={cn(
					"relative flex min-h-[52px] w-full cursor-pointer items-center gap-3 px-4",
					"hover:bg-accent/50",
					selected && "bg-accent",
				)}
				style={{
					transform: `translateX(${swipeX}px)`,
					transition: swipeX === 0 ? "transform 200ms ease-out" : "none",
					backgroundColor: selected ? undefined : undefined,
				}}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerCancel}
				onClick={() => {
					if (swipeX === 0) {
						onSelect(workspace.id);
					}
				}}
			>
				{/* Status dot */}
				<div
					className="shrink-0 rounded-full"
					style={{
						width: "3px",
						height: "20px",
						backgroundColor: statusDotColor(workspace.status),
					}}
				/>

				{/* Center column */}
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="truncate text-sm font-medium text-foreground">
						{displayTitle}
					</span>
					{workspace.branch ? (
						<span className="truncate text-xs text-muted-foreground">
							{workspace.branch}
						</span>
					) : null}
				</div>

				{/* Right section */}
				<div className="flex shrink-0 items-center gap-2">
					{prNumber !== null && accent !== null && (
						<span
							className="rounded-full px-2 py-0.5 text-[11px] font-medium"
							style={{
								backgroundColor: `color-mix(in srgb, ${accent} 15%, transparent)`,
								color: accent,
							}}
						>
							#{prNumber}
						</span>
					)}
					{unreadCount > 0 && (
						<span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
							{unreadCount > 99 ? "99+" : unreadCount}
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
