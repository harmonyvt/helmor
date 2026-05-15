import { skipToken, useQuery } from "@tanstack/react-query";
import type {
	CommitButtonState,
	WorkspaceCommitButtonMode,
} from "@/features/commit/button";
import type { PendingPromptForSession } from "@/features/commit/hooks/use-commit-lifecycle";
import { WorkspaceConversationContainer } from "@/features/conversation";
import { ActionsSection } from "@/features/inspector/sections/actions";
import { ChangesSection } from "@/features/inspector/sections/changes";
import type { ChangeRequestInfo, WorkspaceDetail } from "@/lib/api";
import { listWorkspaceChangesWithContent } from "@/lib/api";
import type { DiffOpenOptions } from "@/lib/editor-session";
import { helmorQueryKeys } from "@/lib/query-client";

const EMPTY_FLASHING = new Set<string>();

export function ThreadTab({
	workspace,
	onOpen,
	selectedSessionId,
	displayedSessionId,
	onSelectSession,
	onResolveDisplayedSession,
	onSendingSessionsChange,
	onInteractionSessionsChange,
	onSessionCompleted,
	onSessionAborted,
	pendingPromptForSession,
	onPendingPromptConsumed,
}: {
	workspace: WorkspaceDetail;
	onOpen?: () => void;
	selectedSessionId: string | null;
	displayedSessionId: string | null;
	onSelectSession: (id: string | null) => void;
	onResolveDisplayedSession: (id: string | null) => void;
	onSendingSessionsChange: (ids: Set<string>) => void;
	onInteractionSessionsChange: (
		sessionWorkspaceMap: Map<string, string>,
		interactionCounts: Map<string, number>,
	) => void;
	onSessionCompleted: (sessionId: string, workspaceId: string) => void;
	onSessionAborted: (sessionId: string, workspaceId: string) => void;
	pendingPromptForSession: PendingPromptForSession | null;
	onPendingPromptConsumed: (pendingSendId?: string | null) => void;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<WorkspaceConversationContainer
				selectedWorkspaceId={workspace.id}
				displayedWorkspaceId={workspace.id}
				selectedSessionId={selectedSessionId}
				displayedSessionId={displayedSessionId}
				repoId={workspace.repoId}
				onSelectSession={onSelectSession}
				onResolveDisplayedSession={onResolveDisplayedSession}
				onSendingSessionsChange={onSendingSessionsChange}
				onInteractionSessionsChange={onInteractionSessionsChange}
				onSessionCompleted={onSessionCompleted}
				onSessionAborted={onSessionAborted}
				pendingPromptForSession={pendingPromptForSession}
				onPendingPromptConsumed={onPendingPromptConsumed}
				workspaceRootPath={workspace.rootPath ?? null}
				compact
				headerLeading={
					onOpen ? (
						<button
							type="button"
							onClick={onOpen}
							className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
						>
							Open workspace ↗
						</button>
					) : null
				}
			/>
		</div>
	);
}

export function ChangesTab({
	workspace,
	activeEditorPath,
	onOpenEditorFile,
	onCommitAction,
	commitButtonMode,
	commitButtonState,
	changeRequest,
	forgeIsRefreshing,
}: {
	workspace: WorkspaceDetail;
	activeEditorPath?: string | null;
	onOpenEditorFile?: (path: string, options?: DiffOpenOptions) => void;
	onCommitAction: (mode: WorkspaceCommitButtonMode) => Promise<void>;
	commitButtonMode: WorkspaceCommitButtonMode;
	commitButtonState: CommitButtonState;
	changeRequest: ChangeRequestInfo | null;
	forgeIsRefreshing: boolean;
}) {
	const rootPath = workspace.rootPath ?? null;
	const changesQuery = useQuery({
		queryKey: helmorQueryKeys.workspaceChanges(rootPath ?? "__none__"),
		queryFn: rootPath
			? () => listWorkspaceChangesWithContent(rootPath)
			: skipToken,
		staleTime: 5_000,
	});

	if (!workspace.rootPath) {
		return (
			<div className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">
				Workspace not yet initialised
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<ChangesSection
				workspaceId={workspace.id}
				workspaceRootPath={workspace.rootPath}
				workspaceTargetBranch={workspace.intendedTargetBranch ?? null}
				changes={changesQuery.data?.items ?? []}
				editorMode={false}
				activeEditorPath={activeEditorPath ?? null}
				onOpenEditorFile={onOpenEditorFile ?? (() => {})}
				flashingPaths={EMPTY_FLASHING}
				onCommitAction={onCommitAction}
				commitButtonMode={commitButtonMode}
				commitButtonState={commitButtonState}
				changeRequest={changeRequest}
				forgeIsRefreshing={forgeIsRefreshing}
			/>
		</div>
	);
}

export function ActionsTab({
	workspace,
	onCommitAction,
	commitButtonMode,
	commitButtonState,
	changeRequest,
}: {
	workspace: WorkspaceDetail;
	onCommitAction: (mode: WorkspaceCommitButtonMode) => Promise<void>;
	commitButtonMode: WorkspaceCommitButtonMode;
	commitButtonState: CommitButtonState;
	changeRequest: ChangeRequestInfo | null;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<ActionsSection
				workspaceId={workspace.id}
				repoId={workspace.repoId}
				workspaceRemote={workspace.remote ?? null}
				workspaceState={workspace.state ?? null}
				bodyHeight={500}
				expanded={true}
				onCommitAction={onCommitAction}
				commitButtonMode={commitButtonMode}
				commitButtonState={commitButtonState}
				changeRequest={changeRequest}
			/>
		</div>
	);
}
