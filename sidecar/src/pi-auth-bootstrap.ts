import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import { errorDetails, logger } from "./logger.js";

const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";

export interface PiAuthBootstrapResult {
	readonly anthropic: boolean;
	readonly openaiCodex: boolean;
}

export function bootstrapPiAuth(
	authStorage: AuthStorage,
): PiAuthBootstrapResult {
	const anthropic = bootstrapClaudeAuth(authStorage);
	const openaiCodex = bootstrapCodexAuth(authStorage);
	return { anthropic, openaiCodex };
}

function bootstrapClaudeAuth(authStorage: AuthStorage): boolean {
	if (authStorage.hasAuth("anthropic")) return true;
	if (process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY) {
		return true;
	}

	try {
		spawnSync("claude", ["auth", "status", "--json"], {
			stdio: "ignore",
			timeout: 8_000,
		});
		const token = readClaudeAccessTokenFromKeychain();
		if (!token) return false;
		authStorage.setRuntimeApiKey("anthropic", token);
		return true;
	} catch (err) {
		logger.debug("Pi Claude auth bootstrap skipped", errorDetails(err));
		return false;
	}
}

function bootstrapCodexAuth(authStorage: AuthStorage): boolean {
	if (authStorage.hasAuth("openai-codex") || authStorage.hasAuth("openai")) {
		return true;
	}
	if (process.env.OPENAI_API_KEY) return true;

	try {
		const root = readJson(codexAuthPath());
		const apiKey = pickString(root, ["OPENAI_API_KEY"]);
		if (apiKey) {
			authStorage.setRuntimeApiKey("openai", apiKey);
			return true;
		}

		const tokens = asRecord(root.tokens);
		const accessToken = tokens
			? pickString(tokens, ["access_token", "accessToken"])
			: undefined;
		if (!accessToken) return false;
		authStorage.setRuntimeApiKey("openai-codex", accessToken);
		return true;
	} catch (err) {
		logger.debug("Pi Codex auth bootstrap skipped", errorDetails(err));
		return false;
	}
}

function codexAuthPath(): string {
	const custom = process.env.CODEX_HOME?.trim();
	return join(custom || join(homedir(), ".codex"), "auth.json");
}

function readClaudeAccessTokenFromKeychain(): string | undefined {
	if (process.platform !== "darwin" || !existsSync("/usr/bin/security")) {
		return undefined;
	}
	const accounts = claudeKeychainAccounts();
	for (const account of accounts) {
		const args = ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE];
		if (account) args.push("-a", account);
		args.push("-w");
		const result = spawnSync("/usr/bin/security", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 5 * 60_000,
		});
		if (result.status !== 0 || !result.stdout.trim()) continue;
		const token = parseClaudeAccessToken(result.stdout.trim());
		if (token) return token;
	}
	return undefined;
}

function claudeKeychainAccounts(): string[] {
	const accounts = new Set<string>(["Claude Code"]);
	for (const key of ["USER", "LOGNAME"] as const) {
		const value = process.env[key]?.trim();
		if (value) accounts.add(value);
	}
	return [...accounts, ""];
}

function parseClaudeAccessToken(raw: string): string | undefined {
	try {
		const parsed = JSON.parse(raw) as unknown;
		const root = asRecord(parsed);
		const nested = asRecord(root?.claudeAiOauth);
		return pickString(nested ?? root, ["accessToken", "access_token"]);
	} catch {
		return undefined;
	}
}

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function pickString(
	obj: Record<string, unknown> | undefined,
	keys: readonly string[],
): string | undefined {
	if (!obj) return undefined;
	for (const key of keys) {
		const value = obj[key];
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}
