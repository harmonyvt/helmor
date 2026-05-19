import { useQuery } from "@tanstack/react-query";
import { History, ListTree, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { WorkspaceConversationContainer } from "@/features/conversation";
import type {
	AgentModelOption,
	AssigneeSummary,
	WorkspaceDetail,
	WorkspaceSessionSummary,
} from "@/lib/api";
import { agentModelSectionsQueryOptions } from "@/lib/query-client";
import { useSettings } from "@/lib/settings";
import { AssigneesBar } from "./assignees-bar";
import { HistoryView } from "./history-view";
import { ThreadManagerView } from "./thread-manager-view";

type GoalsAiPanelProps = {
	workspaceId: string;
	/** Child workspaces shown as kanban cards. */
	cards: WorkspaceDetail[];
	/** Pre-serialised snapshot passed to the Pi agent as context. */
	kanbanSnapshot: string;
	goalTitle?: string | null;
	goalDescription?: string | null;
	canCreateCards?: boolean;
	onClose: () => void;
	/** Called when Pi creates a workspace card so the parent can select it. */
	onCardCreated?: (ws: WorkspaceDetail) => void;
	/** Reports the set of workspace IDs currently streaming (the goal workspace
	 *  ID itself) so the sidebar folder ring stays in sync. */
	onSendingWorkspacesChange?: (workspaceIds: Set<string>) => void;
	/** Assignees to display in the collapsible bar above the composer. */
	assignees?: AssigneeSummary[];
	/** Called when the user clicks an assignee to navigate to its workspace. */
	onSelectAssignee?: (ws: WorkspaceDetail) => void;
};

const piOnlyModelFilter = (model: AgentModelOption) => model.provider === "pi";

function resolveFavouritePiModelId(
	piModels: readonly AgentModelOption[],
	favouriteModelIds: readonly string[],
): string | null {
	if (favouriteModelIds.length === 0) return null;
	const favouriteSet = new Set(favouriteModelIds);
	return piModels.find((model) => favouriteSet.has(model.id))?.id ?? null;
}

export function GoalsAiPanel({
	workspaceId,
	cards,
	kanbanSnapshot,
	goalTitle,
	goalDescription,
	onClose,
	onSendingWorkspacesChange,
	assignees,
	onSelectAssignee,
}: GoalsAiPanelProps) {
	const { settings } = useSettings();
	const modelSectionsQuery = useQuery(agentModelSectionsQueryOptions());
	const modelSections = useMemo(
		() => modelSectionsQuery.data ?? [],
		[modelSectionsQuery.data],
	);
	const piModels = useMemo(
		() => modelSections.find((section) => section.id === "pi")?.options ?? [],
		[modelSections],
	);
	const favouritePiModelId = useMemo(
		() => resolveFavouritePiModelId(piModels, settings.favoriteModelIds),
		[piModels, settings.favoriteModelIds],
	);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
		null,
	);
	const [displayedSessionId, setDisplayedSessionId] = useState<string | null>(
		null,
	);
	const [overlayMode, setOverlayMode] = useState<"history" | "threads" | null>(
		null,
	);

	// Reset session state when the workspace changes so stale session IDs from a
	// previously-viewed goal workspace don't bleed into the new one. Without this
	// reset, GoalWorkspaceContainer reuses the same component instance across
	// workspace switches (no key prop), which means selectedSessionId /
	// displayedSessionId kept pointing at the old workspace's Pi session. The
	// WorkspacePanelContainer then showed that stale session's messages (from
	// cache) with hasSession=false instead of showing the "no thread selected"
	// empty state or auto-resolving the new workspace's active session.
	useEffect(() => {
		setSelectedSessionId(null);
		setDisplayedSessionId(null);
		setOverlayMode(null);
	}, [workspaceId]);

	const handleSelectSession = useCallback((sessionId: string | null) => {
		setSelectedSessionId(sessionId);
		setDisplayedSessionId(sessionId);
	}, []);

	const handleResolveDisplayedSession = useCallback(
		(sessionId: string | null) => {
			setDisplayedSessionId(sessionId);
			setSelectedSessionId(sessionId);
		},
		[],
	);

	const handleRestoreSession = useCallback(
		(session: WorkspaceSessionSummary) => {
			handleSelectSession(session.id);
			setOverlayMode(null);
		},
		[handleSelectSession],
	);

	const handleNewSession = useCallback(() => {
		handleSelectSession(null);
		setOverlayMode(null);
	}, [handleSelectSession]);

	const handleOpenManagedThread = useCallback(
		(_card: WorkspaceDetail, session: WorkspaceSessionSummary) => {
			handleSelectSession(session.id);
			setOverlayMode(null);
		},
		[handleSelectSession],
	);

	const overlayTitle =
		overlayMode === "threads" ? "Card assignees" : "Conversations";

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<WorkspaceConversationContainer
				selectedWorkspaceId={workspaceId}
				displayedWorkspaceId={workspaceId}
				selectedSessionId={selectedSessionId}
				displayedSessionId={displayedSessionId}
				onSelectSession={handleSelectSession}
				onResolveDisplayedSession={handleResolveDisplayedSession}
				onSendingWorkspacesChange={onSendingWorkspacesChange}
				modelFilter={piOnlyModelFilter}
				preferredDefaultModelId={favouritePiModelId}
				buildSendRequestExtras={() => {
					return {
						kanbanWorkspaceId: workspaceId,
						kanbanSnapshot,
						goalTitle: goalTitle ?? null,
						goalDescription: goalDescription ?? null,
					};
				}}
				composerAccessory={
					assignees && assignees.length > 0 ? (
						<AssigneesBar
							assignees={assignees}
							cards={cards}
							onSelectAssignee={onSelectAssignee}
						/>
					) : undefined
				}
				compact
				headerLeading={
					<span className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground/70">
						Pi
					</span>
				}
				headerActions={
					<>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-7 cursor-pointer"
							onClick={() => setOverlayMode("threads")}
							aria-label="Manage card assignees"
						>
							<ListTree className="size-3.5" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-7 cursor-pointer"
							onClick={() => setOverlayMode("history")}
							aria-label="View conversation history"
						>
							<History className="size-3.5" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-7 cursor-pointer"
							onClick={onClose}
							aria-label="Close Pi panel"
						>
							<X className="size-3.5" />
						</Button>
					</>
				}
			/>
			{overlayMode && (
				<div className="absolute inset-0 z-10 flex flex-col bg-background">
					<div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
						<span className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground/70">
							{overlayTitle}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-7 cursor-pointer"
							onClick={() => setOverlayMode(null)}
							aria-label="Back to conversation"
						>
							<X className="size-3.5" />
						</Button>
					</div>
					{overlayMode === "threads" ? (
						<ThreadManagerView
							goalWorkspaceId={workspaceId}
							cards={cards}
							onOpenThread={handleOpenManagedThread}
						/>
					) : (
						<HistoryView
							workspaceId={workspaceId}
							activeSessionId={displayedSessionId}
							onRestore={handleRestoreSession}
							onNewSession={handleNewSession}
						/>
					)}
				</div>
			)}
		</div>
	);
}
