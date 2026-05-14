import type React from "react";

/** The three physical states of the Pi AI surface within a goal context. */
export type GoalPiPhysicalState = "panel" | "dock" | "sheet";

/** The four view tabs available on the goal board. */
export type GoalTabView = "board" | "changes" | "team" | "timeline";

export type GoalAiSurfaceContext = {
	workspaceId: string;
	goalTitle: string | null;
	goalDescription: string | null;
	kanbanSnapshot: string;
	canCreateCards: boolean;
};

export type GoalAiSurfaceProps = GoalAiSurfaceContext & {
	onClose: () => void;
};

export type GoalWorkspaceContainerProps = {
	workspaceId: string;
	headerLeading?: React.ReactNode;
	onSelectWorkspace?: (workspaceId: string) => void;
	onSelectWorkspaceSession?: (workspaceId: string, sessionId: string) => void;
	renderAiSurface?: (props: GoalAiSurfaceProps) => React.ReactNode;
};
