import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import {
	DEV_WEB_DAEMON_PORT,
	derivePreviewIdentity,
	resolveGitWorktreeRoot,
} from "./dev-preview";

type WebMode = "auto" | "development" | "preview";

type DevWebConfig = {
	mode: WebMode;
	apiBase: string;
	apiPort: string;
	viteHost: string;
	vitePort: string;
	viteArgs: string[];
};

async function main(args: string[]): Promise<void> {
	const config = await resolveDevWebConfig(args);

	console.log("Helmor web development surface");
	console.log(`  Mode: ${config.mode}`);
	console.log(
		`  API base: ${config.apiBase || `same host on port ${config.apiPort}`}`,
	);
	console.log(
		`  Vite URL: http://${displayHost(config.viteHost)}:${config.vitePort}`,
	);
	console.log("");

	await runInherited(
		"bun",
		[
			"x",
			"vite",
			"--host",
			config.viteHost,
			"--port",
			config.vitePort,
			...config.viteArgs,
		],
		{
			env: {
				...process.env,
				VITE_HELMOR_WEB: "1",
				VITE_HELMOR_WEB_API_BASE: config.apiBase,
				VITE_HELMOR_WEB_API_PORT: config.apiPort,
			},
		},
	);
}

export async function resolveDevWebConfig(
	args: string[],
	env: NodeJS.ProcessEnv = process.env,
): Promise<DevWebConfig> {
	const { mode, viteArgs } = parseArgs(args, env);
	const explicitApiBase = env.VITE_HELMOR_WEB_API_BASE?.replace(/\/$/, "");
	const explicitPort = parsePort(env.HELMOR_WEB_PORT);
	const resolvedMode = await resolveMode(mode);
	const apiPort = String(explicitPort ?? (await defaultApiPort(resolvedMode)));
	const viteHost = resolveWebHost(env);
	const apiBase =
		explicitApiBase ??
		(isWildcardHost(viteHost) ? "" : `http://127.0.0.1:${apiPort}`);

	return {
		mode: resolvedMode,
		apiBase,
		apiPort,
		viteHost,
		vitePort: env.HELMOR_WEB_DEV_PORT || "1421",
		viteArgs,
	};
}

function parseArgs(
	args: string[],
	env: NodeJS.ProcessEnv,
): { mode: WebMode; viteArgs: string[] } {
	let mode: WebMode =
		env.HELMOR_WEB_MODE === "preview" || env.HELMOR_WEB_MODE === "development"
			? env.HELMOR_WEB_MODE
			: "auto";
	const viteArgs: string[] = [];
	let passthrough = false;

	for (const arg of args) {
		if (passthrough) {
			viteArgs.push(arg);
			continue;
		}
		if (arg === "--") {
			passthrough = true;
			continue;
		}
		if (arg === "--preview") {
			mode = "preview";
			continue;
		}
		if (arg === "--network" || arg === "--tailnet") {
			env.HELMOR_WEB_HOST = "0.0.0.0";
			continue;
		}
		if (arg === "--auto") {
			mode = "auto";
			continue;
		}
		if (arg === "--dev" || arg === "--development") {
			mode = "development";
			continue;
		}
		viteArgs.push(arg);
	}

	return { mode, viteArgs };
}

function resolveWebHost(env: NodeJS.ProcessEnv): string {
	const host = env.HELMOR_WEB_HOST?.trim();
	return host || "127.0.0.1";
}

function isWildcardHost(host: string): boolean {
	return host === "0.0.0.0" || host === "::";
}

function displayHost(host: string): string {
	return isWildcardHost(host) ? "127.0.0.1" : host;
}

async function resolveMode(mode: WebMode): Promise<Exclude<WebMode, "auto">> {
	if (mode !== "auto") {
		return mode;
	}

	return (await hasRunningPreviewDaemon()) ? "preview" : "development";
}

function parsePort(value: string | undefined): number | null {
	if (!value) return null;
	const port = Number.parseInt(value, 10);
	return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

async function defaultApiPort(mode: WebMode): Promise<number> {
	if (mode !== "preview") {
		return DEV_WEB_DAEMON_PORT;
	}
	const identity = derivePreviewIdentity(await resolveGitWorktreeRoot());
	return identity.webDaemonPort;
}

async function hasRunningPreviewDaemon(): Promise<boolean> {
	const identity = derivePreviewIdentity(await resolveGitWorktreeRoot());
	const pidFile = `${identity.dataDir}/run/web-daemon-${identity.webDaemonPort}.json`;
	if (!existsSync(pidFile)) {
		return false;
	}

	try {
		const status = JSON.parse(readFileSync(pidFile, "utf8")) as {
			host?: string;
			port?: number;
		};
		const host = status.host || "127.0.0.1";
		const port = parsePort(String(status.port ?? "")) ?? identity.webDaemonPort;
		return await canConnect(host, port);
	} catch {
		return false;
	}
}

function canConnect(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host, port });
		const done = (connected: boolean) => {
			socket.destroy();
			resolve(connected);
		};
		socket.setTimeout(200);
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
		socket.once("timeout", () => done(false));
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

function isMainModule(): boolean {
	const entrypoint = process.argv[1];
	return Boolean(entrypoint && fileURLToPath(import.meta.url) === entrypoint);
}

if (isMainModule()) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
