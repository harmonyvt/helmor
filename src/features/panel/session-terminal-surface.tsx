import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type TerminalHandle,
	TerminalOutput,
} from "@/components/terminal-output";
import { Button } from "@/components/ui/button";
import {
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
	const [terminalReadyToken, setTerminalReadyToken] = useState(0);
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
		setStatus(existing.status);

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
			if (startTimerRef.current !== null) {
				window.clearTimeout(startTimerRef.current);
				startTimerRef.current = null;
			}
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
		if (terminalReadyToken === 0) return;
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
	}, [repoId, session.id, startTerminalOnce, terminalReadyToken, workspaceId]);

	const handleTerminalReady = useCallback(() => {
		setTerminalReadyToken((token) => token + 1);
	}, []);

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
			{/* Terminal title bar */}
			<div
				className={cn(
					"flex min-h-7 items-center justify-between gap-3 border-b px-3",
					"border-white/[0.06] bg-[color-mix(in_oklab,var(--terminal-background)_92%,white_8%)]",
					isAgentOwned && "border-amber-500/20 bg-amber-500/10",
				)}
			>
				{/* Left: mode · runtime · path */}
				<div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px]">
					<span className="text-white/40">{terminalModeLabel(session)}</span>
					<span className="text-white/25">·</span>
					<span className="text-white/60">{terminalRuntimeLabel(runtime)}</span>
					{(session.terminalCwd ?? workspace?.rootPath) ? (
						<>
							<span className="text-white/25">·</span>
							<span className="truncate text-white/35">
								{session.terminalCwd ?? workspace?.rootPath}
							</span>
						</>
					) : null}
					{tmuxLabel ? (
						<>
							<span className="text-white/20">›</span>
							<span className="text-white/40">{tmuxLabel}</span>
						</>
					) : null}
				</div>

				{/* Right: status indicator + actions */}
				<div className="flex shrink-0 items-center gap-2.5">
					{/* Status dot + label */}
					<div
						className={cn(
							"flex items-center gap-1.5 font-mono text-[10px]",
							status === "running"
								? "text-emerald-400/70"
								: status === "exited"
									? "text-white/25"
									: "text-amber-400/60",
						)}
					>
						<span
							className={cn(
								"inline-block h-1.5 w-1.5 rounded-full",
								status === "running"
									? "bg-emerald-400/70"
									: status === "exited"
										? "bg-white/20"
										: "animate-pulse bg-amber-400/60",
							)}
						/>
						{status === "running"
							? "running"
							: status === "exited"
								? "exited"
								: "starting…"}
					</div>
					{tmuxStatus?.dead ? (
						<span className="font-mono text-[10px] text-red-400/60">
							pane dead
						</span>
					) : null}
					{isAgentOwned ? (
						<Button
							size="xs"
							variant="ghost"
							className="h-5 cursor-pointer px-2 font-mono text-[10px] text-amber-300/70 hover:bg-amber-500/10 hover:text-amber-300"
							onClick={handleTakeControl}
						>
							take control
						</Button>
					) : null}
					{status === "running" ? (
						<Button
							size="xs"
							variant="ghost"
							className="h-5 cursor-pointer px-2 font-mono text-[10px] text-white/30 hover:bg-white/5 hover:text-white/60"
							onClick={handleStop}
						>
							stop
						</Button>
					) : null}
				</div>
			</div>
			{isAgentOwned ? (
				<div className="border-b border-amber-500/20 bg-amber-500/[0.07] px-3 py-1.5 font-mono text-[11px] text-amber-300/80">
					controlled by {ownerLabel(session)} — click{" "}
					<span className="font-semibold text-amber-300">take control</span> to
					type in this terminal
				</div>
			) : null}
			<div className="min-h-0 flex-1">
				<TerminalOutput
					terminalRef={termRef}
					className="h-full"
					onData={handleData}
					onResize={handleResize}
					onTitleChange={handleTerminalTitleChange}
					onReady={handleTerminalReady}
				/>
			</div>
		</div>
	);
}
