// Edits `~/.codex/config.toml` to enable Codex's experimental goals feature.
// The app-server `thread/goal/set` API errors when `[features] goals = true`
// is missing, and Codex reads this config once at process startup.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type EnableGoalsResult =
	| { kind: "alreadyEnabled"; path: string }
	| { kind: "modified"; path: string };

export function codexConfigPath(): string {
	const override = process.env.CODEX_HOME?.trim();
	const home =
		override && override.length > 0 ? override : join(homedir(), ".codex");
	return join(home, "config.toml");
}

export async function ensureCodexGoalsFeatureEnabled(
	path: string = codexConfigPath(),
): Promise<EnableGoalsResult> {
	let original: string | null = null;
	try {
		original = await readFile(path, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
	}

	const updated = injectGoalsFeature(original);
	if (updated === null) {
		return { kind: "alreadyEnabled", path };
	}

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, updated, "utf8");
	return { kind: "modified", path };
}

export function injectGoalsFeature(content: string | null): string | null {
	if (content === null || content === "") {
		return "[features]\ngoals = true\n";
	}

	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);

	let featuresStart = -1;
	for (let index = 0; index < lines.length; index++) {
		if ((lines[index] ?? "").trim() === "[features]") {
			featuresStart = index;
			break;
		}
	}

	if (featuresStart === -1) {
		const trailingNewline = /\r?\n$/.test(content);
		const sep = trailingNewline ? "" : eol;
		const blank = content.length === 0 ? "" : eol;
		return `${content}${sep}${blank}[features]${eol}goals = true${eol}`;
	}

	let goalsLine = -1;
	for (let index = featuresStart + 1; index < lines.length; index++) {
		const trimmed = (lines[index] ?? "").trim();
		if (trimmed.startsWith("[") && trimmed.endsWith("]")) break;
		const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*=/);
		if (keyMatch?.[1] === "goals") {
			goalsLine = index;
			break;
		}
	}

	if (goalsLine !== -1) {
		const existing = lines[goalsLine] ?? "";
		const value = existing.split("=").slice(1).join("=").trim();
		if (value === "true") return null;
		lines[goalsLine] = "goals = true";
		return lines.join(eol);
	}

	lines.splice(featuresStart + 1, 0, "goals = true");
	return lines.join(eol);
}
