import WorkspaceChatPage from "../pages/workspace-chat-page";
import WorkspaceListPage from "../pages/workspace-list-page";
import type { WebShellProps } from "../types";

export default function TabletShell({
	selectedWorkspaceId,
	selectedSessionId,
	onWorkspaceSelect,
	onSessionSelect,
}: WebShellProps) {
	return (
		<div className="flex h-dvh overflow-hidden bg-background">
			{/* Left column — workspace list */}
			<div className="w-[260px] shrink-0 flex flex-col h-full overflow-hidden bg-sidebar border-r border-border">
				<WorkspaceListPage
					selectedWorkspaceId={selectedWorkspaceId}
					onWorkspaceSelect={onWorkspaceSelect}
					isTablet={true}
				/>
			</div>
			{/* Right column — chat panel */}
			<div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-background">
				<WorkspaceChatPage
					workspaceId={selectedWorkspaceId}
					sessionId={selectedSessionId}
					onSessionSelect={onSessionSelect}
				/>
			</div>
		</div>
	);
}
