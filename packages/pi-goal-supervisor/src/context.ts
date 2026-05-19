import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeGoalSupervisorContext(
	cwd: string,
	snapshot: string | undefined,
	goal: { readonly title?: string; readonly description?: string },
): Promise<void> {
	const contextDir = join(cwd, ".pi", "context");
	await mkdir(contextDir, { recursive: true });
	await writeFile(
		join(contextDir, "kanban.json"),
		normalizeSnapshot(snapshot),
		"utf8",
	);
	await writeFile(
		join(contextDir, "APPEND_SYSTEM.md"),
		buildSystemPrompt(goal),
		"utf8",
	);
}

function normalizeSnapshot(snapshot: string | undefined): string {
	if (!snapshot) return "[]\n";
	try {
		const parsed = JSON.parse(snapshot);
		return `${JSON.stringify(Array.isArray(parsed) ? parsed : [], null, 2)}\n`;
	} catch {
		return "[]\n";
	}
}

function buildSystemPrompt(goal: {
	readonly title?: string;
	readonly description?: string;
}): string {
	const lines = [
		"You are Pi, the goal supervisor for this Helmor goal board.",
		"Turn the overarching goal into executable child workspaces, keep the board state accurate, coordinate assignee threads, and summarize the supervisor-level state for the user.",
		"Use the provided Goal tools instead of guessing from stale context. Treat card ids as child workspace ids.",
		"Do not move cards into merged directly; Helmor derives merged from landing state.",
	];
	if (goal.title?.trim()) lines.push(`Goal title: ${goal.title.trim()}`);
	if (goal.description?.trim()) {
		lines.push(`Goal description:\n${goal.description.trim()}`);
	}
	return `${lines.join("\n\n")}\n`;
}
