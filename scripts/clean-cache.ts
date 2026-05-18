import { execFileSync, execSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CacheEntry = {
	label: string;
	relativePath: string;
};

type AbsoluteCacheEntry = {
	label: string;
	rootPath: string;
	relativePath: string;
	displayPath: string;
};

type ExistingCacheEntry = CacheEntry & {
	fullPath: string;
	type: "directory" | "file";
};

type CleanupCommand = {
	label: string;
	command: string[];
};

type CleanCacheOptions = {
	dryRun: boolean;
	includeDeps: boolean;
	includeGlobalCaches: boolean;
};

const COCOINDEX_PROJECT_CACHE_ENTRIES: CacheEntry[] = [
	{ label: "CocoIndex Code project index", relativePath: ".cocoindex_code" },
];

const BUILD_CACHE_ENTRIES: CacheEntry[] = [
	{ label: "Vite build output", relativePath: "dist" },
	{ label: "Vite SSR build output", relativePath: "dist-ssr" },
	{ label: "Vite cache", relativePath: ".vite" },
	{ label: "Root tool cache", relativePath: ".cache" },
	{ label: "Frontend coverage", relativePath: "coverage" },
	{ label: "Storybook build output", relativePath: "storybook-static" },
	{ label: "Playwright HTML report", relativePath: "playwright-report" },
	{ label: "Playwright test artifacts", relativePath: "test-results" },
	{ label: "TypeScript build info", relativePath: "tsconfig.tsbuildinfo" },
	{
		label: "Node TypeScript build info",
		relativePath: "tsconfig.node.tsbuildinfo",
	},
	{ label: "Rust/Tauri build cache", relativePath: "src-tauri/target" },
	{ label: "Sidecar compiled binary", relativePath: "sidecar/dist" },
	{
		label: "Knowledge sidecar compiled binary",
		relativePath: "knowledge-sidecar/dist",
	},
	{
		label: "Knowledge sidecar build cache",
		relativePath: "knowledge-sidecar/build",
	},
	{ label: "Sidecar bundled CLI cache", relativePath: "sidecar/.bundle-cache" },
	{ label: "Sidecar coverage", relativePath: "sidecar/coverage" },
	{
		label: "Marketing Next.js build output",
		relativePath: "apps/marketing/.next",
	},
	{ label: "Marketing static export", relativePath: "apps/marketing/out" },
	{ label: "Marketing build output", relativePath: "apps/marketing/dist" },
	{
		label: "Marketing TypeScript build info",
		relativePath: "apps/marketing/tsconfig.tsbuildinfo",
	},
];

const DEP_CACHE_ENTRIES: CacheEntry[] = [
	{ label: "Root Vite dependency cache", relativePath: "node_modules/.vite" },
	{ label: "Root dependency tool cache", relativePath: "node_modules/.cache" },
	{
		label: "Sidecar dependency tool cache",
		relativePath: "sidecar/node_modules/.cache",
	},
	{
		label: "Marketing dependency tool cache",
		relativePath: "apps/marketing/node_modules/.cache",
	},
];

function main(argv: string[]): void {
	const options = parseArgs(argv);
	const repoRoot = resolveRepoRoot();
	const entries = discoverExistingEntries(
		repoRoot,
		options.includeDeps,
		options.includeGlobalCaches,
	);
	const globalEntries = options.includeGlobalCaches
		? discoverGlobalCacheEntries()
		: [];
	const commands = options.includeGlobalCaches
		? discoverGlobalCacheCommands()
		: [];

	console.log("\nHelmor build cache cleanup");
	console.log(`  Repo: ${repoRoot}`);
	if (options.includeGlobalCaches) {
		console.log(`  Global cache root: ${homedir()}`);
	}
	console.log("");

	if (
		entries.length === 0 &&
		globalEntries.length === 0 &&
		commands.length === 0
	) {
		console.log("  No build cache artifacts found.");
		return;
	}

	if (entries.length > 0) {
		console.log("  Project artifacts to remove:");
		for (const entry of entries) {
			console.log(`    • ${entry.relativePath} (${entry.label})`);
		}
	}

	if (globalEntries.length > 0) {
		console.log("  Global cache artifacts to remove:");
		for (const entry of globalEntries) {
			console.log(`    • ${entry.relativePath} (${entry.label})`);
		}
	}

	if (commands.length > 0) {
		console.log("  Cache cleanup commands to run:");
		for (const command of commands) {
			console.log(`    • ${command.label}: ${command.command.join(" ")}`);
		}
	}

	if (options.includeGlobalCaches) {
		console.log(
			"\n  Note: global caches are shared by other repos and will be re-downloaded as needed.",
		);
	}
	console.log("");

	if (options.dryRun) {
		console.log("Dry run — nothing deleted.");
		return;
	}

	for (const command of commands) {
		runCleanupCommand(command);
	}

	for (const entry of entries) {
		removeEntry(entry, entry.relativePath);
	}

	for (const entry of globalEntries) {
		removeEntry(entry, entry.relativePath);
	}

	console.log("\nBuild cache cleaned successfully.");
}

function parseArgs(argv: string[]): CleanCacheOptions {
	const options: CleanCacheOptions = {
		dryRun: false,
		includeDeps: false,
		includeGlobalCaches: false,
	};

	for (const arg of argv) {
		if (arg === "--dry-run") {
			options.dryRun = true;
		} else if (arg === "--include-deps") {
			options.includeDeps = true;
		} else if (arg === "--include-global-caches") {
			options.includeGlobalCaches = true;
		} else if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		} else {
			console.error(`Unknown flag: ${arg}`);
			printUsage();
			process.exit(1);
		}
	}

	return options;
}

