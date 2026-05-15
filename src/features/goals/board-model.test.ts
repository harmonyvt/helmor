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
			workspace({
				id: "ws-merged",
				title: "Merged card",
				status: "done",
				prSyncState: "merged",
			}),
		]);

		expect(grouped.get("backlog")?.map((item) => item.id)).toEqual([
			"ws-backlog",
		]);
		expect(grouped.get("review")?.map((item) => item.id)).toEqual([
			"ws-review",
		]);
		expect(grouped.get("done")).toEqual([]);
		expect(grouped.get("merged")?.map((item) => item.id)).toEqual([
			"ws-merged",
		]);
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
			workspace({
				id: "ws-merged",
				title: "Merged work",
				status: "done",
				branch: "goal/merged",
				prUrl: "https://example.com/pr/2",
				prSyncState: "merged",
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
			{
				id: "ws-merged",
				title: "Merged work",
				lane: "merged",
				branch: "goal/merged",
				prUrl: "https://example.com/pr/2",
				prSyncState: "merged",
				sessionCount: 0,
			},
		]);
	});
});
