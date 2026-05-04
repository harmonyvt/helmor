export type WebPage = "list" | "chat";

export interface WebShellProps {
	selectedWorkspaceId: string | null;
	selectedSessionId: string | null;
	onWorkspaceSelect: (id: string) => void;
	onSessionSelect: (id: string | null, options?: { replace?: boolean }) => void;
	onBackToList: () => void;
}
