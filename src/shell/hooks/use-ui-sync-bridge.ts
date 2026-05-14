import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	subscribeUiMutations,
	type ThreadMessageLike,
	type UiMutationEvent,
} from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import {
	mergeStreamingDelta,
	mergeStreamingPartial,
	sessionThreadCacheKey,
	shareMessages,
} from "@/lib/session-thread-cache";

type Options = {
	queryClient: QueryClient;
	processPendingCliSends: () => Promise<void> | void;
	reloadSettings: () => Promise<void> | void;
	refreshGithubIdentity: () => Promise<void> | void;
};

type StreamCacheGuard = {
	activeStreamingSessions: Set<string>;
	deferredMessageInvalidations: Map<string, string>;
};

function hasStreamingMessage(
	messages: ThreadMessageLike[] | undefined,
): boolean {
	return (messages ?? []).some((message) => message.streaming === true);
}

function invalidateAllWorkspaceChanges(queryClient: QueryClient) {
	void queryClient.invalidateQueries({
		predicate: (query) => query.queryKey[0] === "workspaceChanges",
	});
	void queryClient.invalidateQueries({
		predicate: (query) => query.queryKey[0] === "workspaceFiles",
	});
}

function invalidateWorkspaceLists(queryClient: QueryClient) {
	void queryClient.invalidateQueries({
		queryKey: helmorQueryKeys.workspaceGroups,
	});
	void queryClient.invalidateQueries({
		predicate: (query) => query.queryKey[0] === "goalChildWorkspaces",
	});
}

