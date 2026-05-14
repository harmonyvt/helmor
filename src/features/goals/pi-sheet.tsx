import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	goalChildWorkspacesQueryOptions,
	workspaceDetailQueryOptions,
} from "@/lib/query-client";
import { GoalsAiPanel } from "./ai-panel";
import { createGoalKanbanSnapshot } from "./board-model";
import { useGoalPiState } from "./pi-state-context";

const PI_SHEET_WIDTH_KEY = "helmor.goalsPiSheetWidth";
const PI_SHEET_DEFAULT_WIDTH = 420;
const PI_SHEET_MIN_WIDTH = 320;
const PI_SHEET_MAX_WIDTH = 720;
const PI_SHEET_HIT_AREA = 20;

function getInitialSheetWidth(): number {
	try {
		const stored = localStorage.getItem(PI_SHEET_WIDTH_KEY);
		if (!stored) return PI_SHEET_DEFAULT_WIDTH;
		const parsed = Number.parseInt(stored, 10);
		return Number.isFinite(parsed)
			? Math.min(PI_SHEET_MAX_WIDTH, Math.max(PI_SHEET_MIN_WIDTH, parsed))
			: PI_SHEET_DEFAULT_WIDTH;
	} catch {
		return PI_SHEET_DEFAULT_WIDTH;
	}
}

type GoalPiSheetProps = {
	/** The goal workspace ID — used to fetch goal data and render GoalsAiPanel. */
	goalWorkspaceId: string;
};

/**
 * Floating Pi overlay that renders as a `position:fixed` right-edge panel via
 * a React portal.  Only mounts its inner content while `piState === "sheet"`.
 *
 * The panel independently fetches goal data so it works when GoalWorkspaceContainer
 * is not in the tree (i.e. when the user is viewing a child workspace).
 */
export function GoalPiSheet({ goalWorkspaceId }: GoalPiSheetProps) {
	const { piState, setPiState } = useGoalPiState();
	const isOpen = piState === "sheet";

	const [width, setWidth] = useState(getInitialSheetWidth);
	const [resizeState, setResizeState] = useState<{
		pointerX: number;
		startWidth: number;
	} | null>(null);

	// Drive the CSS translate — we mount immediately and animate in on the next frame.
	const [visible, setVisible] = useState(false);
	const visibleRef = useRef(visible);
	visibleRef.current = visible;

	// Animate open/close.
	useEffect(() => {
		if (isOpen) {
			// Force a frame so the translate-x-full starting state is painted first.
			const id = requestAnimationFrame(() => setVisible(true));
			return () => cancelAnimationFrame(id);
		}
		setVisible(false);
	}, [isOpen]);

	// Persist width.
	useEffect(() => {
		try {
			localStorage.setItem(PI_SHEET_WIDTH_KEY, String(width));
		} catch {}
	}, [width]);

	// Resize drag — same rAF pattern as the panel resize in GoalWorkspaceContainer.
	useEffect(() => {
		if (!resizeState) return;
		let pending: number | null = null;
		let rafId: number | null = null;
		const flush = () => {
			rafId = null;
			if (pending === null) return;
			const next = pending;
			pending = null;
			setWidth(next);
		};
		const onMove = (e: MouseEvent) => {
			const delta = e.clientX - resizeState.pointerX;
			pending = Math.min(
				PI_SHEET_MAX_WIDTH,
				Math.max(PI_SHEET_MIN_WIDTH, resizeState.startWidth - delta),
			);
			if (rafId === null) rafId = requestAnimationFrame(flush);
		};
		const onUp = () => {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			flush();
			setResizeState(null);
		};
		const prevCursor = document.body.style.cursor;
		const prevSelect = document.body.style.userSelect;
		document.body.style.cursor = "ew-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		return () => {
			if (rafId !== null) cancelAnimationFrame(rafId);
			document.body.style.cursor = prevCursor;
			document.body.style.userSelect = prevSelect;
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
	}, [resizeState]);

	// Goal data — fetched independently so the sheet works while the goal board
	// is unmounted (i.e. when viewing a child workspace).
	const detailQuery = useQuery(workspaceDetailQueryOptions(goalWorkspaceId));
	const childQuery = useQuery(goalChildWorkspacesQueryOptions(goalWorkspaceId));
	const cards = childQuery.data ?? [];
	const kanbanSnapshot = useMemo(
		() => createGoalKanbanSnapshot(cards),
		[cards],
	);
	const goalTitle =
		detailQuery.data?.goalTitle ?? detailQuery.data?.title ?? null;
	const goalDescription = detailQuery.data?.goalDescription ?? null;
	const canCreateCards = Boolean(
		detailQuery.data?.state === "ready" &&
			detailQuery.data?.branch &&
			detailQuery.data?.intendedTargetBranch &&
			detailQuery.data?.prSyncState === "open",
	);

	const handleClose = useCallback(() => setPiState("dock"), [setPiState]);

	// Don't mount anything when there's no active sheet.
	if (!isOpen) return null;

	return createPortal(
		<>
			{/* Backdrop: dims content behind the sheet, click to dismiss. */}
			<div
				className="fixed inset-0 z-40 bg-background/40 backdrop-blur-[1px]"
				onClick={handleClose}
				aria-hidden
			/>

			{/* Sheet panel */}
			<aside
				aria-label="Pi goal assistant"
				className={[
					"fixed inset-y-0 right-0 z-50 flex flex-col",
					"border-l border-border/70 bg-sidebar shadow-2xl",
					"transition-transform duration-200 ease-out",
					visible ? "translate-x-0" : "translate-x-full",
				].join(" ")}
				style={{ width }}
				// Prevent backdrop click from firing when clicking inside the panel.
				onClick={(e) => e.stopPropagation()}
			>
				{/* Resize handle — same ew-resize hit area as the sidebar panel. */}
				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize Pi panel"
					aria-valuemin={PI_SHEET_MIN_WIDTH}
					aria-valuemax={PI_SHEET_MAX_WIDTH}
					aria-valuenow={width}
					tabIndex={0}
					onMouseDown={(e) => {
						e.preventDefault();
						setResizeState({ pointerX: e.clientX, startWidth: width });
					}}
					className="group absolute inset-y-0 z-30 cursor-ew-resize touch-none outline-none"
					style={{
						left: `${-(PI_SHEET_HIT_AREA / 2)}px`,
						width: `${PI_SHEET_HIT_AREA}px`,
					}}
				/>

				<GoalsAiPanel
					workspaceId={goalWorkspaceId}
					cards={cards}
					kanbanSnapshot={kanbanSnapshot}
					goalTitle={goalTitle}
					goalDescription={goalDescription}
					canCreateCards={canCreateCards}
					onClose={handleClose}
				/>
			</aside>
		</>,
		document.body,
	);
}
