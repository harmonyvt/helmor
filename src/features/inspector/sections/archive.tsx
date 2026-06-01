import { Play, RotateCcw, Settings2, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type TerminalHandle,
	TerminalOutput,
} from "@/components/terminal-output";
import { Button } from "@/components/ui/button";
import {
	TABS_EASING,
	TABS_HOVER_TRANSITION_MS,
	useTabsZoom,
} from "@/features/inspector/layout";
import {
	attach,
	detach,
	resizeScript,
	type ScriptStatus,
	startScript,
	stopScript,
	TRUNCATION_NOTICE,
	writeStdin,
} from "@/features/inspector/script-store";
import { cn } from "@/lib/utils";

type ArchiveTabProps = {
	repoId: string | null;
	workspaceId: string | null;
	scriptScopeId?: string | null;
	workingDirectoryOverride?: string | null;
	archiveScript: string | null;
	isActive: boolean;
	onOpenSettings: () => void;
};

export function ArchiveTab({
	repoId,
	workspaceId,
	scriptScopeId,
	workingDirectoryOverride,
	archiveScript,
	isActive,
	onOpenSettings,
}: ArchiveTabProps) {
	const termRef = useRef<TerminalHandle | null>(null);
	const [status, setStatus] = useState<ScriptStatus>("idle");
	const [hasRun, setHasRun] = useState(false);
	const { isZoomPresented, isHoverExpanded } = useTabsZoom();

	const hasScript = !!archiveScript?.trim();
	// Default the script scope to the workspace id when the parent
	// doesn't supply one explicitly — keeps existing call sites and
	// tests working unchanged.
	const effectiveScopeId = scriptScopeId ?? workspaceId;

	useEffect(() => {
		if (!workspaceId || !effectiveScopeId) return;

		const existing = attach(effectiveScopeId, "archive", {
			onChunk: (data) => {
				setHasRun(true);
				termRef.current?.write(data);
			},
			onStatusChange: (s) => {
				setStatus(s);
				if (s !== "idle") setHasRun(true);
			},
			onReset: () => {
				setHasRun(true);
				termRef.current?.clear();
			},
		});

		if (existing) {
			setHasRun(true);
			setStatus(existing.status);
			const replay = () => {
				const t = termRef.current;
				if (!t) return;
				t.clear();
				if (existing.truncated) t.write(TRUNCATION_NOTICE);
				for (const chunk of existing.chunks) t.write(chunk);
			};
			if (termRef.current) replay();
			else requestAnimationFrame(replay);
		} else {
			setHasRun(false);
			setStatus("idle");
			termRef.current?.clear();
		}

		return () => detach(effectiveScopeId, "archive");
	}, [workspaceId, effectiveScopeId]);

	const handleRun = useCallback(() => {
		if (!repoId || !workspaceId || !effectiveScopeId) return;
		termRef.current?.clear();
		setStatus("running");
		setHasRun(true);
		startScript(
			repoId,
			"archive",
			workspaceId,
			effectiveScopeId,
			workingDirectoryOverride,
		);
	}, [repoId, workspaceId, effectiveScopeId, workingDirectoryOverride]);

	const handleStop = useCallback(() => {
		if (!repoId || !workspaceId || !effectiveScopeId) return;
		stopScript(repoId, "archive", workspaceId, effectiveScopeId);
	}, [repoId, workspaceId, effectiveScopeId]);

	const handleData = useCallback(
		(data: string) => {
			if (!repoId || !workspaceId || !effectiveScopeId) return;
			writeStdin(repoId, "archive", workspaceId, effectiveScopeId, data);
		},
		[repoId, workspaceId, effectiveScopeId],
	);

	const handleResize = useCallback(
		(cols: number, rows: number) => {
			if (!repoId || !workspaceId || !effectiveScopeId) return;
			resizeScript(
				repoId,
				"archive",
				workspaceId,
				effectiveScopeId,
				cols,
				rows,
			);
		},
		[repoId, workspaceId, effectiveScopeId],
	);

	return (
		<div
			id="inspector-panel-archive"
			role="tabpanel"
			aria-labelledby="inspector-tab-archive"
			hidden={!isActive}
			className={cn(
				"relative flex min-h-0 flex-1 flex-col",
				!isActive && "pointer-events-none absolute inset-0 invisible opacity-0",
			)}
		>
			{hasRun ? (
				<>
					<div className="min-h-0 flex-1">
						<TerminalOutput
							terminalRef={termRef}
							className="h-full"
							onData={handleData}
							onResize={handleResize}
						/>
					</div>

					{isZoomPresented && (status === "running" || status === "exited") && (
						<div
							className="absolute bottom-3 right-4"
							style={{
								opacity: isHoverExpanded ? 1 : 0,
								pointerEvents: isHoverExpanded ? "auto" : "none",
								transition: `opacity ${TABS_HOVER_TRANSITION_MS}ms ${TABS_EASING}`,
							}}
						>
							<Button
								variant={status === "running" ? "destructive" : "secondary"}
								size="sm"
								className="text-[12px] shadow-sm backdrop-blur-sm transition-none"
								onClick={status === "running" ? handleStop : handleRun}
								disabled={status === "exited" && !hasScript}
							>
								{status === "running" ? (
									<Square className="size-3" strokeWidth={2} />
								) : (
									<RotateCcw className="size-3" strokeWidth={2} />
								)}
								{status === "running" ? "Stop" : "Rerun archive"}
							</Button>
						</div>
					)}
				</>
			) : !hasScript ? (
				<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
					<p className="text-[13px] font-medium text-muted-foreground">
						No archive script configured
					</p>
					<p className="text-[12px] text-muted-foreground/70">
						Add an archive script in repository settings to run it here.
					</p>
					<Button
						variant="outline"
						size="sm"
						className="mt-1 gap-1.5 text-[12px]"
						onClick={onOpenSettings}
					>
						<Settings2 className="size-3.5" strokeWidth={1.8} />
						Open settings
					</Button>
				</div>
			) : (
				<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
					<p className="text-[13px] text-muted-foreground">
						No archive script output
					</p>
					<p className="text-[12px] text-muted-foreground/70">
						Archive script output will appear here after running.
					</p>
					<Button
						variant="outline"
						size="sm"
						className="mt-1 gap-1.5 text-[12px]"
						onClick={handleRun}
					>
						<Play className="size-3" strokeWidth={2} />
						Run archive
					</Button>
				</div>
			)}
		</div>
	);
}
