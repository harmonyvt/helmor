import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceDetail, WorkspaceSessionSummary } from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import { terminalDefaultTitle } from "./session-terminal-labels";

export function buildOptimisticSession(
	workspaceId: string,
	sessionId: string,
	createdAt: string,
	mode: "thread" | "terminal" = "thread",
	runtime: string | null = null,
): WorkspaceSessionSummary {
	const isTerminal = mode === "terminal";
	return {
		id: sessionId,
		workspaceId,
		title: isTerminal
			? terminalDefaultTitle({
					surfaceMode: mode,
					terminalRuntime: runtime ?? "shell",
					agentType: runtime ?? "shell",
				})
			: "Untitled",
		agentType: isTerminal ? (runtime ?? "shell") : null,
		status: "idle",
		model: null,
		permissionMode: "default",
		providerSessionId: null,
		effortLevel: null,
		unreadCount: 0,
		fastMode: false,
		createdAt,
		updatedAt: createdAt,
		lastUserMessageAt: null,
		isHidden: false,
		actionKind: null,
		surfaceKind: isTerminal ? "terminal" : "chat",
		surfaceMode: mode,
		controlOwner: "user",
		inputPolicy: "writable",
		createdBy: "user",
		terminalRuntime: isTerminal ? (runtime ?? "shell") : null,
		terminalCwd: null,
		terminalStartedAt: null,
		terminalStoppedAt: null,
		terminalExitCode: null,
		active: true,
	};
}

type SeedNewSessionInCacheOptions = {
	queryClient: QueryClient;
	workspaceId: string;
	sessionId: string;
	workspace?: WorkspaceDetail | null;
	existingSessions?: WorkspaceSessionSummary[];
	createdAt?: string;
	mode?: "thread" | "terminal";
	runtime?: string | null;
};

export function seedNewSessionInCache({
	queryClient,
	workspaceId,
	sessionId,
	workspace = null,
	existingSessions,
	createdAt = new Date().toISOString(),
	mode = "thread",
	runtime = null,
}: SeedNewSessionInCacheOptions): WorkspaceSessionSummary {
	const optimisticSession = buildOptimisticSession(
		workspaceId,
		sessionId,
		createdAt,
		mode,
		runtime,
	);

	queryClient.setQueryData(
		helmorQueryKeys.workspaceDetail(workspaceId),
		(current: WorkspaceDetail | null | undefined) => {
			const base = current ?? workspace;
			if (!base) {
				return current;
			}

			return {
				...base,
				activeSessionId: sessionId,
				activeSessionTitle: optimisticSession.title,
				activeSessionAgentType: optimisticSession.agentType,
				activeSessionStatus: "idle",
				sessionCount:
					base.activeSessionId === sessionId
						? base.sessionCount
						: base.sessionCount + 1,
			};
		},
	);
	queryClient.setQueryData(
		helmorQueryKeys.workspaceSessions(workspaceId),
		(current: WorkspaceSessionSummary[] | undefined) => {
			const resolvedSessions = current ?? existingSessions ?? [];
			if (resolvedSessions.some((session) => session.id === sessionId)) {
				return resolvedSessions.map((session) => ({
					...session,
					active: session.id === sessionId,
				}));
			}

			return [
				...resolvedSessions.map((session) => ({
					...session,
					active: false,
				})),
				optimisticSession,
			];
		},
	);
	queryClient.setQueryData(
		[...helmorQueryKeys.sessionMessages(sessionId), "thread"],
		[],
	);

	return optimisticSession;
}
