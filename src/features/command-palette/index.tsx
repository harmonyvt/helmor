import { GitBranch, MessageSquare } from "lucide-react";
import { useState } from "react";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import {
	GroupIcon,
	humanizeBranch,
	workspaceStatusToTone,
} from "@/features/navigation/shared";
import type { WorkspaceGroup, WorkspaceRow } from "@/lib/api";
import { usePaletteSearch } from "./use-palette-search";

export type CommandPaletteProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceGroups: WorkspaceGroup[];
	archivedRows: WorkspaceRow[];
	selectedWorkspaceId: string | null;
	onSelectWorkspace: (id: string) => void;
	onSelectSession: (workspaceId: string, sessionId: string) => void;
};

export function CommandPalette({
	open,
	onOpenChange,
	workspaceGroups,
	archivedRows,
	selectedWorkspaceId,
	onSelectWorkspace,
	onSelectSession,
}: CommandPaletteProps) {
	const [query, setQuery] = useState("");

	const { workspaceItems, sessionItems, isLoadingSessions } = usePaletteSearch({
		query,
		workspaceGroups,
		archivedRows,
	});

	function close() {
		onOpenChange(false);
		setQuery("");
	}

	function handleSelectWorkspace(workspaceId: string) {
		onSelectWorkspace(workspaceId);
		close();
	}

	function handleSelectSession(workspaceId: string, sessionId: string) {
		onSelectSession(workspaceId, sessionId);
		close();
	}

	const hasWorkspaces = workspaceItems.length > 0;
	const hasSessions = sessionItems.length > 0;
	const isEmpty = !hasWorkspaces && !hasSessions;

	return (
		<CommandDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) close();
				else onOpenChange(true);
			}}
			className="sm:max-w-lg"
			title="Navigate"
			description="Search workspaces, branches, and threads"
		>
			<Command shouldFilter={false}>
				<CommandInput
					placeholder="Search workspaces, branches, threads…"
					value={query}
					onValueChange={setQuery}
					autoFocus
				/>
				<CommandList className="max-h-80">
					{hasWorkspaces && (
						<CommandGroup heading="Workspaces">
							{workspaceItems.map(({ row }) => {
								const tone = workspaceStatusToTone(row.status);
								return (
									<CommandItem
										key={row.id}
										value={row.id}
										data-checked={row.id === selectedWorkspaceId}
										onSelect={() => handleSelectWorkspace(row.id)}
									>
										<GroupIcon tone={tone} />
										<span className="min-w-0 flex-1 truncate">{row.title}</span>
										{row.branch && (
											<span className="ml-2 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
												<GitBranch className="size-3" />
												<span className="max-w-36 truncate">{row.branch}</span>
											</span>
										)}
										{row.repoName && (
											<span className="ml-2 shrink-0 text-xs text-muted-foreground/50">
												{row.repoName}
											</span>
										)}
									</CommandItem>
								);
							})}
						</CommandGroup>
					)}

					{hasSessions && (
						<>
							{hasWorkspaces && <CommandSeparator />}
							<CommandGroup heading="Threads">
								{sessionItems.map(({ result }) => (
									<CommandItem
										key={result.id}
										value={result.id}
										onSelect={() =>
											handleSelectSession(result.workspaceId, result.id)
										}
									>
										<MessageSquare className="size-4 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate">
											{result.sessionTitle}
										</span>
										<span className="ml-2 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
											<span className="max-w-28 truncate">
												{humanizeBranch(result.workspaceDirectoryName)}
											</span>
											{result.workspaceBranch && (
												<>
													<span className="opacity-40">·</span>
													<GitBranch className="size-3 opacity-60" />
													<span className="max-w-24 truncate">
														{result.workspaceBranch}
													</span>
												</>
											)}
										</span>
									</CommandItem>
								))}
							</CommandGroup>
						</>
					)}

					{isEmpty && (
						<CommandEmpty>
							{isLoadingSessions ? "Searching…" : "No results found."}
						</CommandEmpty>
					)}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
