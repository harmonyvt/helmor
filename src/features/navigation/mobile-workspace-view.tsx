import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, Plus } from "lucide-react";
import { useContext, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WorkspaceRow } from "@/lib/api";
import {
	archivedWorkspacesQueryOptions,
	workspaceGroupsQueryOptions,
} from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { MobileShellContext } from "@/shell/mobile-shell";
import { GroupIcon, humanizeBranch, workspaceStatusToTone } from "./shared";
import { projectSidebarListsByGoal } from "./sidebar-projection";

interface MobileWorkspaceViewProps {
	selectedWorkspaceId: string | null;
	onWorkspaceSelect: (workspaceId: string) => void;
}

function WorkspaceItem({
	workspace,
	selected,
	onSelect,
}: {
	workspace: WorkspaceRow;
	selected: boolean;
	onSelect: (id: string) => void;
}) {
	const displayTitle = workspace.branch
		? humanizeBranch(workspace.branch)
		: (workspace.title ?? workspace.directoryName ?? workspace.id);
	const hasUnread = workspace.hasUnread ?? false;
	const unreadCount =
		(workspace.workspaceUnread ?? 0) + (workspace.unreadSessionCount ?? 0);

	return (
		<button
			type="button"
			className={cn(
				"flex min-h-[52px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left",
				"hover:bg-accent/50",
				selected && "bg-accent",
			)}
			onClick={() => onSelect(workspace.id)}
			aria-label={displayTitle}
			aria-pressed={selected}
		>
			<GroupIcon tone={workspaceStatusToTone(workspace.status)} />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span
					className={cn(
						"truncate text-sm text-foreground",
						hasUnread && "font-semibold",
					)}
				>
					{displayTitle}
				</span>
				{workspace.branch ? (
					<span className="truncate text-xs text-muted-foreground">
						{workspace.branch}
					</span>
				) : null}
			</div>
			{unreadCount > 0 ? (
				<span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
					{unreadCount > 99 ? "99+" : unreadCount}
				</span>
			) : null}
		</button>
	);
}

function GroupHeader({ label, count }: { label: string; count: number }) {
	return (
		<div className="flex items-center justify-between px-4 py-2">
			<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</span>
			<span className="text-xs text-muted-foreground">{count}</span>
		</div>
	);
}

export default function MobileWorkspaceView({
	selectedWorkspaceId,
	onWorkspaceSelect,
}: MobileWorkspaceViewProps) {
	const { navigateToTab } = useContext(MobileShellContext);

	const groupsQuery = useQuery(workspaceGroupsQueryOptions());
	const archivedQuery = useQuery(archivedWorkspacesQueryOptions());

	const groups = groupsQuery.data ?? [];
	const archivedSummaries = archivedQuery.data ?? [];

	const projection = useMemo(
		() => projectSidebarListsByGoal(groups, new Map(), archivedSummaries),
		[groups, archivedSummaries],
	);

	const { projectGroups, ungroupedRows, archivedGoalRows } = projection;

	// Track collapsed goals. Absent = expanded; present = collapsed.
	const [expandedGoals, setExpandedGoals] = useState<Set<string>>(
		() => new Set<string>(),
	);

	function toggleGoal(goalId: string) {
		setExpandedGoals((prev) => {
			const next = new Set(prev);
			if (next.has(goalId)) {
				next.delete(goalId);
			} else {
				next.add(goalId);
			}
			return next;
		});
	}

	const isEmpty =
		projectGroups.length === 0 &&
		ungroupedRows.length === 0 &&
		archivedGoalRows.length === 0;

	return (
		<div className="flex h-full flex-col overflow-hidden bg-background">
			{/* Header */}
			<div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
				<span className="text-sm font-semibold">Workspaces</span>
				<Button variant="ghost" size="icon-sm" className="cursor-pointer">
					<Plus className="h-4 w-4" />
				</Button>
			</div>

			{/* Goals hierarchy list */}
			<div className="flex-1 overflow-y-auto scrollbar-none pb-4">
				{isEmpty ? (
					<div className="flex flex-1 items-center justify-center p-8">
						<div className="text-center">
							<p className="text-sm text-muted-foreground">
								No workspaces yet.
							</p>
							<p className="mt-1 text-xs text-muted-foreground/70">
								Add a repository to get started.
							</p>
						</div>
					</div>
				) : (
					<>
						{/* Repo + goal groups */}
						{projectGroups.map((projectGroup) => (
							<div key={projectGroup.repoName}>
								{/* Repo section header */}
								<div className="flex items-center gap-2 px-4 py-2">
									{projectGroup.repoIconSrc ? (
										<img
											src={projectGroup.repoIconSrc}
											alt={projectGroup.repoName}
											className="size-5 shrink-0 rounded"
										/>
									) : projectGroup.repoInitials ? (
										<span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground">
											{projectGroup.repoInitials}
										</span>
									) : null}
									<span className="text-xs font-semibold text-foreground">
										{projectGroup.repoName}
									</span>
								</div>

								{/* Goal folder rows */}
								{projectGroup.goalGroups.map((goal) => {
									const isOpen = !expandedGoals.has(goal.goalWorkspaceId);
									return (
										<div key={goal.goalWorkspaceId}>
											<button
												type="button"
												className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 px-4 py-2 hover:bg-accent/50"
												onClick={() => {
													toggleGoal(goal.goalWorkspaceId);
													onWorkspaceSelect(goal.goalWorkspaceId);
													navigateToTab("thread");
												}}
											>
												<ChevronRight
													className={cn(
														"size-3 shrink-0 text-muted-foreground transition-transform",
														isOpen && "rotate-90",
													)}
												/>
												<Folder className="size-3.5 shrink-0 text-muted-foreground" />
												<span className="flex-1 truncate text-sm font-medium">
													{goal.goalTitle}
												</span>
												{goal.childRows.length > 0 && (
													<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
														{goal.childRows.length}
													</span>
												)}
											</button>

											{/* Child workspace rows (shown when expanded) */}
											{isOpen &&
												goal.childRows.map((row) => (
													<button
														key={row.id}
														type="button"
														className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 py-2 pl-8 pr-4 hover:bg-accent/50"
														onClick={() => {
															onWorkspaceSelect(row.id);
															navigateToTab("thread");
														}}
													>
														<GroupIcon
															tone={workspaceStatusToTone(row.status)}
														/>
														<span className="flex-1 truncate text-sm">
															{humanizeBranch(row.branch ?? "") ||
																row.title ||
																row.directoryName ||
																row.id}
														</span>
													</button>
												))}
										</div>
									);
								})}
							</div>
						))}

						{/* Ungrouped code workspaces */}
						{ungroupedRows.length > 0 && (
							<div>
								<GroupHeader label="Workspaces" count={ungroupedRows.length} />
								{ungroupedRows.map((row) => (
									<WorkspaceItem
										key={row.id}
										workspace={row}
										selected={selectedWorkspaceId === row.id}
										onSelect={(id) => {
											onWorkspaceSelect(id);
											navigateToTab("thread");
										}}
									/>
								))}
							</div>
						)}

						{/* Archived goal workspaces */}
						{archivedGoalRows.length > 0 && (
							<div>
								<GroupHeader label="Archived" count={archivedGoalRows.length} />
								{archivedGoalRows.map((row) => (
									<WorkspaceItem
										key={row.id}
										workspace={row}
										selected={selectedWorkspaceId === row.id}
										onSelect={(id) => {
											onWorkspaceSelect(id);
											navigateToTab("thread");
										}}
									/>
								))}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
