import { memo, type ReactNode, useEffect } from "react";
import type {
	AgentProvider,
	ChangeRequestInfo,
	WorkspaceDetail,
	WorkspaceSessionSummary,
} from "@/lib/api";
import { HelmorProfiler } from "@/lib/dev-react-profiler";
import type { WorkspaceScriptType } from "@/lib/workspace-script-actions";
import { CompactThreadContext } from "./compact-thread-context";
import { WorkspacePanelHeader } from "./header";
import { EmptyState, preloadStreamdown } from "./message-components";
import {
	ActiveThreadViewport,
	ConversationColdPlaceholder,
	type PresentedSessionPane,
} from "./thread-viewport";
import type { SessionCloseRequest } from "./use-confirm-session-close";

export {
	AssistantToolCall,
	agentChildrenBlockPropsEqual,
	assistantToolCallPropsEqual,
} from "./message-components";

type WorkspacePanelProps = {
	workspace: WorkspaceDetail | null;
	changeRequest?: ChangeRequestInfo | null;
	sessions: WorkspaceSessionSummary[];
	selectedSessionId: string | null;
	sessionDisplayProviders?: Record<string, AgentProvider>;
	sessionPanes: PresentedSessionPane[];
	loadingWorkspace?: boolean;
	loadingSession?: boolean;
	refreshingWorkspace?: boolean;
	refreshingSession?: boolean;
	sending?: boolean;
	sendingSessionIds?: Set<string>;
	interactionRequiredSessionIds?: Set<string>;
	onSelectSession?: (sessionId: string) => void;
	onPrefetchSession?: (sessionId: string) => void;
	onSessionsChanged?: () => void;
	onSessionRenamed?: (sessionId: string, title: string) => void;
	onWorkspaceChanged?: () => void;
	onRequestCloseSession?: (request: SessionCloseRequest) => void;
	headerActions?: ReactNode;
	headerLeading?: ReactNode;
	newSessionShortcut?: string | null;
	missingScriptTypes?: WorkspaceScriptType[];
	onInitializeScript?: (scriptType: WorkspaceScriptType) => void;
	onFocusChildSession?: (sessionId: string) => void;
	activeSessionParentId?: string | null;
	/** Renders a compact single-row header with no branch or session tabs. */
	compact?: boolean;
};

export const WorkspacePanel = memo(function WorkspacePanel({
	workspace,
	changeRequest = null,
	sessions,
	selectedSessionId,
	sessionDisplayProviders,
	sessionPanes,
	loadingWorkspace = false,
	loadingSession = false,
	refreshingWorkspace: _refreshingWorkspace = false,
	refreshingSession: _refreshingSession = false,
	sending = false,
	sendingSessionIds,
	interactionRequiredSessionIds,
	onSelectSession,
	onPrefetchSession,
	onSessionsChanged,
	onSessionRenamed,
	onWorkspaceChanged,
	onRequestCloseSession,
	headerActions,
	headerLeading,
	newSessionShortcut,
	missingScriptTypes = [],
	onInitializeScript,
	onFocusChildSession,
	activeSessionParentId,
	compact = false,
}: WorkspacePanelProps) {
	const selectedSession =
		sessions.find((session) => session.id === selectedSessionId) ?? null;
	const activePane =
		sessionPanes.find((pane) => pane.presentationState === "presented") ??
		sessionPanes[0] ??
		null;

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const idleCallbackId =
			"requestIdleCallback" in window
				? window.requestIdleCallback(() => preloadStreamdown(), {
						timeout: 1200,
					})
				: null;
		const timeoutId =
			idleCallbackId === null
				? window.setTimeout(() => preloadStreamdown(), 180)
				: null;

		return () => {
			if (idleCallbackId !== null && "cancelIdleCallback" in window) {
				window.cancelIdleCallback(idleCallbackId);
			}
			if (timeoutId !== null) {
				window.clearTimeout(timeoutId);
			}
		};
	}, []);

	return (
		<HelmorProfiler id="WorkspacePanel">
			<div className="flex min-h-0 flex-1 flex-col bg-transparent">
				<WorkspacePanelHeader
					workspace={workspace}
					changeRequest={changeRequest}
					sessions={sessions}
					selectedSessionId={selectedSessionId}
					sessionDisplayProviders={sessionDisplayProviders}
					sending={sending}
					sendingSessionIds={sendingSessionIds}
					interactionRequiredSessionIds={interactionRequiredSessionIds}
					loadingWorkspace={loadingWorkspace}
					activeSessionParentId={activeSessionParentId}
					headerActions={headerActions}
					headerLeading={headerLeading}
					onSelectSession={onSelectSession}
					onPrefetchSession={onPrefetchSession}
					onSessionsChanged={onSessionsChanged}
					onSessionRenamed={onSessionRenamed}
					onWorkspaceChanged={onWorkspaceChanged}
					onRequestCloseSession={onRequestCloseSession}
					newSessionShortcut={newSessionShortcut}
					compact={compact}
				/>

				<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
					<CompactThreadContext.Provider value={compact}>
						{activePane?.hasLoaded ? (
							<ActiveThreadViewport
								hasSession={!!selectedSession}
								pane={activePane}
								workspaceBranch={workspace?.branch ?? null}
								workspacePrTitle={workspace?.prTitle ?? null}
								workspaceState={workspace?.state ?? null}
								missingScriptTypes={compact ? [] : missingScriptTypes}
								onInitializeScript={compact ? undefined : onInitializeScript}
								onFocusChildSession={onFocusChildSession}
								compact={compact}
							/>
						) : loadingWorkspace || loadingSession ? (
							<ConversationColdPlaceholder />
						) : (
							<div className="flex min-h-full flex-1 items-center justify-center px-8">
								<EmptyState
									workspaceState={workspace?.state ?? null}
									workspaceBranch={workspace?.branch ?? null}
									workspacePrTitle={workspace?.prTitle ?? null}
									hasSession={!!selectedSession}
									missingScriptTypes={compact ? [] : missingScriptTypes}
									onInitializeScript={compact ? undefined : onInitializeScript}
								/>
							</div>
						)}
					</CompactThreadContext.Provider>
				</div>
			</div>
		</HelmorProfiler>
	);
});
