import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceSessionSummary } from "@/lib/api";
import { workspaceSessionsQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";

interface SessionTabStripProps {
	workspaceId: string;
	selectedSessionId: string | null;
	onSessionSelect: (id: string | null, options?: { replace?: boolean }) => void;
	onNewSession: () => void;
}

function truncateLabel(label: string): string {
	if (label.length <= 20) return label;
	return `${label.slice(0, 20)}…`;
}

export function SessionTabStrip({
	workspaceId,
	selectedSessionId,
	onSessionSelect,
	onNewSession,
}: SessionTabStripProps) {
	const { data: sessions = [] } = useQuery(
		workspaceSessionsQueryOptions(workspaceId),
	);

	const visibleSessions = sessions.filter(
		(s: WorkspaceSessionSummary) =>
			!s.isHidden && !s.actionKind && !s.parentSessionId,
	);

	return (
		<div className="h-10 shrink-0 flex items-end overflow-x-auto scrollbar-none px-3 gap-1 border-b border-border bg-background">
			{visibleSessions.map((session: WorkspaceSessionSummary) => {
				const isActive = session.id === selectedSessionId;
				return (
					<button
						key={session.id}
						type="button"
						onClick={() => onSessionSelect(session.id)}
						className={cn(
							"px-3 h-8 text-sm shrink-0 cursor-pointer rounded-t-lg flex items-center gap-1.5 transition-colors",
							isActive
								? "text-foreground font-medium bg-background border border-b-0 border-border -mb-px"
								: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
						)}
					>
						{truncateLabel(session.title || "Session")}
					</button>
				);
			})}
			<div className="flex items-center ml-auto shrink-0">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onNewSession}
					className="cursor-pointer"
				>
					<Plus className="h-3.5 w-3.5" />
					<span className="sr-only">New session</span>
				</Button>
			</div>
		</div>
	);
}
