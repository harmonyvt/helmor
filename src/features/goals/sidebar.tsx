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
	width: number;
	hitArea: number;
	minWidth: number;
	maxWidth: number;
	onResizeStart: (event: { clientX: number; preventDefault(): void }) => void;
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
	width,
	hitArea,
	minWidth,
	maxWidth,
	onResizeStart,
}: GoalSidebarProps) {
	return (
		<div
			className="relative flex h-full shrink-0 flex-col border-r border-border/60 bg-sidebar"
			style={{ width }}
		>
			{/* Resize handle on the right edge */}
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize AI panel"
				aria-valuemin={minWidth}
				aria-valuemax={maxWidth}
				aria-valuenow={width}
				tabIndex={0}
				onMouseDown={onResizeStart}
				className="absolute inset-y-0 z-30 cursor-ew-resize touch-none outline-none"
				style={{
					right: `${-(hitArea / 2)}px`,
					width: `${hitArea}px`,
				}}
			/>

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
