import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type TerminalHandle,
	TerminalOutput,
} from "@/components/terminal-output";
import { Button } from "@/components/ui/button";
import {
	captureSessionTerminal,
	getSessionTerminalStatus,
	renameSession,
	updateSessionControl,
	type WorkspaceDetail,
	type WorkspaceSessionSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	formatLiveTerminalTitle,
	shouldAutoUpdateTerminalTitle,
	terminalModeLabel,
	terminalRuntimeLabel,
} from "./session-terminal-labels";
import {
	attachSessionTerminal,
	detachSessionTerminal,
	resizeSessionTerminalProcess,
	SESSION_TERMINAL_TRUNCATION_NOTICE,
	type SessionTerminalStatus,
	startSessionTerminal,
	stopSessionTerminalProcess,
	writeSessionTerminal,
} from "./session-terminal-store";

type SessionTerminalSurfaceProps = {
	workspace: WorkspaceDetail | null;
	session: WorkspaceSessionSummary;
	onSessionRenamed?: (sessionId: string, title: string) => void;
};

function ownerLabel(session: WorkspaceSessionSummary) {
	if (session.controlOwner === "agent") return session.agentType ?? "agent";
	if (session.controlOwner === "system") return "system";
	return "you";
}

export function SessionTerminalSurface({
	workspace,
	session,
	onSessionRenamed,
}: SessionTerminalSurfaceProps) {
	const termRef = useRef<TerminalHandle | null>(null);
	const titleUpdateTimerRef = useRef<number | null>(null);
	const startTimerRef = useRef<number | null>(null);
	const startedSessionRef = useRef<string | null>(null);
	const lastQueuedTitleRef = useRef(session.title);
	const [status, setStatus] = useState<SessionTerminalStatus>(
		session.terminalStoppedAt ? "exited" : "new",
	);
	const repoId = workspace?.repoId ?? null;
	const workspaceId = workspace?.id ?? null;
	const runtime = session.terminalRuntime ?? "shell";
	const controlOwner = session.controlOwner ?? "user";
	const inputPolicy = session.inputPolicy ?? "writable";
	const isAgentOwned = controlOwner !== "user";
	const writable = inputPolicy === "writable";
	const tmuxStatusQuery = useQuery({
		queryKey: ["sessionTerminalStatus", workspaceId, session.id],
		queryFn: () => getSessionTerminalStatus(workspaceId!, session.id),
		enabled: Boolean(workspaceId),
		refetchInterval: status === "running" ? 3000 : false,
	});
	const tmuxStatus = tmuxStatusQuery.data;
	// Show current command only when it differs from the expected runtime
	// (e.g. agent launched a sub-process). Hide client count and other
	// technical tmux details — they're noise for the vast majority of users.
	const tmuxLabel = (() => {
		if (!tmuxStatus?.available) return null;
		if (tmuxStatus.dead) return null; // rendered separately as a "pane dead" badge
		if (
			tmuxStatus.exists &&
			tmuxStatus.currentCommand &&
			tmuxStatus.currentCommand !== runtime
		) {
			return tmuxStatus.currentCommand;
		}
		return null;
	})();

	useEffect(() => {
		lastQueuedTitleRef.current = session.title;
		if (
			!shouldAutoUpdateTerminalTitle(session.title) &&
			titleUpdateTimerRef.current !== null
		) {
			window.clearTimeout(titleUpdateTimerRef.current);
			titleUpdateTimerRef.current = null;
		}
	}, [session.title]);

	useEffect(() => {
		return () => {
			if (titleUpdateTimerRef.current !== null) {
				window.clearTimeout(titleUpdateTimerRef.current);
			}
			if (startTimerRef.current !== null) {
				window.clearTimeout(startTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		startedSessionRef.current = null;
		setStatus(session.terminalStoppedAt ? "exited" : "new");
	}, [session.id, session.terminalStoppedAt]);

	useEffect(() => {
		const existing = attachSessionTerminal(session.id, {
			onChunk: (data) => termRef.current?.write(data),
			onStatusChange: (nextStatus) => setStatus(nextStatus),
		});

		let rafId: number | null = null;
		const replay = () => {
			rafId = null;
			const terminal = termRef.current;
			if (!terminal) {
				rafId = requestAnimationFrame(replay);
				return;
			}
			if (existing.chunks.length > 0) {
				terminal.clear();
				if (existing.truncated)
					terminal.write(SESSION_TERMINAL_TRUNCATION_NOTICE);
				for (const chunk of existing.chunks) terminal.write(chunk);
			}
			terminal.focus();
		};
		replay();

		return () => {
			if (rafId !== null) cancelAnimationFrame(rafId);
			detachSessionTerminal(session.id);
		};
	}, [session.id]);

	const startTerminalOnce = useCallback(
		(initialSize?: { cols: number; rows: number } | null) => {
			if (!repoId || !workspaceId) return;
			if (startedSessionRef.current === session.id) return;
			startedSessionRef.current = session.id;
			void startSessionTerminal(
				repoId,
				workspaceId,
				session.id,
				runtime,
				initialSize,
			);
		},
		[repoId, runtime, session.id, workspaceId],
	);

	useEffect(() => {
		if (!repoId || !workspaceId) return;
		if (startTimerRef.current !== null) {
			window.clearTimeout(startTimerRef.current);
		}
		startTimerRef.current = window.setTimeout(() => {
			startTimerRef.current = null;
			startTerminalOnce(null);
		}, 250);
		return () => {
			if (startTimerRef.current !== null) {
				window.clearTimeout(startTimerRef.current);
				startTimerRef.current = null;
			}
		};
	}, [repoId, session.id, startTerminalOnce, workspaceId]);

	const handleData = useCallback(
		(data: string) => {
			if (!repoId || !workspaceId || !writable) return;
			writeSessionTerminal(repoId, workspaceId, session.id, data);
		},
		[repoId, session.id, writable, workspaceId],
	);

	const handleResize = useCallback(
		(cols: number, rows: number) => {
			if (!repoId || !workspaceId) return;
			startTerminalOnce({ cols, rows });
			resizeSessionTerminalProcess(repoId, workspaceId, session.id, cols, rows);
		},
		[repoId, session.id, startTerminalOnce, workspaceId],
	);

	const handleStop = useCallback(() => {
		if (!repoId || !workspaceId) return;
		stopSessionTerminalProcess(repoId, workspaceId, session.id);
	}, [repoId, session.id, workspaceId]);

	const handleCapture = useCallback(async () => {
		if (!workspaceId) return;
		const tail = await captureSessionTerminal(workspaceId, session.id, 120);
		const terminal = termRef.current;
		if (!terminal) return;
		terminal.clear();
		terminal.write(
			tail || "\r\n\x1b[2mNo tmux pane output captured.\x1b[0m\r\n",
		);
	}, [session.id, workspaceId]);

	const handleTakeControl = useCallback(() => {
		void updateSessionControl(session.id, "user", "writable");
	}, [session.id]);

	const handleTerminalTitleChange = useCallback(
		(title: string) => {
			if (!shouldAutoUpdateTerminalTitle(session.title)) return;
			const nextTitle = formatLiveTerminalTitle(session, title);
			if (nextTitle === lastQueuedTitleRef.current) return;
			lastQueuedTitleRef.current = nextTitle;
			onSessionRenamed?.(session.id, nextTitle);
			if (titleUpdateTimerRef.current !== null) {
				window.clearTimeout(titleUpdateTimerRef.current);
			}
			titleUpdateTimerRef.current = window.setTimeout(() => {
				titleUpdateTimerRef.current = null;
				void renameSession(session.id, nextTitle).catch(() => {
					lastQueuedTitleRef.current = session.title;
					onSessionRenamed?.(session.id, session.title);
				});
			}, 400);
		},
		[onSessionRenamed, session],
	);

	return (
		<div
			className={cn(
				"flex min-h-0 flex-1 flex-col overflow-hidden border-t bg-[var(--terminal-background)]",
				isAgentOwned &&
					"border-amber-500/70 ring-1 ring-inset ring-amber-500/50",
			)}
		>
			<div
				className={cn(
					"flex min-h-9 items-center justify-between gap-3 border-b border-border/70 bg-background/80 px-3 text-xs",
					isAgentOwned &&
						"border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100",
				)}
			>
				<div className="flex min-w-0 items-center gap-2">
					<span className="font-medium">{terminalModeLabel(session)}</span>
					<span className="text-muted-foreground">
						{terminalRuntimeLabel(runtime)}
					</span>
					<span className="truncate text-muted-foreground">
						{session.terminalCwd ?? workspace?.rootPath ?? "workspace"}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<span
						className={cn(
							"text-muted-foreground",
							status === "new" && "animate-pulse",
						)}
					>
						{status === "running"
							? "Running"
							: status === "exited"
								? "Exited"
								: "Starting…"}
					</span>
					{tmuxStatus?.dead ? (
						<span className="text-[11px] text-destructive/80">pane dead</span>
					) : tmuxLabel ? (
						<span className="text-muted-foreground">{tmuxLabel}</span>
					) : null}
					{/* Keep Capture visible but disabled when tmux is available yet the
					    session hasn't started — this ensures users can discover it. */}
					{tmuxStatus?.available ? (
						<Button
							size="xs"
							variant="ghost"
							className="cursor-pointer"
							disabled={!tmuxStatus.exists}
							onClick={handleCapture}
							title={
								tmuxStatus.exists
									? "Capture the last 120 lines from the tmux pane"
									: "Available once the terminal is running"
							}
						>
							Capture
						</Button>
					) : null}
					{isAgentOwned ? (
						<Button
							size="xs"
							variant="outline"
							className="cursor-pointer"
							onClick={handleTakeControl}
						>
							Take Control
						</Button>
					) : null}
					{status === "running" ? (
						<Button
							size="xs"
							variant="ghost"
							className="cursor-pointer"
							onClick={handleStop}
						>
							Stop
						</Button>
					) : null}
				</div>
			</div>
			{isAgentOwned ? (
				<div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
					Controlled by {ownerLabel(session)} — click{" "}
					<strong className="font-semibold">Take Control</strong> to type in
					this terminal.
				</div>
			) : null}
			<div className="min-h-0 flex-1">
				<TerminalOutput
					terminalRef={termRef}
					className="h-full"
					onData={handleData}
					onResize={handleResize}
					onTitleChange={handleTerminalTitleChange}
				/>
			</div>
		</div>
	);
}
