import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getFileUnifiedDiff } from "@/lib/api";

const TRIGGER_GAP = 8;
const VIEWPORT_PADDING = 16;
const POPOVER_WIDTH = 560; // px, ~35rem

export type FileDiffScope =
	| { kind: "unstaged" }
	| { kind: "staged" }
	| { kind: "branch"; fromRef: string; toRef: string };

type PopoverPos = {
	// Anchor right edge of popover to left edge of trigger
	right: number;
	top: number;
	maxHeight: number;
};

type DiffState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "ready"; diff: string }
	| { status: "empty" };

type FileDiffHoverHandle = {
	/** Attach to the element's onMouseEnter */
	onMouseEnter: () => void;
	/** Attach to the element's onMouseLeave */
	onMouseLeave: () => void;
	/** Render this alongside the element (portal-based, no layout effect) */
	popover: React.ReactNode;
};

/**
 * Returns mouse-event handlers and a portal popover that shows a unified diff
 * when the user hovers the element the handlers are attached to.
 *
 * Usage:
 *   const { onMouseEnter, onMouseLeave, popover } = useFileDiffHover(ref, ...)
 *   <div ref={ref} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
 *     ...
 *     {popover}
 *   </div>
 */
export function useFileDiffHover(
	triggerRef: React.RefObject<HTMLElement | null>,
	workspaceRootPath: string | null | undefined,
	relativePath: string,
	scope: FileDiffScope,
): FileDiffHoverHandle {
	const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const fetchedForRef = useRef<string | null>(null);
	const [pos, setPos] = useState<PopoverPos | null>(null);
	const [diffState, setDiffState] = useState<DiffState>({ status: "idle" });

	const show = useCallback(() => {
		if (!workspaceRootPath) return;
		if (hideTimer.current) {
			clearTimeout(hideTimer.current);
			hideTimer.current = null;
		}

		if (triggerRef.current) {
			const rect = triggerRef.current.getBoundingClientRect();
			const viewportHeight = window.innerHeight;
			const viewportWidth = window.innerWidth;

			// Right edge of popover = left edge of trigger minus gap
			const right = viewportWidth - rect.left + TRIGGER_GAP;
			// Align popover top with row top, clamped to viewport
			const top = Math.max(
				VIEWPORT_PADDING,
				Math.min(rect.top, viewportHeight - VIEWPORT_PADDING - 160),
			);
			const maxHeight = viewportHeight - top - VIEWPORT_PADDING;

			setPos({ right, top, maxHeight });
		}

		// Cache key: don't re-fetch for the same path + scope
		const cacheKey = `${relativePath}::${JSON.stringify(scope)}`;
		if (fetchedForRef.current === cacheKey) return;
		fetchedForRef.current = cacheKey;

		setDiffState({ status: "loading" });

		const fromRef = scope.kind === "branch" ? scope.fromRef : undefined;
		const toRef = scope.kind === "branch" ? scope.toRef : undefined;
		const cached = scope.kind === "staged";

		getFileUnifiedDiff(workspaceRootPath, relativePath, fromRef, toRef, cached)
			.then((diff) => {
				if (diff && diff.trim().length > 0) {
					setDiffState({ status: "ready", diff });
				} else {
					setDiffState({ status: "empty" });
				}
			})
			.catch(() => {
				setDiffState({ status: "empty" });
			});
	}, [workspaceRootPath, relativePath, scope, triggerRef]);

	const hide = useCallback(() => {
		hideTimer.current = setTimeout(() => setPos(null), 150);
	}, []);

	const popover =
		pos && workspaceRootPath
			? createPortal(
					<div
						onMouseEnter={show}
						onMouseLeave={hide}
						className="fixed z-[100] flex flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
						style={{
							right: pos.right,
							top: pos.top,
							width: POPOVER_WIDTH,
							maxHeight: pos.maxHeight,
						}}
					>
						<div className="shrink-0 truncate border-b border-border/50 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
							{relativePath}
						</div>
						<div className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-5">
							<DiffContent diffState={diffState} />
						</div>
					</div>,
					document.body,
				)
			: null;

	return { onMouseEnter: show, onMouseLeave: hide, popover };
}

function DiffContent({ diffState }: { diffState: DiffState }) {
	if (diffState.status === "loading") {
		return (
			<div className="px-3 py-3 text-[10.5px] text-muted-foreground/60">
				Loading diff…
			</div>
		);
	}
	if (diffState.status === "empty" || diffState.status === "idle") {
		return (
			<div className="px-3 py-3 text-[10.5px] text-muted-foreground/60">
				No diff available
			</div>
		);
	}

	return (
		<>
			{diffState.diff.split("\n").map((line, index) => {
				const isAdd = line.startsWith("+") && !line.startsWith("+++");
				const isDel = line.startsWith("-") && !line.startsWith("---");
				const isHeader =
					line.startsWith("@@") ||
					line.startsWith("diff --git") ||
					line.startsWith("index ") ||
					line.startsWith("--- ") ||
					line.startsWith("+++ ");
				return (
					<div
						key={index}
						className={
							isAdd
								? "flex whitespace-pre-wrap bg-chart-2/10"
								: isDel
									? "flex whitespace-pre-wrap bg-destructive/10"
									: isHeader
										? "flex whitespace-pre-wrap bg-accent/35"
										: "flex whitespace-pre-wrap"
						}
					>
						<span className="mr-1 w-4 shrink-0 select-none border-r border-border/20 text-center">
							{isAdd ? (
								<span className="text-chart-2/70">+</span>
							) : isDel ? (
								<span className="text-destructive/60">-</span>
							) : null}
						</span>
						<span
							className={
								isAdd
									? "min-w-0 text-chart-2"
									: isDel
										? "min-w-0 text-destructive/80"
										: isHeader
											? "min-w-0 text-muted-foreground"
											: "min-w-0 text-foreground/80"
							}
						>
							{line}
						</span>
					</div>
				);
			})}
		</>
	);
}