function printUsage(): void {
	console.log(
		[
			"",
			"Usage: bun run clean:cache [flags]",
			"",
			"  --dry-run        Show what would be deleted without deleting anything",
			"  --include-deps   Also remove cache folders inside node_modules",
			"  --include-global-caches",
			"                  Also clear Bun, Cargo, and sccache caches plus the /cc project index",
			"  --help, -h       Show this help message",
			"",
			"Examples:",
			"  bun run clean:cache",
			"  bun run clean:cache --dry-run",
			"  bun run clean:cache --include-deps",
			"  bun run clean:cache --include-global-caches --dry-run",
			"  bun run archive:clean --dry-run",
			"",
		].join("\n"),
	);
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

function discoverExistingEntries(
	repoRoot: string,
	includeDeps: boolean,
	includeGlobalCaches = false,
): ExistingCacheEntry[] {
	const baseEntries = includeDeps
		? [...BUILD_CACHE_ENTRIES, ...DEP_CACHE_ENTRIES]
		: BUILD_CACHE_ENTRIES;
	const cacheEntries = includeGlobalCaches
		? [...baseEntries, ...COCOINDEX_PROJECT_CACHE_ENTRIES]
		: baseEntries;

	return cacheEntries.flatMap((entry) => {
		const fullPath = path.resolve(repoRoot, entry.relativePath);
		if (!isSafeChildPath(repoRoot, fullPath) || !existsSync(fullPath)) {
			return [];
		}

		const stats = statSync(fullPath);
		return [
			{
				...entry,
				fullPath,
				type: stats.isDirectory() ? "directory" : "file",
			} satisfies ExistingCacheEntry,
		];
	});
}

function discoverGlobalCacheEntries(): ExistingCacheEntry[] {
	return [
		...discoverAbsoluteEntries(resolveCargoCacheEntries()),
		...discoverAbsoluteEntries(resolveBunCacheEntries()),
		...discoverAbsoluteEntries(resolveSccacheCacheEntries()),
	];
}

function resolveCargoCacheEntries(): AbsoluteCacheEntry[] {
	const cargoHome = process.env.CARGO_HOME
		? path.resolve(process.env.CARGO_HOME)
		: path.join(homedir(), ".cargo");
	const cargoHomeDisplay = process.env.CARGO_HOME ? cargoHome : "~/.cargo";

	return [
		{
			label: "Cargo registry package cache",
			rootPath: cargoHome,
			relativePath: "registry/cache",
			displayPath: `${cargoHomeDisplay}/registry/cache`,
		},
		{
			label: "Cargo registry source cache",
			rootPath: cargoHome,
			relativePath: "registry/src",
			displayPath: `${cargoHomeDisplay}/registry/src`,
		},
		{
			label: "Cargo git checkout cache",
			rootPath: cargoHome,
			relativePath: "git/checkouts",
			displayPath: `${cargoHomeDisplay}/git/checkouts`,
		},
		{
			label: "Cargo git database cache",
			rootPath: cargoHome,
			relativePath: "git/db",
			displayPath: `${cargoHomeDisplay}/git/db`,
		},
	];
}

function resolveBunCacheEntries(): AbsoluteCacheEntry[] {
	const bunCachePath = resolveBunCachePath();
	if (!bunCachePath) return [];

	return [
		{
			label: "Bun package cache",
			rootPath: path.dirname(bunCachePath),
			relativePath: path.basename(bunCachePath),
			displayPath: displayHomePath(bunCachePath),
		},
	];
}

function resolveSccacheCacheEntries(): AbsoluteCacheEntry[] {
	const sccachePath = resolveSccacheCachePath();
	if (!sccachePath) return [];

	return [
		{
			label: "sccache Rust compiler cache",
			rootPath: path.dirname(sccachePath),
			relativePath: path.basename(sccachePath),
			displayPath: displayHomePath(sccachePath),
		},
	];
}

function discoverAbsoluteEntries(
	entries: AbsoluteCacheEntry[],
): ExistingCacheEntry[] {
	return entries.flatMap((entry) => {
		const fullPath = path.resolve(entry.rootPath, entry.relativePath);
		if (!isSafeChildPath(entry.rootPath, fullPath) || !existsSync(fullPath)) {
			return [];
		}

		const stats = statSync(fullPath);
		return [
			{
				label: entry.label,
				relativePath: entry.displayPath,
				fullPath,
				type: stats.isDirectory() ? "directory" : "file",
			} satisfies ExistingCacheEntry,
		];
	});
}

function discoverGlobalCacheCommands(): CleanupCommand[] {
	const commands: CleanupCommand[] = [];

	if (commandExists("sccache")) {
		commands.push({
			label: "sccache server stop",
			command: ["sccache", "--stop-server"],
		});
	}

	return commands;
}

function resolveSccacheCachePath(): string | null {
	if (process.env.SCCACHE_DIR) {
		return path.resolve(process.env.SCCACHE_DIR);
	}

	if (!commandExists("sccache")) return null;

	try {
		const output = execFileSync("sccache", ["--show-stats"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const match = output.match(/Cache location\s+Local disk:\s+"([^"]+)"/);
		if (match?.[1]) return match[1];
	} catch {
		return defaultSccacheCachePath();
	}

	return defaultSccacheCachePath();
}

function defaultSccacheCachePath(): string {
	if (process.platform === "darwin") {
		return path.join(homedir(), "Library", "Caches", "Mozilla.sccache");
	}

	return path.join(homedir(), ".cache", "sccache");
}

function resolveBunCachePath(): string | null {
	if (process.env.BUN_INSTALL_CACHE_DIR) {
		return path.resolve(process.env.BUN_INSTALL_CACHE_DIR);
	}

	if (commandExists("bun")) {
		try {
			const output = execFileSync("bun", ["pm", "cache"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			if (output) return output;
		} catch {
			return null;
		}
	}

	return null;
}

function displayHomePath(fullPath: string): string {
	const homeDir = homedir();
	const relativePath = path.relative(homeDir, fullPath);
	if (relativePath !== "" && !relativePath.startsWith("..")) {
		return `~/${relativePath}`;
	}

	return fullPath;
}

function commandExists(command: string): boolean {
	try {
		execFileSync(command, ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function removeEntry(entry: ExistingCacheEntry, displayPath: string): void {
	process.stdout.write(`  Removing ${displayPath}... `);
	rmSync(entry.fullPath, {
		recursive: entry.type === "directory",
		force: true,
	});
	console.log("done");
}

function runCleanupCommand(command: CleanupCommand): void {
	process.stdout.write(`  Running ${command.label}... `);
	try {
		execFileSync(command.command[0], command.command.slice(1), {
			stdio: "pipe",
		});
		console.log("done");
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		console.log(`skipped (${details.split("\n")[0]})`);
	}
}

function isSafeChildPath(repoRoot: string, fullPath: string): boolean {
	const relativePath = path.relative(repoRoot, fullPath);
	return (
		relativePath !== "" &&
		!relativePath.startsWith("..") &&
		!path.isAbsolute(relativePath)
	);
}

main(process.argv.slice(2));
