import type React from "react";
import type {
	CommitButtonState,
	WorkspaceCommitButtonMode,
} from "@/features/commit/button";
import type {
	ChangeRequestInfo,
	ForgeActionStatus,
	ForgeDetection,
} from "@/lib/api";
import type { DiffOpenOptions } from "@/lib/editor-session";

/** The three physical states of the Pi AI surface within a goal context. */
export type GoalPiPhysicalState = "panel" | "dock" | "sheet";

/** The six view tabs available on the goal board. */
export type GoalTabView =
	| "board"
	| "changes"
	| "comments"
	| "team"
	| "timeline"
	| "terminal"
	| "branch-tree"
	| "knowledge";

export type GoalAiSurfaceContext = {
	workspaceId: string;
	goalTitle: string | null;
	goalDescription: string | null;
	kanbanSnapshot: string;
	canCreateCards: boolean;
};

export type GoalAiSurfaceProps = GoalAiSurfaceContext & {
	onClose: () => void;
	onSendingWorkspacesChange?: (workspaceIds: Set<string>) => void;
};

export type GoalWorkspaceContainerProps = {
	workspaceId: string;
	headerLeading?: React.ReactNode;
	onSelectWorkspace?: (workspaceId: string) => void;
	onSelectWorkspaceSession?: (workspaceId: string, sessionId: string) => void;
	activeEditorPath?: string | null;
	onOpenEditorFile?: (path: string, options?: DiffOpenOptions) => void;
	renderAiSurface?: (props: GoalAiSurfaceProps) => React.ReactNode;
	/** Called whenever the Pi AI agent starts or stops streaming. Propagates
	 *  the goal workspace ID in/out of the app-level sendingWorkspaceIds set
	 *  so the sidebar folder ring stays in sync. */
	onSendingWorkspacesChange?: (workspaceIds: Set<string>) => void;
	/** Opens the repository / app settings dialog. Forwarded to the Terminal
	 *  tab's Setup / Run / Archive sections so the user can configure scripts
	 *  without leaving the goal view. */
	onOpenSettings?: () => void;
	commitButtonMode?: WorkspaceCommitButtonMode;
	commitButtonState?: CommitButtonState;
	changeRequest?: ChangeRequestInfo | null;
	forgeDetection?: ForgeDetection | null;
	forgeRemoteState?: ForgeActionStatus["remoteState"] | null;
	forgeIsRefreshing?: boolean;
	hasGitChanges?: boolean;
	onCommitAction?: (mode: WorkspaceCommitButtonMode) => Promise<void>;
	onOpenChangeRequest?: () => void;
	onRefreshPrStatus?: () => Promise<void>;
};
