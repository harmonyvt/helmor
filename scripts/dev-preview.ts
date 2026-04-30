import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PREVIEW_DATA_DIR_NAME = "helmor-dev-previews";
export const PREVIEW_VITE_PORT_START = 15_000;
export const PREVIEW_VITE_PORT_SPAN = 5_000;
export const PREVIEW_MCP_PORT_START = 20_000;
export const PREVIEW_MCP_PORT_BLOCK_SIZE = 100;
export const PREVIEW_MCP_PORT_BLOCK_COUNT = 300;

export type PreviewIdentity = {
	worktreeRoot: string;
	slug: string;
	hash: string;
	key: string;
	dataDir: string;
	vitePortBase: number;
	mcpBasePort: number;
	productName: string;
	identifier: string;
};

export type TauriConfigOverride = {
	productName: string;
	identifier: string;
	build: {
		devUrl: string;
	};
};

export function stableHash(input: string, length = 10): string {
	return createHash("sha256").update(input).digest("hex").slice(0, length);
}

export function slugifyWorktreePath(worktreeRoot: string): string {
	const basename = path.basename(worktreeRoot);
	const slug = basename
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);

	return slug || "worktree";
}

export function deriveVitePortBase(hash: string): number {
	return PREVIEW_VITE_PORT_START + (hashToInt(hash) % PREVIEW_VITE_PORT_SPAN);
}

export function deriveMcpBasePort(hash: string): number {
	return (
		PREVIEW_MCP_PORT_START +
		(hashToInt(hash) % PREVIEW_MCP_PORT_BLOCK_COUNT) *
			PREVIEW_MCP_PORT_BLOCK_SIZE
	);
}

export function derivePreviewIdentity(
	worktreeRoot: string,
	homeDir = homedir(),
): PreviewIdentity {
	const normalizedRoot = normalizePath(worktreeRoot);
	const slug = slugifyWorktreePath(normalizedRoot);
	const hash = stableHash(normalizedRoot);
	const key = `${slug}-${hash}`;

	return {
		worktreeRoot: normalizedRoot,
		slug,
		hash,
		key,
		dataDir: path.join(homeDir, PREVIEW_DATA_DIR_NAME, key),
		vitePortBase: deriveVitePortBase(hash),
		mcpBasePort: deriveMcpBasePort(hash),
		productName: `Helmor Preview ${key}`,
		identifier: `ai.helmor.preview.${key}`,
	};
}

export function createTauriConfigOverride(
	identity: PreviewIdentity,
	vitePort: number,
): TauriConfigOverride {
	return {
		productName: identity.productName,
		identifier: identity.identifier,
		build: {
			devUrl: `http://localhost:${vitePort}`,
		},
	};
}

export async function findAvailablePort(
	startPort: number,
	maxAttempts = 200,
): Promise<number> {
	for (let offset = 0; offset < maxAttempts; offset += 1) {
		const port = startPort + offset;
		if (port > 65_535) {
			break;
		}
		if (await isPortAvailable(port)) {
			return port;
		}
	}

	throw new Error(
		`No free port found from ${startPort} after ${maxAttempts} attempts`,
	);
}

export function resolveGitWorktreeRoot(cwd = process.cwd()): Promise<string> {
	return runAndCapture("git", ["rev-parse", "--show-toplevel"], {
		cwd,
	}).then((output) => output.trim());
}

async function main(extraTauriArgs: string[]): Promise<void> {
	const worktreeRoot = await resolveGitWorktreeRoot();
	const identity = derivePreviewIdentity(worktreeRoot);
	const vitePort = await findAvailablePort(identity.vitePortBase);
	const tauriConfig = createTauriConfigOverride(identity, vitePort);
	const env = {
		...process.env,
		HELMOR_DATA_DIR: identity.dataDir,
		HELMOR_DEV_PORT: String(vitePort),
		HELMOR_MCP_BASE_PORT: String(identity.mcpBasePort),
	};

	mkdirSync(identity.dataDir, { recursive: true });

	printPreviewSummary(identity, vitePort);

	await runInherited("bun", ["run", "dev:prepare"], { env });
	await runInherited(
		"bun",
		[
			"run",
			"tauri",
			"dev",
			"--config",
			JSON.stringify(tauriConfig),
			...extraTauriArgs,
		],
		{ env },
	);
}

function hashToInt(hash: string): number {
	return Number.parseInt(hash.slice(0, 8), 16);
}

function normalizePath(value: string): string {
	const resolved = path.resolve(value);
	return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

function isPortAvailable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();

		server.once("error", () => {
			resolve(false);
		});
		server.once("listening", () => {
			server.close(() => {
				resolve(true);
			});
		});
		server.listen(port, "127.0.0.1");
	});
}

function runAndCapture(
	command: string,
	args: string[],
	options: { cwd?: string },
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];

		child.stdout.on("data", (chunk: Buffer) => {
			stdout.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr.push(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve(Buffer.concat(stdout).toString("utf8"));
				return;
			}

			reject(
				new Error(
					`${command} ${args.join(" ")} failed with code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
				),
			);
		});
	});
}

function runInherited(
	command: string,
	args: string[],
	options: { env: NodeJS.ProcessEnv },
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env: options.env,
			stdio: "inherit",
		});

		child.on("error", reject);
		child.on("close", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}

			if (signal) {
				reject(new Error(`${command} exited from signal ${signal}`));
				return;
			}

			reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
		});
	});
}

function printPreviewSummary(
	identity: PreviewIdentity,
	vitePort: number,
): void {
	const mcpEndPort = identity.mcpBasePort + PREVIEW_MCP_PORT_BLOCK_SIZE - 1;

	console.log("Helmor worktree preview");
	console.log(`  Worktree: ${identity.worktreeRoot}`);
	console.log(`  Data dir: ${identity.dataDir}`);
	console.log(`  Vite dev URL: http://localhost:${vitePort}`);
	console.log(
		`  MCP bridge base port: ${identity.mcpBasePort} (range ${identity.mcpBasePort}-${mcpEndPort})`,
	);
	console.log(`  Product name: ${identity.productName}`);
	console.log(`  Identifier: ${identity.identifier}`);
	console.log("");
}

function isMainModule(): boolean {
	const entrypoint = process.argv[1];
	if (!entrypoint) {
		return false;
	}

	return path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
