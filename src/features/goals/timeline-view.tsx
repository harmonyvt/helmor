import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	Circle,
	GitPullRequest,
	Loader2,
} from "lucide-react";
import type React from "react";
import type { AssigneeReportMarker, WorkspaceDetail } from "@/lib/api";
import { cn } from "@/lib/utils";

type ActivityKind =
	| "blocked"
	| "running"
	| "completed"
	| "review"
	| "done"
	| "in-progress"
	| "backlog";

type ActivityItem = {
	id: string;
	workspace: WorkspaceDetail;
	kind: ActivityKind;
	report: AssigneeReportMarker | null;
	priority: number;
};

type KindConfig = {
	label: string;
	icon: React.ReactNode;
};

function kindConfig(kind: ActivityKind): KindConfig {
	switch (kind) {
		case "blocked":
			return {
				label: "Blocked",
				icon: <AlertTriangle className="size-3.5 text-destructive" />,
			};
		case "running":
			return {
				label: "Running",
				icon: (
					<Loader2 className="size-3.5 animate-spin text-accent-foreground" />
				),
			};
		case "completed":
			return {
				label: "Completed",
				icon: <CheckCircle2 className="size-3.5 text-success" />,
			};
		case "review":
			return {
				label: "In review",
				icon: (
					<GitPullRequest className="size-3.5 text-[var(--workspace-pr-open-accent)]" />
				),
			};
		case "done":
			return {
				label: "Done",
				icon: <CheckCircle2 className="size-3.5 text-muted-foreground/50" />,
			};
		case "in-progress":
			return {
				label: "In progress",
				icon: <Bot className="size-3.5 text-muted-foreground" />,
			};
		case "backlog":
			return {
				label: "Backlog",
				icon: <Circle className="size-3.5 text-muted-foreground/40" />,
			};
	}
}

function classifyItem(
	ws: WorkspaceDetail,
	report: AssigneeReportMarker | null,
): { kind: ActivityKind; priority: number } {
	const isRunning = ws.activeSessionStatus === "streaming";
	const isBlocked = report?.reportType === "blocked";
	const isCompleted = report?.reportType === "completed";

	if (isBlocked) return { kind: "blocked", priority: 100 };
	if (isRunning) return { kind: "running", priority: 90 };
	if (isCompleted) return { kind: "completed", priority: 80 };
	if (ws.status === "review") return { kind: "review", priority: 70 };
	if (ws.status === "in-progress") return { kind: "in-progress", priority: 60 };
	if (ws.status === "done") return { kind: "done", priority: 40 };
	return { kind: "backlog", priority: 20 };
}

type GoalTimelineViewProps = {
	workspaces: WorkspaceDetail[];
	reportByWorkspaceId: Map<string, AssigneeReportMarker>;
	onSelectWorkspace?: (workspace: WorkspaceDetail) => void;
};

export function GoalTimelineView({
	workspaces,
	reportByWorkspaceId,
	onSelectWorkspace,
}: GoalTimelineViewProps) {
	if (workspaces.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<p className="text-sm text-muted-foreground">No activity yet.</p>
			</div>
		);
	}

	const items: ActivityItem[] = workspaces.map((ws) => {
		const report = reportByWorkspaceId.get(ws.id) ?? null;
		const { kind, priority } = classifyItem(ws, report);
		return { id: ws.id, workspace: ws, kind, report, priority };
	});

	items.sort((a, b) => b.priority - a.priority);

	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto max-w-2xl px-5 py-5">
				<div className="relative">
					{/* Vertical connector line */}
					<div
						aria-hidden="true"
						className="absolute bottom-4 left-[18px] top-4 w-px bg-border/50"
					/>

					<div className="space-y-3">
						{items.map((item) => {
							const config = kindConfig(item.kind);
							return (
								<div
									key={item.id}
									className={cn(
										"relative flex gap-4",
										onSelectWorkspace && "cursor-pointer",
									)}
									onClick={
										onSelectWorkspace
											? () => onSelectWorkspace(item.workspace)
											: undefined
									}
								>
									{/* Timeline node */}
									<div className="relative z-10 mt-1 flex size-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background">
										{config.icon}
									</div>

									{/* Card */}
									<div
										className={cn(
											"min-w-0 flex-1 rounded-lg border border-border/60 px-3 py-2.5 transition-colors",
											onSelectWorkspace && "hover:bg-accent/20",
										)}
									>
										<div className="flex items-baseline justify-between gap-2">
											<span className="truncate text-sm font-medium leading-5">
												{item.workspace.title}
											</span>
											<span className="shrink-0 text-[10px] text-muted-foreground">
												{config.label}
											</span>
										</div>

										{item.workspace.branch && (
											<p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/60">
												{item.workspace.branch}
											</p>
										)}

										{item.report?.excerpt && (
											<p
												className={cn(
													"mt-1.5 line-clamp-2 text-[11px] leading-relaxed",
													item.kind === "blocked"
														? "text-destructive/80"
														: "text-muted-foreground",
												)}
											>
												{item.report.excerpt}
											</p>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
