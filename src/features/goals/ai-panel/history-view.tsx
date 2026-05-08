/**
 * History view — lists past Pi sessions for the current workspace,
 * sorted newest first, so the user can restore any prior conversation.
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceSessionSummary } from "@/lib/api";
import { workspaceSessionsQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";

type HistoryViewProps = {
	workspaceId: string;
	activeSessionId: string | null;
	onRestore: (session: WorkspaceSessionSummary) => void;
	onNewSession: () => void;
};

export function HistoryView({
	workspaceId,
	activeSessionId,
	onRestore,
	onNewSession,
}: HistoryViewProps) {
	const { data: sessions, isLoading } = useQuery(
		workspaceSessionsQueryOptions(workspaceId),
	);

	const piSessions = (sessions ?? [])
		.filter((s) => s.model?.startsWith("pi:") || s.agentType === "pi")
		.sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		);

	if (isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Loader2 className="size-4 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (piSessions.length === 0) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
				<p className="text-center text-[12px] text-muted-foreground/60">
					No previous conversations yet.
				</p>
				<Button
					size="sm"
					variant="outline"
					className="cursor-pointer text-[12px]"
					onClick={onNewSession}
				>
					<Plus className="mr-1.5 size-3" />
					Start a new chat
				</Button>
			</div>
		);
	}

	return (
		<div className="min-h-0 flex-1 overflow-y-auto py-1">
			{piSessions.map((session) => (
				<SessionRow
					key={session.id}
					session={session}
					isActive={session.id === activeSessionId}
					onRestore={onRestore}
				/>
			))}
		</div>
	);
}

function SessionRow({
	session,
	isActive,
	onRestore,
}: {
	session: WorkspaceSessionSummary;
	isActive: boolean;
	onRestore: (session: WorkspaceSessionSummary) => void;
}) {
	const label = session.title?.trim() || "Untitled conversation";
	const date = new Date(session.updatedAt).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year:
			new Date(session.updatedAt).getFullYear() !== new Date().getFullYear()
				? "numeric"
				: undefined,
	});
	const modelLabel =
		session.model?.replace(/^pi:/, "").split("/").pop() ?? "Pi";

	return (
		<button
			type="button"
			className={cn(
				"group flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
				isActive && "bg-muted/40",
			)}
			onClick={() => onRestore(session)}
		>
			<div className="flex items-center justify-between gap-2">
				<span
					className={cn(
						"truncate text-[12.5px] font-medium leading-snug",
						isActive ? "text-foreground" : "text-foreground/80",
					)}
				>
					{label}
				</span>
				{isActive && (
					<span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
						active
					</span>
				)}
			</div>
			<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/55">
				<span>{date}</span>
				<span>·</span>
				<span className="truncate">{modelLabel}</span>
			</div>
		</button>
	);
}
