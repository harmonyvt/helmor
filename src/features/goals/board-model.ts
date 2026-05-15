import type { PrSyncState, WorkspaceDetail, WorkspaceStatus } from "@/lib/api";

export type GoalLaneId = WorkspaceStatus | "merged";

export type GoalLaneDefinition = {
	id: GoalLaneId;
	label: string;
	color: string;
	emptyLabel: string;
	acceptsDrop: boolean;
};

export const GOAL_LANES: GoalLaneDefinition[] = [
	{
		id: "backlog",
		label: "Backlog",
		color: "#848f92",
		emptyLabel: "No cards",
		acceptsDrop: true,
	},
	{
		id: "in-progress",
		label: "In progress",
		color: "#508a5a",
		emptyLabel: "No active work",
		acceptsDrop: true,
	},
	{
		id: "review",
		label: "In review",
		color: "#a09040",
		emptyLabel: "Nothing to review",
		acceptsDrop: true,
	},
	{
		id: "done",
		label: "Done",
		color: "#4a8ab0",
		emptyLabel: "Nothing done yet",
		acceptsDrop: true,
	},
	{
		id: "merged",
		label: "Merged",
		color: "var(--workspace-pr-merged-accent)",
		emptyLabel: "No merged branches",
		acceptsDrop: false,
	},
	{
		id: "canceled",
		label: "Canceled",
		color: "#a86868",
		emptyLabel: "Nothing canceled",
		acceptsDrop: true,
	},
];

const WORKSPACE_STATUS_LANES = new Set<WorkspaceStatus>([
	"backlog",
	"in-progress",
	"review",
	"done",
	"canceled",
]);

export function isMovableGoalLaneId(laneId: string): laneId is WorkspaceStatus {
	return WORKSPACE_STATUS_LANES.has(laneId as WorkspaceStatus);
}

export function isMergedGoalWorkspace(
	workspace: Pick<WorkspaceDetail, "prSyncState">,
): boolean {
	return workspace.prSyncState === "merged";
}

/** A workspace can be merged when it has an open pull request. */
export function isWorkspaceMergeable(
	workspace: Pick<WorkspaceDetail, "prSyncState"> | null | undefined,
): boolean {
	return workspace?.prSyncState === "open";
}

export function goalLaneForWorkspace(
	workspace: Pick<WorkspaceDetail, "prSyncState" | "status">,
): GoalLaneId {
	if (isMergedGoalWorkspace(workspace)) return "merged";
	return isMovableGoalLaneId(workspace.status) ? workspace.status : "backlog";
}

export type GoalKanbanSnapshotItem = {
	id: string;
	title: string;
	lane: GoalLaneId;
	branch?: string | null;
	prUrl?: string | null;
	prSyncState?: PrSyncState | null;
	sessionCount: number;
	activeSessionId?: string | null;
	activeSessionStatus?: string | null;
	activeSessionAgentType?: string | null;
	assigneeName?: string | null;
};

export function groupGoalChildWorkspacesByLane(
	workspaces: WorkspaceDetail[],
): Map<GoalLaneId, WorkspaceDetail[]> {
	const grouped = new Map<GoalLaneId, WorkspaceDetail[]>();
	for (const lane of GOAL_LANES) grouped.set(lane.id, []);
	for (const workspace of workspaces) {
		const lane = goalLaneForWorkspace(workspace);
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
		lane: goalLaneForWorkspace(workspace),
		branch: workspace.branch,
		prUrl: workspace.prUrl,
		...(workspace.prSyncState && workspace.prSyncState !== "none"
			? { prSyncState: workspace.prSyncState }
			: {}),
		sessionCount: workspace.sessionCount,
		activeSessionId: workspace.activeSessionId,
		activeSessionStatus: workspace.activeSessionStatus,
		activeSessionAgentType: workspace.activeSessionAgentType,
		assigneeName: workspace.activeSessionAgentType,
	}));

	return JSON.stringify(snapshot);
}
