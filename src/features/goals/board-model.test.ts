import { describe, expect, it } from "vitest";
import type { WorkspaceDetail } from "@/lib/api";
import {
	createGoalKanbanSnapshot,
	groupGoalChildWorkspacesByLane,
} from "./board-model";

function workspace(
	overrides: Partial<WorkspaceDetail> & Pick<WorkspaceDetail, "id" | "title">,
): WorkspaceDetail {
	return {
		...overrides,
		id: overrides.id,
		title: overrides.title,
		repoId: "repo-1",
		repoName: "Repo",
		directoryName: overrides.directoryName ?? overrides.id,
		state: "ready",
		mode: "worktree",
		hasUnread: false,
		workspaceUnread: 0,
		unreadSessionCount: 0,
		status: overrides.status ?? "backlog",
		sessionCount: overrides.sessionCount ?? 0,
		messageCount: 0,
	};
}

describe("goal board model", () => {
	it("groups child workspaces by workspace status lanes", () => {
		const grouped = groupGoalChildWorkspacesByLane([
			workspace({ id: "ws-backlog", title: "Backlog card" }),
			workspace({ id: "ws-review", title: "Review card", status: "review" }),
		]);

		expect(grouped.get("backlog")?.map((item) => item.id)).toEqual([
			"ws-backlog",
		]);
		expect(grouped.get("review")?.map((item) => item.id)).toEqual([
			"ws-review",
		]);
		expect(grouped.get("done")).toEqual([]);
	});

	it("serializes kanban snapshots from child workspaces only", () => {
		const snapshot = createGoalKanbanSnapshot([
			workspace({
				id: "ws-1",
				title: "Implement auth",
				status: "in-progress",
				branch: "goal/auth",
				prUrl: "https://example.com/pr/1",
				sessionCount: 2,
			}),
		]);

		expect(JSON.parse(snapshot)).toEqual([
			{
				id: "ws-1",
				title: "Implement auth",
				lane: "in-progress",
				branch: "goal/auth",
				prUrl: "https://example.com/pr/1",
				sessionCount: 2,
			},
		]);
	});
});
