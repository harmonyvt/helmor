import { ExternalLink, GitBranch } from "lucide-react";
import type { PrSyncState, WorkspaceDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { GOAL_LANES } from "./board-model";

function PrStateBadge({ state }: { state: PrSyncState | null | undefined }) {
	if (!state) return null;
	const config: Record<string, { label: string; className: string }> = {
		open: {
			label: "Open",
			className:
				"bg-[color-mix(in_srgb,var(--workspace-pr-open-accent)_10%,transparent)] text-[var(--workspace-pr-open-accent)] border-[color-mix(in_srgb,var(--workspace-pr-open-accent)_30%,var(--border))]",
		},
		merged: {
			label: "Merged",
			className:
				"bg-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_10%,transparent)] text-[var(--workspace-pr-merged-accent)] border-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_30%,var(--border))]",
		},
		closed: {
			label: "Closed",
			className:
				"bg-[color-mix(in_srgb,var(--workspace-pr-closed-accent)_10%,transparent)] text-[var(--workspace-pr-closed-accent)] border-[color-mix(in_srgb,var(--workspace-pr-closed-accent)_30%,var(--border))]",
		},
	};
	const entry = config[state] ?? {
		label: state,
		className: "bg-muted text-muted-foreground border-border/60",
	};
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
				entry.className,
			)}
		>
			{entry.label}
		</span>
	);
}

type GoalChangesViewProps = {
	workspaces: WorkspaceDetail[];
	onSelectWorkspace?: (workspace: WorkspaceDetail) => void;
};

export function GoalChangesView({
	workspaces,
	onSelectWorkspace,
}: GoalChangesViewProps) {
	if (workspaces.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<p className="text-sm text-muted-foreground">No cards yet.</p>
			</div>
		);
	}

	const laneMap = Object.fromEntries(GOAL_LANES.map((l) => [l.id, l]));

	// Sort: workspaces with branches first, then by lane order
	const laneOrder = Object.fromEntries(GOAL_LANES.map((l, i) => [l.id, i]));
	const sorted = [...workspaces].sort((a, b) => {
		const aBranch = a.branch ? 0 : 1;
		const bBranch = b.branch ? 0 : 1;
		if (aBranch !== bBranch) return aBranch - bBranch;
		return (laneOrder[a.status] ?? 99) - (laneOrder[b.status] ?? 99);
	});

	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<table className="w-full border-collapse text-sm">
				<thead>
					<tr className="border-b border-border/70 bg-muted/10">
						<th className="px-5 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
							Card
						</th>
						<th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
							Branch
						</th>
						<th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
							Pull Request
						</th>
						<th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
							Lane
						</th>
					</tr>
				</thead>
				<tbody>
					{sorted.map((ws) => {
						const lane = laneMap[ws.status];
						const noBranch = !ws.branch;
						return (
							<tr
								key={ws.id}
								className={cn(
									"border-b border-border/50 transition-colors",
									onSelectWorkspace && "cursor-pointer hover:bg-muted/20",
									noBranch && "opacity-50",
								)}
								onClick={
									onSelectWorkspace ? () => onSelectWorkspace(ws) : undefined
								}
							>
								<td className="px-5 py-3 font-medium leading-5">{ws.title}</td>

								<td className="px-4 py-3">
									{ws.branch ? (
										<div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
											<GitBranch className="size-3 shrink-0" />
											<span className="max-w-[220px] truncate">
												{ws.branch}
											</span>
										</div>
									) : (
										<span className="text-[11px] text-muted-foreground/40">
											No branch
										</span>
									)}
								</td>

								<td className="px-4 py-3">
									{ws.prUrl ? (
										<div className="flex items-center gap-2">
											<PrStateBadge state={ws.prSyncState} />
											{/* stop propagation so row click doesn't fire when opening the link */}
											<a
												href={ws.prUrl}
												target="_blank"
												rel="noreferrer"
												onClick={(e) => e.stopPropagation()}
												className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
											>
												<span className="max-w-[160px] truncate">
													{ws.prTitle ?? "View PR"}
												</span>
												<ExternalLink className="size-2.5 shrink-0" />
											</a>
										</div>
									) : (
										<span className="text-[11px] text-muted-foreground/40">
											—
										</span>
									)}
								</td>

								<td className="px-4 py-3">
									<div className="flex items-center gap-1.5">
										{lane ? (
											<span
												className="size-1.5 shrink-0 rounded-full"
												style={{ backgroundColor: lane.color }}
												aria-hidden="true"
											/>
										) : null}
										<span className="text-[12px] text-muted-foreground">
											{lane?.label ?? ws.status}
										</span>
									</div>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
