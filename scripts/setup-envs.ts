import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SetupPaths = {
	sourceRoot: string;
	workspaceRoot: string;
};

function main(): void {
	const paths = resolveSetupPaths();

	console.log("\nHelmor environment setup");
	console.log(`  Source: ${paths.sourceRoot}`);
	console.log(`  Workspace: ${paths.workspaceRoot}`);
	console.log("");

	syncWorkspaceSetupFiles(paths);
	runBunInstall(paths.workspaceRoot);
	setupCocoIndexCode(paths.workspaceRoot);

	console.log("\nEnvironment setup complete.");
}

function syncWorkspaceSetupFiles(paths: SetupPaths): void {
	copyEnvLocal(paths);
	copySidecarDist(paths);
}

function copyEnvLocal(paths: SetupPaths): void {
	const sourcePath = path.join(paths.sourceRoot, ".env.local");
	const targetPath = path.join(paths.workspaceRoot, ".env.local");

	if (!existsSync(sourcePath)) {
		console.log("  Skipping .env.local copy; source file does not exist.");
		return;
	}

	if (path.resolve(sourcePath) === path.resolve(targetPath)) {
		console.log("  .env.local already points at the workspace file.");
		return;
	}

	mkdirSync(path.dirname(targetPath), { recursive: true });
	copyFileSync(sourcePath, targetPath);
	console.log("  Copied .env.local into workspace.");
}

function copySidecarDist(paths: SetupPaths): void {
	const sourcePath = path.join(paths.sourceRoot, "sidecar", "dist");
	const targetPath = path.join(paths.workspaceRoot, "sidecar", "dist");

	if (!existsSync(sourcePath)) {
		console.log(
			"  Skipping sidecar/dist copy; source directory does not exist.",
		);
		return;
	}

	if (path.resolve(sourcePath) === path.resolve(targetPath)) {
		console.log("  sidecar/dist already points at the workspace directory.");
		return;
	}

	rmSync(targetPath, { recursive: true, force: true });
	mkdirSync(path.dirname(targetPath), { recursive: true });
	cpSync(sourcePath, targetPath, { recursive: true });
	console.log("  Copied sidecar/dist into workspace.");
}

function runBunInstall(workspaceRoot: string): void {
	console.log("  Installing workspace dependencies...");
	execFileSync("sfw", ["bun", "install"], {
		cwd: workspaceRoot,
		stdio: "inherit",
	});
}

function setupCocoIndexCode(repoRoot: string): void {
	if (!commandExists("ccc")) {
		throw new Error(
			"ccc is required to initialize /cc. Install it with: pipx install 'cocoindex-code[full]'",
		);
	}

	if (hasWorkspaceCocoIndexSettings(repoRoot)) {
		console.log("  /cc already initialized.");
	} else {
		console.log("  Initializing /cc index settings...");
		execFileSync("ccc", ["init", "--force"], {
			cwd: repoRoot,
			stdio: "inherit",
		});
	}

	console.log("  Refreshing /cc index...");
	execFileSync("ccc", ["index"], {
		cwd: repoRoot,
		stdio: "inherit",
	});
}

function hasWorkspaceCocoIndexSettings(repoRoot: string): boolean {
	return existsSync(path.join(repoRoot, ".cocoindex_code", "settings.yml"));
}

function resolveRepoRoot(): string {
	try {
		return execSync("git rev-parse --show-toplevel", {
			cwd: process.cwd(),
			encoding: "utf8",
		}).trim();
	} catch {
		return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	}
}

function resolveSetupPaths(): SetupPaths {
	const repoRoot = resolveRepoRoot();
	return {
		sourceRoot: resolveEnvPath("HELMOR_ROOT_PATH") ?? repoRoot,
		workspaceRoot: resolveEnvPath("HELMOR_WORKSPACE_PATH") ?? repoRoot,
	};
}

function resolveEnvPath(name: string): string | null {
	const value = process.env[name]?.trim();
	return value ? path.resolve(value) : null;
}

function commandExists(command: string): boolean {
	try {
		execFileSync(command, ["--help"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`\nsetup:envs failed: ${message}`);
	process.exit(1);
}
