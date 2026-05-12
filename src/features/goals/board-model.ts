import type { WorkspaceDetail, WorkspaceStatus } from "@/lib/api";

export type GoalLaneDefinition = {
	id: WorkspaceStatus;
	label: string;
	color: string;
};

export const GOAL_LANES: GoalLaneDefinition[] = [
	{ id: "backlog", label: "Backlog", color: "#848f92" },
	{ id: "in-progress", label: "In progress", color: "#508a5a" },
	{ id: "review", label: "In review", color: "#a09040" },
	{ id: "done", label: "Done", color: "#4a8ab0" },
	{ id: "canceled", label: "Canceled", color: "#a86868" },
];

export type GoalKanbanSnapshotItem = {
	id: string;
	title: string;
	lane: WorkspaceStatus;
	branch?: string | null;
	prUrl?: string | null;
	sessionCount: number;
	activeSessionId?: string | null;
	activeSessionStatus?: string | null;
	activeSessionAgentType?: string | null;
	assigneeName?: string | null;
};

export function groupGoalChildWorkspacesByLane(
	workspaces: WorkspaceDetail[],
): Map<WorkspaceStatus, WorkspaceDetail[]> {
	const grouped = new Map<WorkspaceStatus, WorkspaceDetail[]>();
	for (const lane of GOAL_LANES) grouped.set(lane.id, []);
	for (const workspace of workspaces) {
		const lane = grouped.has(workspace.status) ? workspace.status : "backlog";
		grouped.get(lane)?.push(workspace);
	}
	return grouped;
}

export function createGoalKanbanSnapshot(
	workspaces: WorkspaceDetail[],
): string {
	const snapshot: GoalKanbanSnapshotItem[] = workspaces.map((workspace) => ({
		id: workspace.id,
		title: workspace.title,
		lane: workspace.status,
		branch: workspace.branch,
		prUrl: workspace.prUrl,
		sessionCount: workspace.sessionCount,
		activeSessionId: workspace.activeSessionId,
		activeSessionStatus: workspace.activeSessionStatus,
		activeSessionAgentType: workspace.activeSessionAgentType,
		assigneeName: workspace.activeSessionAgentType,
	}));

	return JSON.stringify(snapshot);
}
