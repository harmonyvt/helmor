import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useContext } from "react";
import { Button } from "@/components/ui/button";
import type { WorkspaceGroup, WorkspaceRow } from "@/lib/api";
import {
	archivedWorkspacesQueryOptions,
	workspaceGroupsQueryOptions,
} from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { MobileShellContext } from "@/shell/mobile-shell";
import { GroupIcon, humanizeBranch } from "./shared";

interface MobileWorkspaceViewProps {
	selectedWorkspaceId: string | null;
	onWorkspaceSelect: (workspaceId: string) => void;
}

type GroupEntry = {
	id: string;
	label: string;
	tone: WorkspaceGroup["tone"] | "backlog";
	workspaces: WorkspaceRow[];
};

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
			<GroupIcon
				tone={
					workspace.status === "review"
						? "review"
						: workspace.status === "done"
							? "done"
							: workspace.status === "backlog"
								? "backlog"
								: workspace.status === "canceled"
									? "canceled"
									: "progress"
				}
			/>
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
	const archivedRows = archivedQuery.data ?? [];

	const groupEntries: GroupEntry[] = [
		...groups
			.filter((g) => g.rows.length > 0)
			.map((g) => ({
				id: g.id,
				label: g.label,
				tone: g.tone,
				workspaces: g.rows,
			})),
		...(archivedRows.length > 0
			? [
					{
						id: "__archived__",
						label: "Archived",
						tone: "backlog" as const,
						workspaces: archivedRows,
					},
				]
			: []),
	];

	const totalCount = groupEntries.reduce((n, g) => n + g.workspaces.length, 0);

	function handleSelect(workspaceId: string) {
		onWorkspaceSelect(workspaceId);
		navigateToTab("thread");
	}

	return (
		<div className="flex h-full flex-col overflow-hidden bg-background">
			{/* Header */}
			<div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
				<span className="text-sm font-semibold">Workspaces</span>
				<Button variant="ghost" size="icon-sm" className="cursor-pointer">
					<Plus className="h-4 w-4" />
				</Button>
			</div>

			{/* Grouped workspace list */}
			<div className="flex-1 overflow-y-auto scrollbar-none pb-4">
				{totalCount === 0 ? (
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
					groupEntries.map((group) => (
						<div key={group.id}>
							<GroupHeader
								label={group.label}
								count={group.workspaces.length}
							/>
							{group.workspaces.map((ws) => (
								<WorkspaceItem
									key={ws.id}
									workspace={ws}
									selected={selectedWorkspaceId === ws.id}
									onSelect={handleSelect}
								/>
							))}
						</div>
					))
				)}
			</div>
		</div>
	);
}
