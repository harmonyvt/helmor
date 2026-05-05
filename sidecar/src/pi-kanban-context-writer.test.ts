import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	normalizeKanbanContextCards,
	writeKanbanContext,
} from "./pi-kanban-context-writer.js";

describe("normalizeKanbanContextCards", () => {
	test("uses child workspace ids from current board snapshots", () => {
		expect(
			normalizeKanbanContextCards([
				{
					id: "workspace-1",
					title: "Build importer",
					lane: "in-progress",
					description: "Wire the CSV flow",
					branch: "feature/importer",
					prUrl: null,
					sessionCount: 2,
				},
			]),
		).toEqual([
			{
				id: "workspace-1",
				title: "Build importer",
				lane: "in-progress",
				description: "Wire the CSV flow",
				branch: "feature/importer",
				prUrl: null,
				sessionCount: 2,
			},
		]);
	});

	test("maps legacy GoalCard-like snapshots to child workspace cards", () => {
		expect(
			normalizeKanbanContextCards([
				{
					id: "legacy-card-1",
					childWorkspaceId: "workspace-2",
					title: "Review auth",
					status: "done",
					branchName: "review/auth",
				},
				{ id: "card-without-child", title: "Fallback card", lane: "backlog" },
				null,
			]),
		).toEqual([
			{
				id: "workspace-2",
				title: "Review auth",
				lane: "done",
				description: undefined,
				branch: "review/auth",
				prUrl: undefined,
				sessionCount: undefined,
			},
			{
				id: "card-without-child",
				title: "Fallback card",
				lane: "backlog",
				description: undefined,
				branch: undefined,
				prUrl: undefined,
				sessionCount: undefined,
			},
		]);
	});
});

describe("writeKanbanContext", () => {
	test("writes normalized child workspace board context and goal metadata", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "helmor-pi-context-"));

		await writeKanbanContext(
			cwd,
			[
				{
					id: "legacy-card-1",
					childWorkspaceId: "workspace-3",
					title: "Ship goals board",
					lane: "review",
				},
			],
			{ title: "Launch Goals", description: "Coordinate the release" },
		);

		const board = JSON.parse(
			await readFile(join(cwd, ".pi", "context", "kanban.json"), "utf8"),
		);
		const meta = JSON.parse(
			await readFile(join(cwd, ".pi", "context", "goal-meta.json"), "utf8"),
		);
		const extension = await readFile(
			join(cwd, ".pi", "extensions", "helmor-kanban.ts"),
			"utf8",
		);

		expect(board).toEqual([
			{
				id: "workspace-3",
				title: "Ship goals board",
				lane: "review",
			},
		]);
		expect(meta).toEqual({
			title: "Launch Goals",
			description: "Coordinate the release",
		});
		expect(extension).toContain("Each card is a child workspace");
	});
});