function handleUiMutation(
	event: UiMutationEvent,
	queryClient: QueryClient,
	options: Omit<Options, "queryClient"> & {
		streamCacheGuard: StreamCacheGuard;
	},
) {
	switch (event.type) {
		case "workspaceListChanged":
			invalidateWorkspaceLists(queryClient);
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.archivedWorkspaces,
			});
			void queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey[0] === "workspaceCandidateDirectories",
			});
			return;
		case "workspaceChanged":
			invalidateWorkspaceLists(queryClient);
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceDetail(event.workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceLinkedDirectories(event.workspaceId),
			});
			return;
		case "sessionListChanged":
		case "sessionModeChanged":
			invalidateWorkspaceLists(queryClient);
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceDetail(event.workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceSessions(event.workspaceId),
			});
			return;
		case "sessionMessagesChanged":
			invalidateWorkspaceLists(queryClient);
			{
				const cacheKey = sessionThreadCacheKey(event.sessionId);
				const liveMessages =
					queryClient.getQueryData<ThreadMessageLike[]>(cacheKey);
				if (
					options.streamCacheGuard.activeStreamingSessions.has(
						event.sessionId,
					) &&
					hasStreamingMessage(liveMessages)
				) {
					options.streamCacheGuard.deferredMessageInvalidations.set(
						event.sessionId,
						event.workspaceId,
					);
				} else {
					void queryClient.invalidateQueries({ queryKey: cacheKey });
				}
			}
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceSessions(event.workspaceId),
			});
			return;
		case "sessionStreamEvent":
			invalidateWorkspaceLists(queryClient);
			{
				const streamEvent = event.event;
				let shouldInvalidateWorkspaceSessions = true;
				if (streamEvent.kind === "update") {
					queryClient.setQueryData<ThreadMessageLike[]>(
						sessionThreadCacheKey(event.sessionId),
						(prev) => shareMessages(prev ?? [], streamEvent.messages),
					);
					if (hasStreamingMessage(streamEvent.messages)) {
						options.streamCacheGuard.activeStreamingSessions.add(
							event.sessionId,
						);
					} else {
						options.streamCacheGuard.activeStreamingSessions.delete(
							event.sessionId,
						);
						const deferredWorkspaceId =
							options.streamCacheGuard.deferredMessageInvalidations.get(
								event.sessionId,
							);
						if (deferredWorkspaceId) {
							options.streamCacheGuard.deferredMessageInvalidations.delete(
								event.sessionId,
							);
							void queryClient.invalidateQueries({
								queryKey: sessionThreadCacheKey(event.sessionId),
							});
							void queryClient.invalidateQueries({
								queryKey:
									helmorQueryKeys.workspaceSessions(deferredWorkspaceId),
							});
						}
					}
				} else if (streamEvent.kind === "streamingPartial") {
					mergeStreamingPartial(
						queryClient,
						event.sessionId,
						streamEvent.message,
					);
					options.streamCacheGuard.activeStreamingSessions.add(event.sessionId);
					shouldInvalidateWorkspaceSessions = false;
				} else if (streamEvent.kind === "streamingDelta") {
					mergeStreamingDelta(queryClient, event.sessionId, streamEvent.delta);
					options.streamCacheGuard.activeStreamingSessions.add(event.sessionId);
					shouldInvalidateWorkspaceSessions = false;
				}

				if (shouldInvalidateWorkspaceSessions) {
					void queryClient.invalidateQueries({
						queryKey: helmorQueryKeys.workspaceSessions(event.workspaceId),
					});
				}
			}
			return;
		case "contextUsageChanged":
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.sessionContextUsage(event.sessionId),
			});
			void queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey[0] === "claudeRichContextUsage" &&
					query.queryKey[1] === event.sessionId,
			});
			return;
		case "workspaceFilesChanged":
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceGitActionStatus(event.workspaceId),
			});
			invalidateAllWorkspaceChanges(queryClient);
			return;
		case "workspaceGitStateChanged":
			invalidateWorkspaceLists(queryClient);
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceDetail(event.workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceGitActionStatus(event.workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceForgeActionStatus(event.workspaceId),
			});
			invalidateAllWorkspaceChanges(queryClient);
			return;
		case "workspaceForgeChanged":
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceForge(event.workspaceId),
			});
			// CLI auth status lives in a separate cache (Settings → Account).
			// Backend already debounces/edge-detects this event, so the bridge
			// is the right place to fan out instead of redoing the check in
			// individual feature components.
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.forgeCliStatusAll,
			});
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspacePrComments(event.workspaceId),
			});
			return;
		case "workspaceChangeRequestChanged":
			invalidateWorkspaceLists(queryClient);
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceDetail(event.workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceChangeRequest(event.workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceForgeActionStatus(event.workspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspacePrComments(event.workspaceId),
			});
			return;
		case "workspaceBrowserTabsChanged":
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceBrowserTabs(event.workspaceId),
			});
			return;
		case "repositoryListChanged":
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.repositories,
			});
			return;
		case "repositoryChanged":
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.repositories,
			});
			void queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey[0] === "repoScripts" &&
					query.queryKey[1] === event.repoId,
			});
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.repoPreferences(event.repoId),
			});
			void queryClient.invalidateQueries({
				predicate: (query) => query.queryKey[0] === "workspaceDetail",
			});
			invalidateWorkspaceLists(queryClient);
			return;
		case "settingsChanged":
			if (
				event.key === null ||
				event.key.startsWith("app.") ||
				event.key.startsWith("branch_prefix_")
			) {
				void options.reloadSettings();
			}
			if (
				event.key === null ||
				event.key === "auto_close_action_kinds" ||
				event.key === "auto_close_opt_in_asked"
			) {
				void queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.autoCloseActionKinds,
				});
				void queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.autoCloseOptInAsked,
				});
			}
			return;
		case "goalOrchestratorStateChanged":
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.goalOrchestratorState(event.goalWorkspaceId),
			});
			void queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.goalChildWorkspaces(event.goalWorkspaceId),
			});
			return;
		case "pendingCliSendQueued":
			void options.processPendingCliSends();
			return;
	}
}

export function useUiSyncBridge({
	queryClient,
	processPendingCliSends,
	reloadSettings,
	refreshGithubIdentity,
}: Options) {
	const processPendingCliSendsRef = useRef(processPendingCliSends);
	const reloadSettingsRef = useRef(reloadSettings);
	const refreshGithubIdentityRef = useRef(refreshGithubIdentity);
	const streamCacheGuardRef = useRef<StreamCacheGuard>({
		activeStreamingSessions: new Set(),
		deferredMessageInvalidations: new Map(),
	});

	useEffect(() => {
		processPendingCliSendsRef.current = processPendingCliSends;
		reloadSettingsRef.current = reloadSettings;
		refreshGithubIdentityRef.current = refreshGithubIdentity;
	}, [processPendingCliSends, refreshGithubIdentity, reloadSettings]);

	useEffect(() => {
		let disposed = false;

		void subscribeUiMutations((event) => {
			if (disposed) {
				return;
			}

			handleUiMutation(event, queryClient, {
				processPendingCliSends: () => processPendingCliSendsRef.current(),
				reloadSettings: () => reloadSettingsRef.current(),
				refreshGithubIdentity: () => refreshGithubIdentityRef.current(),
				streamCacheGuard: streamCacheGuardRef.current,
			});
		});

		return () => {
			disposed = true;
		};
	}, [queryClient]);
}
