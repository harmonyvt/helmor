import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceCommitLifecycle } from "@/features/commit/hooks/use-commit-lifecycle";
import type { WorkspaceDetail } from "@/lib/api";
import {
	helmorQueryKeys,
	workspaceChangeRequestQueryOptions,
	workspaceForgeActionStatusQueryOptions,
	workspaceForgeQueryOptions,
	workspaceGitActionStatusQueryOptions,
} from "@/lib/query-client";
import { useWorkspaceToast } from "@/lib/workspace-toast-context";

export function useGoalCardCommitLifecycle(workspace: WorkspaceDetail) {
	const queryClient = useQueryClient();
	const pushToast = useWorkspaceToast();
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
		workspace.activeSessionId ?? null,
	);
	const [displayedSessionId, setDisplayedSessionId] = useState<string | null>(
		workspace.activeSessionId ?? null,
	);
	const [sendingSessionIds, setSendingSessionIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [completedSessionIds, setCompletedSessionIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [abortedSessionIds, setAbortedSessionIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [interactionRequiredSessionIds, setInteractionRequiredSessionIds] =
		useState<Set<string>>(() => new Set());
	const selectedWorkspaceIdRef = useRef<string | null>(workspace.id);
	selectedWorkspaceIdRef.current = workspace.id;

	const changeRequestQuery = useQuery(
		workspaceChangeRequestQueryOptions(workspace.id, workspace),
	);
	const forgeQuery = useQuery(workspaceForgeQueryOptions(workspace.id));
	const forgeStatusQuery = useQuery(
		workspaceForgeActionStatusQueryOptions(workspace.id),
	);
	const gitStatusQuery = useQuery(
		workspaceGitActionStatusQueryOptions(workspace.id),
	);
	const changeRequest = changeRequestQuery.data ?? null;

	const lifecycle = useWorkspaceCommitLifecycle({
		queryClient,
		selectedWorkspaceId: workspace.id,
		selectedWorkspaceIdRef,
		selectedRepoId: workspace.repoId,
		selectedWorkspaceTargetBranch: workspace.intendedTargetBranch ?? null,
		selectedWorkspaceRemote: workspace.remote ?? null,
		changeRequest,
		forgeDetection: forgeQuery.data ?? null,
		forgeActionStatus: forgeStatusQuery.data ?? null,
		workspaceGitActionStatus: gitStatusQuery.data ?? null,
		completedSessionIds,
		abortedSessionIds,
		interactionRequiredSessionIds,
		sendingSessionIds,
		onSelectSession: (sessionId) => {
			setSelectedSessionId(sessionId);
			setDisplayedSessionId(sessionId);
		},
		pushToast,
	});

	useEffect(() => {
		setSelectedSessionId(workspace.activeSessionId ?? null);
		setDisplayedSessionId(workspace.activeSessionId ?? null);
		setSendingSessionIds(new Set());
		setCompletedSessionIds(new Set());
		setAbortedSessionIds(new Set());
		setInteractionRequiredSessionIds(new Set());
	}, [workspace.id, workspace.activeSessionId]);

	useEffect(() => {
		if (!workspace.goalWorkspaceId) return;
		void queryClient.invalidateQueries({
			queryKey: helmorQueryKeys.goalChildWorkspaces(workspace.goalWorkspaceId),
		});
	}, [
		changeRequest?.url,
		changeRequest?.state,
		queryClient,
		workspace.goalWorkspaceId,
	]);

	const handleInteractionSessionsChange = useCallback(
		(
			sessionWorkspaceMap: Map<string, string>,
			interactionCounts: Map<string, number>,
		) => {
			const next = new Set<string>();
			for (const [sessionId, count] of interactionCounts) {
				if (count <= 0) continue;
				if (sessionWorkspaceMap.get(sessionId) === workspace.id) {
					next.add(sessionId);
				}
			}
			setInteractionRequiredSessionIds(next);
		},
		[workspace.id],
	);

	const handleSessionCompleted = useCallback(
		(sessionId: string, workspaceId: string) => {
			if (workspaceId !== workspace.id) return;
			setCompletedSessionIds((current) => new Set(current).add(sessionId));
		},
		[workspace.id],
	);

	const handleSessionAborted = useCallback(
		(sessionId: string, workspaceId: string) => {
			if (workspaceId !== workspace.id) return;
			setAbortedSessionIds((current) => new Set(current).add(sessionId));
		},
		[workspace.id],
	);

	return {
		...lifecycle,
		changeRequest,
		forgeIsRefreshing:
			changeRequestQuery.isLoading || forgeStatusQuery.isLoading,
		selectedSessionId,
		displayedSessionId,
		setSelectedSessionId,
		setDisplayedSessionId,
		setSendingSessionIds,
		handleInteractionSessionsChange,
		handleSessionCompleted,
		handleSessionAborted,
	};
}
