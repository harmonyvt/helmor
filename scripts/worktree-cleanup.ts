import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
	derivePreviewIdentity,
	PREVIEW_DATA_DIR_NAME,
	resolveGitWorktreeRoot,
} from "./dev-preview.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CleanupOptions = {
	targetPath: string | null;
	force: boolean;
	includeTarget: boolean;
	dryRun: boolean;
};

type ArtifactCandidate = {
	label: string;
	fullPath: string;
	optional?: boolean;
};

type ArtifactEntry = ArtifactCandidate & {
	exists: boolean;
};

type WorktreeEntry = {
	path: string;
	isMain: boolean;
};

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function parseWorktreeList(raw: string): WorktreeEntry[] {
	const entries: WorktreeEntry[] = [];
	let current: Partial<WorktreeEntry> | null = null;

	for (const line of raw.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (current?.path) {
				entries.push(current as WorktreeEntry);
			}
			current = { path: line.slice("worktree ".length).trim(), isMain: false };
		} else if (line === "bare" || line.startsWith("HEAD ")) {
			// main worktree has no "branch" line for detached HEAD, but always comes first
		} else if (line === "" && current) {
			if (entries.length === 0) {
				// First entry is always the main worktree
				(current as WorktreeEntry).isMain = true;
			}
			entries.push(current as WorktreeEntry);
			current = null;
		}
	}

	if (current?.path) {
		if (entries.length === 0) {
			(current as WorktreeEntry).isMain = true;
		}
		entries.push(current as WorktreeEntry);
	}

	return entries;
}

function getWorktreeList(cwd: string): WorktreeEntry[] {
	const raw = execSync("git worktree list --porcelain", {
		cwd,
		encoding: "utf8",
	});
	return parseWorktreeList(raw);
}

function getMainWorktreeRoot(cwd: string): string {
	const entries = getWorktreeList(cwd);
	const main = entries.find((e) => e.isMain);
	if (!main) {
		throw new Error("Could not determine main worktree root from git");
	}
	return main.path;
}

// ---------------------------------------------------------------------------
// Artifact discovery
// ---------------------------------------------------------------------------

function discoverArtifacts(
	worktreeRoot: string,
	includeTarget: boolean,
): ArtifactEntry[] {
	const entries: ArtifactCandidate[] = [
		{
			label: "node_modules/",
			fullPath: path.join(worktreeRoot, "node_modules"),
		},
		{
			label: "sidecar/node_modules/",
			fullPath: path.join(worktreeRoot, "sidecar", "node_modules"),
		},
		{ label: "dist/", fullPath: path.join(worktreeRoot, "dist") },
		{
			label: "sidecar/dist/",
			fullPath: path.join(worktreeRoot, "sidecar", "dist"),
		},
		{
			label: "src-tauri/target/",
			fullPath: path.join(worktreeRoot, "src-tauri", "target"),
			optional: true,
		},
	];

	const identity = derivePreviewIdentity(worktreeRoot);
	entries.push({
		label: `~/${PREVIEW_DATA_DIR_NAME}/${identity.key}/`,
		fullPath: identity.dataDir,
		optional: true,
	});

	return entries
		.filter(
			(e) => !e.optional || includeTarget || e.fullPath === identity.dataDir,
		)
		.map((e) => ({ ...e, exists: existsSync(e.fullPath) }));
}

// ---------------------------------------------------------------------------
// Prompt helper
// ---------------------------------------------------------------------------

function prompt(question: string): Promise<string> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
	const opts = parseArgs(argv);

	// Resolve the worktree root we're cleaning up
	const rawTarget = opts.targetPath ?? process.cwd();
	const worktreeRoot = await resolveGitWorktreeRoot(rawTarget).catch(() => {
		throw new Error(`Not inside a git repository: ${rawTarget}`);
	});

	// Find the main repo root so we can run git worktree remove from there
	const mainRoot = getMainWorktreeRoot(worktreeRoot);

	if (path.resolve(worktreeRoot) === path.resolve(mainRoot)) {
		throw new Error(
			`Refusing to clean up the main worktree at ${mainRoot}.\n` +
				"Only linked worktrees can be removed with this script.",
		);
	}

	const artifacts = discoverArtifacts(worktreeRoot, opts.includeTarget);
	const existing = artifacts.filter((a) => a.exists);

	console.log("\nHelmor worktree cleanup");
	console.log(`  Worktree: ${worktreeRoot}`);
	console.log(`  Main repo: ${mainRoot}`);
	console.log("");

	if (existing.length === 0) {
		console.log("  No build artifacts or node_modules found.");
	} else {
		console.log("  Artifacts to remove:");
		for (const a of existing) {
			console.log(`    • ${a.label}`);
		}
	}
	console.log(`    • git worktree remove (deregisters + deletes folder)`);
	console.log("");

	if (opts.dryRun) {
		console.log("Dry run — nothing deleted.");
		return;
	}

	if (!opts.force) {
		const answer = await prompt("Proceed? [y/N] ");
		if (answer.toLowerCase() !== "y") {
			console.log("Aborted.");
			process.exit(0);
		}
	}

	// Delete artifacts
	for (const a of existing) {
		process.stdout.write(`  Removing ${a.label}... `);
		rmSync(a.fullPath, { recursive: true, force: true });
		console.log("done");
	}

	// Remove the git worktree (deregisters + deletes the directory)
	process.stdout.write("  Running git worktree remove... ");
	execSync(`git worktree remove --force "${worktreeRoot}"`, {
		cwd: mainRoot,
		stdio: "pipe",
	});
	console.log("done");

	console.log("\nWorktree cleaned up successfully.");
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): CleanupOptions {
	const opts: CleanupOptions = {
		targetPath: null,
		force: false,
		includeTarget: false,
		dryRun: false,
	};

	for (const arg of argv) {
		if (arg === "--force" || arg === "-f") {
			opts.force = true;
		} else if (arg === "--include-target") {
			opts.includeTarget = true;
		} else if (arg === "--dry-run") {
			opts.dryRun = true;
		} else if (!arg.startsWith("-")) {
			opts.targetPath = arg;
		} else {
			console.error(`Unknown flag: ${arg}`);
			printUsage();
			process.exit(1);
		}
	}

	return opts;
}

function printUsage(): void {
	console.log(
		[
			"",
			"Usage: bun run worktree:cleanup [path] [flags]",
			"",
			"  path               Worktree to clean (default: current directory)",
			"",
			"  --force, -f        Skip confirmation prompt",
			"  --include-target   Also remove src-tauri/target/ (Rust build cache, ~GB)",
			"  --dry-run          Show what would be deleted without deleting anything",
			"",
			"Examples:",
			"  bun run worktree:cleanup",
			"  bun run worktree:cleanup ../my-feature-branch --force",
			"  bun run worktree:cleanup --dry-run",
			"  bun run worktree:cleanup --include-target --force",
			"",
		].join("\n"),
	);
}

function isMainModule(): boolean {
	const entrypoint = process.argv[1];
	if (!entrypoint) return false;
	return path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
