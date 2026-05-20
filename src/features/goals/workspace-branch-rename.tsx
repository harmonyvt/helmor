import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import { renameWorkspaceBranch, type WorkspaceDetail } from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { useWorkspaceToast } from "@/lib/workspace-toast-context";

type WorkspaceBranchRenameProps = {
	workspace: WorkspaceDetail;
	className?: string;
	onBranchRenamed?: () => void;
};

export function WorkspaceBranchRename({
	workspace,
	className,
	onBranchRenamed,
}: WorkspaceBranchRenameProps) {
	const queryClient = useQueryClient();
	const pushToast = useWorkspaceToast();
	const [editingBranch, setEditingBranch] = useState<string | null>(null);
	const canRename = Boolean(workspace.branch) && workspace.state !== "archived";

	const patchBranch = useCallback(
		(branch: string) => {
			const detailKey = helmorQueryKeys.workspaceDetail(workspace.id);
			const previousDetail = queryClient.getQueryData<WorkspaceDetail | null>(
				detailKey,
			);
			if (previousDetail) {
				queryClient.setQueryData<WorkspaceDetail | null>(detailKey, {
					...previousDetail,
					branch,
				});
			}
			if (workspace.goalWorkspaceId) {
				const childKey = helmorQueryKeys.goalChildWorkspaces(
					workspace.goalWorkspaceId,
				);
				const previousChildren =
					queryClient.getQueryData<WorkspaceDetail[]>(childKey);
				if (previousChildren) {
					queryClient.setQueryData<WorkspaceDetail[]>(
						childKey,
						previousChildren.map((child) =>
							child.id === workspace.id ? { ...child, branch } : child,
						),
					);
				}
			}
			return previousDetail;
		},
		[queryClient, workspace.goalWorkspaceId, workspace.id],
	);

	const commitRename = useCallback(async () => {
		if (editingBranch === null || !workspace.branch) {
			setEditingBranch(null);
			return;
		}
		const trimmed = editingBranch.trim();
		setEditingBranch(null);
		if (!trimmed || trimmed === workspace.branch) {
			return;
		}

		const previousDetail = patchBranch(trimmed);
		try {
			await renameWorkspaceBranch(workspace.id, trimmed);
			onBranchRenamed?.();
		} catch (error: unknown) {
			if (previousDetail) {
				queryClient.setQueryData<WorkspaceDetail | null>(
					helmorQueryKeys.workspaceDetail(workspace.id),
					previousDetail,
				);
			}
			if (workspace.goalWorkspaceId) {
				void queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.goalChildWorkspaces(
						workspace.goalWorkspaceId,
					),
				});
			}
			pushToast(
				error instanceof Error ? error.message : "Failed to rename branch",
				"Branch rename failed",
				"destructive",
			);
		}
	}, [
		editingBranch,
		onBranchRenamed,
		patchBranch,
		pushToast,
		queryClient,
		workspace.branch,
		workspace.goalWorkspaceId,
		workspace.id,
	]);

	if (!workspace.branch) {
		return (
			<span className={cn("truncate text-muted-foreground", className)}>
				No branch
			</span>
		);
	}

	if (editingBranch !== null) {
		return (
			<Input
				autoFocus
				value={editingBranch}
				onChange={(event) => setEditingBranch(event.target.value)}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.key === "Enter") {
						event.preventDefault();
						void commitRename();
					} else if (event.key === "Escape") {
						setEditingBranch(null);
					}
				}}
				onBlur={() => void commitRename()}
				onClick={(event) => event.stopPropagation()}
				className={cn(
					"h-5 min-w-0 max-w-[min(100%,14rem)] truncate rounded border-border bg-background px-1 py-0 text-[10.5px] font-medium text-foreground",
					className,
				)}
			/>
		);
	}

	return (
		<span
			className={cn(
				"group/branch relative inline-flex min-w-0 max-w-[min(100%,14rem)] items-center",
				className,
			)}
		>
			<span className="min-w-0 truncate">{workspace.branch}</span>
			{canRename ? (
				<button
					type="button"
					aria-label="Rename branch"
					onClick={(event) => {
						event.stopPropagation();
						setEditingBranch(workspace.branch ?? "");
					}}
					className="invisible absolute inset-y-0 right-0 flex cursor-pointer items-center rounded-sm bg-background/90 pl-4 pr-0.5 text-muted-foreground transition-colors hover:text-foreground group-hover/branch:visible"
				>
					<Pencil className="size-2.5" strokeWidth={2} />
				</button>
			) : null}
		</span>
	);
}
