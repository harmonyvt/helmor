#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "src", "helmor_knowledge_sidecar", "main.py");
const dist = resolve(root, "dist");

if (!existsSync(entry)) {
	throw new Error(`[knowledge-sidecar] missing entrypoint: ${entry}`);
}

mkdirSync(dist, { recursive: true });

try {
	execFileSync("uv", ["--version"], { stdio: "pipe" });
} catch {
	throw new Error(
		"[knowledge-sidecar] uv is required to bundle the knowledge sidecar",
	);
}

execFileSync(
	"uv",
	[
		"run",
		"--project",
		root,
		"--group",
		"dev",
		"pyinstaller",
		"--clean",
		"--onefile",
		"--name",
		"helmor-knowledge-sidecar",
		"--distpath",
		dist,
		"--workpath",
		resolve(root, "build"),
		entry,
	],
	{ cwd: root, stdio: "inherit" },
);
