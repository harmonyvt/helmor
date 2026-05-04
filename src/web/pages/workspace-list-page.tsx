import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	startArchiveWorkspace,
	type WorkspaceRow as WorkspaceRowData,
} from "@/lib/api";
import {
	archivedWorkspacesQueryOptions,
	workspaceGroupsQueryOptions,
} from "@/lib/query-client";
import { GroupHeader } from "@/web/components/group-header";
import { SkeletonRows } from "@/web/components/skeleton-rows";
import { WorkspaceRow } from "@/web/components/workspace-row";
import { WebHeader } from "@/web/shell/web-header";

interface WorkspaceListPageProps {
	selectedWorkspaceId: string | null;
	onWorkspaceSelect: (id: string) => void;
	isTablet?: boolean;
}

type GroupEntry = {
	id: string;
	label: string;
	workspaces: WorkspaceRowData[];
};

export default function WorkspaceListPage({
	selectedWorkspaceId,
	onWorkspaceSelect,
	isTablet = false,
}: WorkspaceListPageProps) {
	const [settingsOpen, setSettingsOpen] = useState(false);

	const groupsQuery = useQuery(workspaceGroupsQueryOptions());
	const archivedQuery = useQuery(archivedWorkspacesQueryOptions());

	const isLoading =
		groupsQuery.isFetching &&
		!groupsQuery.data?.length &&
		archivedQuery.isFetching &&
		!archivedQuery.data?.length;

	const groups = groupsQuery.data ?? [];
	const archivedRows = archivedQuery.data ?? [];

	const groupEntries: GroupEntry[] = [
		...groups
			.filter((g) => g.rows.length > 0)
			.map((g) => ({
				id: g.id,
				label: g.label,
				workspaces: g.rows,
			})),
		...(archivedRows.length > 0
			? [
					{
						id: "__archived__",
						label: "Archived",
						workspaces: archivedRows,
					},
				]
			: []),
	];

	const totalCount = groupEntries.reduce((n, g) => n + g.workspaces.length, 0);

	const isEmpty = !isLoading && totalCount === 0;

	async function handleArchive(workspaceId: string) {
		try {
			await startArchiveWorkspace(workspaceId);
		} catch {
			// Archive errors are non-fatal in this context
		}
	}

	const settingsGear = (
		<Button
			variant="ghost"
			size="icon-sm"
			className="cursor-pointer"
			onClick={() => setSettingsOpen(true)}
			aria-label="Settings"
		>
			<Settings className="h-4 w-4" />
		</Button>
	);

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sidebar">
			{isTablet ? (
				<>
					<div className="web-safe-area-top" />
					<div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
						<span className="text-sm font-semibold text-foreground">
							Helmor
						</span>
						<div className="flex items-center gap-1">{settingsGear}</div>
					</div>
				</>
			) : (
				<WebHeader title="Helmor" rightActions={settingsGear} />
			)}

			<div className="flex-1 overflow-y-auto scrollbar-none pb-4">
				{isLoading ? (
					<>
						<SkeletonRows />
						<SkeletonRows />
					</>
				) : isEmpty ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 pt-16">
						<p className="text-sm text-muted-foreground">No workspaces yet.</p>
						<p className="text-xs text-muted-foreground/60">
							Add a repository from the desktop app to get started.
						</p>
					</div>
				) : (
					groupEntries.map((group) => (
						<div key={group.id}>
							<GroupHeader
								label={group.label}
								count={group.workspaces.length}
							/>
							{group.workspaces.map((ws) => (
								<WorkspaceRow
									key={ws.id}
									workspace={ws}
									selected={selectedWorkspaceId === ws.id}
									onSelect={onWorkspaceSelect}
									onArchive={handleArchive}
								/>
							))}
						</div>
					))
				)}
			</div>

			<Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
				<SheetContent side="bottom">
					<SheetHeader>
						<SheetTitle>Settings</SheetTitle>
					</SheetHeader>
					<div className="p-4 text-sm text-muted-foreground">
						Full settings are available in the desktop app.
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}
