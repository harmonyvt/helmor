import { useCallback, useEffect, useRef, useState } from "react";
import {
	type TerminalHandle,
	TerminalOutput,
} from "@/components/terminal-output";
import { Button } from "@/components/ui/button";
import {
	updateSessionControl,
	type WorkspaceDetail,
	type WorkspaceSessionSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";
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
};

function modeLabel(session: WorkspaceSessionSummary) {
	return session.surfaceMode === "agent_terminal"
		? "Agent Terminal"
		: "Terminal";
}

function ownerLabel(session: WorkspaceSessionSummary) {
	if (session.controlOwner === "agent") return session.agentType ?? "agent";
	if (session.controlOwner === "system") return "system";
	return "you";
}

export function SessionTerminalSurface({
	workspace,
	session,
}: SessionTerminalSurfaceProps) {
	const termRef = useRef<TerminalHandle | null>(null);
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

	useEffect(() => {
		if (!repoId || !workspaceId) return;
		void startSessionTerminal(repoId, workspaceId, session.id, runtime);
	}, [repoId, runtime, session.id, workspaceId]);

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
			resizeSessionTerminalProcess(repoId, workspaceId, session.id, cols, rows);
		},
		[repoId, session.id, workspaceId],
	);

	const handleStop = useCallback(() => {
		if (!repoId || !workspaceId) return;
		stopSessionTerminalProcess(repoId, workspaceId, session.id);
	}, [repoId, session.id, workspaceId]);

	const handleTakeControl = useCallback(() => {
		void updateSessionControl(session.id, "user", "writable");
	}, [session.id]);

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
					<span className="font-medium">{modeLabel(session)}</span>
					<span className="text-muted-foreground">{runtime}</span>
					<span className="truncate text-muted-foreground">
						{session.terminalCwd ?? workspace?.rootPath ?? "workspace"}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<span className="text-muted-foreground">
						{status === "running"
							? "Running"
							: status === "exited"
								? "Exited"
								: "Starting"}
					</span>
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
					{ownerLabel(session)} controls this terminal. Request control before
					typing.
				</div>
			) : null}
			<div className="min-h-0 flex-1">
				<TerminalOutput
					terminalRef={termRef}
					className="h-full"
					onData={handleData}
					onResize={handleResize}
				/>
			</div>
		</div>
	);
}
