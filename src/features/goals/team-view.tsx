import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	Circle,
	Loader2,
} from "lucide-react";
import type { AssigneeSummary, WorkspaceDetail } from "@/lib/api";
import { cn } from "@/lib/utils";

type GoalTeamViewProps = {
	workspaces: WorkspaceDetail[];
	assignees: AssigneeSummary[];
	onSelectWorkspace?: (workspaceId: string) => void;
};

function statusLabel(
	sessionStatus: string,
	reportType: string | undefined,
): string {
	if (reportType === "blocked") return "blocked";
	if (reportType === "completed") return "done";
	if (sessionStatus === "streaming") return "running";
	return "idle";
}

function AgentRow({
	assignee,
	workspace,
	onOpen,
}: {
	assignee: AssigneeSummary;
	workspace: WorkspaceDetail | undefined;
	onOpen?: () => void;
}) {
	const report = assignee.latestReport;
	const label = statusLabel(assignee.sessionStatus, report?.reportType);
	const isRunning = label === "running";
	const isBlocked = label === "blocked";
	const isDone = label === "done";

	return (
		<div
			className={cn(
				"flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors",
				onOpen && "cursor-pointer hover:bg-accent/30",
				isBlocked ? "border-destructive/30" : "border-border/70",
			)}
			onClick={onOpen}
		>
			{/* Avatar icon */}
			<div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent">
				{isRunning ? (
					<Loader2 className="size-3.5 animate-spin text-accent-foreground" />
				) : isBlocked ? (
					<AlertTriangle className="size-3.5 text-destructive" />
				) : isDone ? (
					<CheckCircle2 className="size-3.5 text-success" />
				) : (
					<Bot className="size-3.5 text-accent-foreground" />
				)}
			</div>

			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-[12px] font-medium capitalize">
						{assignee.assigneeName}
					</span>
					<span
						className={cn(
							"rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
							isRunning
								? "bg-accent-foreground/10 text-accent-foreground"
								: isBlocked
									? "bg-destructive/10 text-destructive"
									: isDone
										? "bg-success/10 text-success"
										: "bg-muted text-muted-foreground",
						)}
					>
						{label}
					</span>
				</div>

				{workspace && (
					<p className="mt-0.5 truncate text-[11px] text-muted-foreground">
						{workspace.title}
					</p>
				)}

				{report?.excerpt && (
					<p
						className={cn(
							"mt-1.5 line-clamp-2 text-[11px] leading-relaxed",
							isBlocked ? "text-destructive/80" : "text-muted-foreground",
						)}
					>
						{report.excerpt}
					</p>
				)}
			</div>
		</div>
	);
}

export function GoalTeamView({
	workspaces,
	assignees,
	onSelectWorkspace,
}: GoalTeamViewProps) {
	const workspaceMap = new Map(workspaces.map((ws) => [ws.id, ws]));
	const assignedIds = new Set(assignees.map((a) => a.workspaceId));

	// Cards with no active agent that are still active (not done/canceled)
	const unassigned = workspaces.filter(
		(ws) =>
			!assignedIds.has(ws.id) &&
			ws.status !== "canceled" &&
			ws.status !== "done",
	);

	// Sort agents: running first, then blocked, then rest
	const sorted = [...assignees].sort((a, b) => {
		const score = (x: AssigneeSummary) => {
			if (x.sessionStatus === "streaming") return 2;
			if (x.latestReport?.reportType === "blocked") return 1;
			return 0;
		};
		return score(b) - score(a);
	});

	if (assignees.length === 0 && workspaces.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<p className="text-sm text-muted-foreground">No team members yet.</p>
			</div>
		);
	}

	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto max-w-2xl space-y-6 px-5 py-5">
				{sorted.length > 0 && (
					<section>
						<h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
							Assignees ({sorted.length})
						</h2>
						<div className="space-y-2">
							{sorted.map((assignee) => (
								<AgentRow
									key={assignee.workspaceId}
									assignee={assignee}
									workspace={workspaceMap.get(assignee.workspaceId)}
									onOpen={
										onSelectWorkspace
											? () => onSelectWorkspace(assignee.workspaceId)
											: undefined
									}
								/>
							))}
						</div>
					</section>
				)}

				{unassigned.length > 0 && (
					<section>
						<h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
							Unassigned ({unassigned.length})
						</h2>
						<div className="space-y-1.5">
							{unassigned.map((ws) => (
								<div
									key={ws.id}
									className={cn(
										"flex items-center gap-3 rounded-lg border border-border/60 px-4 py-2.5",
										onSelectWorkspace && "cursor-pointer hover:bg-accent/30",
									)}
									onClick={
										onSelectWorkspace
											? () => onSelectWorkspace(ws.id)
											: undefined
									}
								>
									<Circle className="size-3.5 shrink-0 text-muted-foreground/30" />
									<span className="text-sm text-muted-foreground">
										{ws.title}
									</span>
								</div>
							))}
						</div>
					</section>
				)}
			</div>
		</div>
	);
}
