import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	normalizeKanbanContextCards,
	writeKanbanContext,
} from "./pi-kanban-context-writer.js";

type BeforeAgentStartHandler = (
	event: { systemPrompt: string },
	ctx: { cwd: string },
) => Promise<{ systemPrompt?: string }>;

async function loadGeneratedSystemPrompt(cwd: string): Promise<string> {
	const extensionPath = join(cwd, ".pi", "extensions", "helmor-kanban.ts");
	const extensionModule = (await import(
		`${extensionPath}?t=${Date.now()}`
	)) as {
		default: (pi: {
			on: (event: string, handler: BeforeAgentStartHandler) => void;
			registerCommand: () => void;
		}) => void;
	};

	let beforeAgentStart: BeforeAgentStartHandler | undefined;
	extensionModule.default({
		on(event, handler) {
			if (event === "before_agent_start") beforeAgentStart = handler;
		},
		registerCommand() {},
	});

	const result = await beforeAgentStart?.(
		{ systemPrompt: "Base prompt" },
		{ cwd },
	);
	return result?.systemPrompt ?? "";
}

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
					assigneeName: "Mina",
					activeSessionStatus: "running",
					activeSessionAgentType: "codex",
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
				assigneeName: "Mina",
				activeSessionStatus: "running",
				activeSessionAgentType: "codex",
			},
		]);
		expect(meta).toEqual({
			title: "Launch Goals",
			description: "Coordinate the release",
		});
		expect(extension).toContain("Each card is a child workspace");
		expect(extension).toContain("## Goal Orchestration Role");
		expect(extension).toContain("## Goal Board Tools");
		expect(extension).toContain("create_kanban_card with a clear prompt");
		expect(extension).toContain("inspect_workspace_merge_state(card_id)");
		expect(extension).toContain("mark_workspace_landed(card_id)");

		const systemPrompt = await loadGeneratedSystemPrompt(cwd);
		expect(systemPrompt).toContain(
			"- [workspace:workspace-3] Ship goals board [assignee: Mina] [active: running/codex]",
		);
	});

	test("injects explicit guidance when the board is empty", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "helmor-pi-empty-context-"));

		await writeKanbanContext(cwd, []);

		const systemPrompt = await loadGeneratedSystemPrompt(cwd);
		expect(systemPrompt).toContain("## Kanban Board");
		expect(systemPrompt).toContain("The board is currently empty.");
		expect(systemPrompt).toContain(
			"use create_kanban_card to create child workspace cards",
		);
	});
});
