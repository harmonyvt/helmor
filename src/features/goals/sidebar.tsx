import type { AssigneeSummary, WorkspaceDetail } from "@/lib/api";
import { GoalsAiPanel } from "./ai-panel";

type GoalSidebarProps = {
	workspaceId: string;
	cards: WorkspaceDetail[];
	kanbanSnapshot: string;
	goalTitle: string | null;
	goalDescription: string | null;
	canCreateCards: boolean;
	assignees: AssigneeSummary[];
	onSendingWorkspacesChange?: (ids: Set<string>) => void;
	onCardCreated?: (ws: WorkspaceDetail) => void;
	onSelectAssignee?: (ws: WorkspaceDetail) => void;
};

export function GoalSidebar({
	workspaceId,
	cards,
	kanbanSnapshot,
	goalTitle,
	goalDescription,
	canCreateCards,
	assignees,
	onSendingWorkspacesChange,
	onCardCreated,
	onSelectAssignee,
}: GoalSidebarProps) {
	return (
		<div className="flex h-full w-[300px] shrink-0 flex-col border-r border-border/60 bg-sidebar">
			{/* Pi conversation — takes all remaining height */}
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<GoalsAiPanel
					workspaceId={workspaceId}
					cards={cards}
					kanbanSnapshot={kanbanSnapshot}
					goalTitle={goalTitle}
					goalDescription={goalDescription}
					canCreateCards={canCreateCards}
					onClose={() => {}}
					onCardCreated={onCardCreated}
					onSendingWorkspacesChange={onSendingWorkspacesChange}
					assignees={assignees}
					onSelectAssignee={onSelectAssignee}
				/>
			</div>
		</div>
	);
}
