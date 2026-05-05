import type React from "react";

export type GoalAiSurfaceContext = {
	workspaceId: string;
	goalTitle: string | null;
	goalDescription: string | null;
	kanbanSnapshot: string;
};

export type GoalAiSurfaceProps = GoalAiSurfaceContext & {
	onClose: () => void;
};

export type GoalWorkspaceContainerProps = {
	workspaceId: string;
	headerLeading?: React.ReactNode;
	onSelectWorkspace?: (workspaceId: string) => void;
	renderAiSurface?: (props: GoalAiSurfaceProps) => React.ReactNode;
};
