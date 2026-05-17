#!/usr/bin/env node
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

const targets = {
	codex: {
		source: path.join(repoRoot, ".codex", "skills"),
		destination: path.join(homedir(), ".codex", "skills"),
	},
	claude: {
		source: path.join(repoRoot, ".claude", "skills"),
		destination: path.join(
			process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"),
			"skills",
		),
	},
	agents: {
		source: path.join(repoRoot, ".agents", "skills"),
		destination: path.join(homedir(), ".agents", "skills"),
	},
};

const args = process.argv.slice(2);
let target = "all";
let dryRun = false;

for (let i = 0; i < args.length; i += 1) {
	const arg = args[i];
	if (arg === "--target") {
		target = args[++i] ?? "";
	} else if (arg.startsWith("--target=")) {
		target = arg.slice("--target=".length);
	} else if (arg === "--dry-run") {
		dryRun = true;
	} else if (arg === "-h" || arg === "--help") {
		printHelp();
		process.exit(0);
	} else {
		throw new Error(`Unknown argument: ${arg}`);
	}
}

if (!["all", ...Object.keys(targets)].includes(target)) {
	throw new Error(`Invalid --target ${JSON.stringify(target)}`);
}

const selectedTargets = target === "all" ? Object.keys(targets) : [target];
const operations = [];

for (const selected of selectedTargets) {
	const config = targets[selected];
	const skills = await findHelmorSkills(config.source);
	for (const skill of skills) {
		const destination = path.join(config.destination, path.basename(skill));
		operations.push({
			target: selected,
			skill: path.basename(skill),
			source: skill,
			destination,
		});
		if (!dryRun) {
			await mkdir(config.destination, { recursive: true });
			await rm(destination, { recursive: true, force: true });
			await cp(skill, destination, { recursive: true, dereference: true });
		}
	}
}

for (const op of operations) {
	const verb = dryRun ? "would export" : "exported";
	console.log(`${verb}\t${op.target}\t${op.skill}\t${op.destination}`);
}

if (operations.length === 0) {
	console.log("No Helmor skills found to export.");
}

async function findHelmorSkills(root) {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		const skills = [];
		for (const entry of entries) {
			if (!entry.name.startsWith("helmor-")) continue;
			const source = path.join(root, entry.name);
			const info = await stat(source);
			if (!info.isDirectory()) continue;
			try {
				const skillFile = await stat(path.join(source, "SKILL.md"));
				if (skillFile.isFile()) skills.push(source);
			} catch {
				// Ignore folders that are not skill roots.
			}
		}
		return skills.sort();
	} catch (error) {
		if (error && error.code === "ENOENT") return [];
		throw error;
	}
}

function printHelp() {
	console.log(`Usage: node scripts/export-skills.mjs [--target all|codex|claude|agents] [--dry-run]

Export repo-bundled Helmor skills to local agent skill directories.`);
}
