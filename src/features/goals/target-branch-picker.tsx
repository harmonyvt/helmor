import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { BranchPickerPopover } from "@/components/branch-picker";
import {
	listRemoteBranches,
	prefetchRemoteRefs,
	updateIntendedTargetBranch,
	type WorkspaceDetail,
} from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { useWorkspaceToast } from "@/lib/workspace-toast-context";

type TargetBranchPickerProps = {
	workspace: WorkspaceDetail;
	className?: string;
	onTargetBranchChanged?: () => void;
};

export function TargetBranchPicker({
	workspace,
	className,
	onTargetBranchChanged,
}: TargetBranchPickerProps) {
	const queryClient = useQueryClient();
	const pushToast = useWorkspaceToast();
	const remote = workspace.remote ?? "origin";
	const currentBranch =
		workspace.intendedTargetBranch ?? workspace.defaultBranch ?? "";
	const isArchived = workspace.state === "archived";

	const branchesQuery = useQuery({
		queryKey: ["remoteBranches", workspace.id],
		queryFn: () => listRemoteBranches({ workspaceId: workspace.id }),
		enabled: !isArchived && Boolean(workspace.id),
		staleTime: 60_000,
	});

	if (!currentBranch) {
		return null;
	}

	if (isArchived) {
		return (
			<span className={cn("truncate", className)}>
				{remote}/{currentBranch}
			</span>
		);
	}

	const invalidateChanges = () => {
		if (!workspace.rootPath) return;
		void queryClient.invalidateQueries({
			queryKey: helmorQueryKeys.workspaceChanges(workspace.rootPath),
		});
	};

	const patchWorkspaceDetail = (branch: string) => {
		const detailKey = helmorQueryKeys.workspaceDetail(workspace.id);
		const previousDetail = queryClient.getQueryData<WorkspaceDetail | null>(
			detailKey,
		);
		if (previousDetail) {
			queryClient.setQueryData<WorkspaceDetail | null>(detailKey, {
				...previousDetail,
				intendedTargetBranch: branch,
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
						child.id === workspace.id
							? { ...child, intendedTargetBranch: branch }
							: child,
					),
				);
			}
		}
		return previousDetail;
	};

	return (
		<BranchPickerPopover
			currentBranch={currentBranch}
			branches={branchesQuery.data ?? []}
			loading={branchesQuery.isFetching}
			align="start"
			onOpen={() => {
				void branchesQuery.refetch();
				void prefetchRemoteRefs({ workspaceId: workspace.id })
					.then((result) => {
						if (result.fetched) {
							void branchesQuery.refetch();
						}
					})
					.catch(() => {});
			}}
			onSelect={(branch) => {
				if (branch === workspace.intendedTargetBranch) {
					return;
				}
				const previousDetail = patchWorkspaceDetail(branch);
				invalidateChanges();

				void updateIntendedTargetBranch(workspace.id, branch)
					.then(({ reset }) => {
						onTargetBranchChanged?.();
						void queryClient.invalidateQueries({
							queryKey: helmorQueryKeys.workspaceGitActionStatus(workspace.id),
						});
						invalidateChanges();
						if (reset) {
							pushToast(
								`Local branch reset to ${remote}/${branch}`,
								`Switched to ${branch}`,
								"default",
							);
						} else {
							pushToast(
								"Target branch updated",
								`Switched to ${branch}`,
								"default",
							);
						}
					})
					.catch((error: unknown) => {
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
							error instanceof Error
								? error.message
								: "Failed to update target branch",
							"Target branch",
							"destructive",
						);
					});
			}}
		>
			<button
				type="button"
				onClick={(event) => event.stopPropagation()}
				onKeyDown={(event) => event.stopPropagation()}
				className={cn(
					"inline-flex max-w-[min(100%,12rem)] cursor-pointer items-center gap-0.5 truncate rounded px-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
					className,
				)}
				aria-label={`Compare against ${remote}/${currentBranch}`}
			>
				<span className="truncate">
					{remote}/{currentBranch}
				</span>
				<ChevronDown className="size-2.5 shrink-0" strokeWidth={2} />
			</button>
		</BranchPickerPopover>
	);
}
