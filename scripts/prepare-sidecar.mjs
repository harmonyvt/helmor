#!/usr/bin/env node
/**
 * Bundle-binary staging script. Tauri invokes this via `beforeBuildCommand`.
 *
 * Steps:
 * 1. `cd sidecar && bun install --frozen-lockfile` (so CI runners have deps).
 * 2. `bun run build` — produces `sidecar/dist/helmor-sidecar` plus the
 *    `sidecar/dist/vendor/` tree that Tauri bundles as resources.
 * 3. `cargo build --bin helmor-cli --bin helmor-web --release --target <triple>` — produces
 *    the CLI and web companion binaries that ship inside the desktop app bundle.
 * 4. Copy the compiled sidecar / companions to target-suffixed names so
 *    Tauri's `externalBin` entries can find the artifacts they expect.
 *
 * Usage (from repo root):
 *   node scripts/prepare-sidecar.mjs
 *   bun scripts/prepare-sidecar.mjs      # equivalent, Tauri uses this form
 */
import { execFileSync, execSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidecarDir = resolve(repoRoot, "sidecar");
const srcTauriDir = resolve(repoRoot, "src-tauri");
const bundledBinDir = resolve(srcTauriDir, "target", "bundled");
const entitlementsPlist = resolve(repoRoot, "src-tauri", "Entitlements.plist");

function run(cmd, cwd) {
	console.log(`[prepare-sidecar] $ ${cmd} (cwd: ${cwd})`);
	execSync(cmd, { cwd, stdio: "inherit" });
}

function stageExternalBinPlaceholder(path) {
	if (existsSync(path)) return;
	writeFileSync(path, "#!/bin/sh\nexit 0\n");
	chmodSync(path, 0o755);
}

// Pre-sign the compiled sidecar with JIT entitlements so Bun's JSC runtime
// can allocate executable memory under hardened runtime. Tauri may re-sign
// this binary during bundling, but codesign preserves the entitlements blob
// unless --entitlements is passed again with a different plist.
function signSidecarWithEntitlements(path) {
	const identity = process.env.APPLE_SIGNING_IDENTITY?.trim();
	if (!identity) {
		console.log(
			"[prepare-sidecar] APPLE_SIGNING_IDENTITY unset — skipping sidecar pre-sign (dev / unsigned build)",
		);
		return;
	}
	if (!existsSync(entitlementsPlist)) {
		throw new Error(
			`[prepare-sidecar] Entitlements.plist missing at ${entitlementsPlist}`,
		);
	}
	console.log(`[prepare-sidecar] codesign (+entitlements) ${path}`);
	execFileSync(
		"codesign",
		[
			"--force",
			"--sign",
			identity,
			"--timestamp",
			"--options",
			"runtime",
			"--entitlements",
			entitlementsPlist,
			path,
		],
		{ stdio: "inherit" },
	);
}

function detectTargetTriple() {
	for (const key of [
		"TAURI_TARGET_TRIPLE",
		"TAURI_ENV_TARGET_TRIPLE",
		"CARGO_BUILD_TARGET",
	]) {
		const override = process.env[key]?.trim();
		if (override) {
			return override;
		}
	}
	const output = execSync("rustc --print host-tuple", {
		encoding: "utf8",
	}).trim();
	if (!output) {
		throw new Error("`rustc --print host-tuple` returned empty output");
	}
	return output;
}

function main() {
	// 1. Install sidecar deps (idempotent; fast when lockfile matches).
	run("bun install --frozen-lockfile", sidecarDir);

	// 2. Build the compiled sidecar + staged vendor tree.
	run("bun run build", sidecarDir);

	const triple = detectTargetTriple();
	const sidecarSource = resolve(sidecarDir, "dist", "helmor-sidecar");
	const sidecarDestination = resolve(
		sidecarDir,
		"dist",
		`helmor-sidecar-${triple}`,
	);
	const exeSuffix = process.platform === "win32" ? ".exe" : "";
	const cliSource = resolve(
		srcTauriDir,
		"target",
		triple,
		"release",
		`helmor-cli${exeSuffix}`,
	);
	const webSource = resolve(
		srcTauriDir,
		"target",
		triple,
		"release",
		`helmor-web${exeSuffix}`,
	);
	const cliDestination = resolve(bundledBinDir, `helmor-cli-${triple}`);
	const webDestination = resolve(bundledBinDir, `helmor-web-${triple}`);

	if (!existsSync(sidecarSource)) {
		throw new Error(
			`[prepare-sidecar] expected compiled sidecar at ${sidecarSource} but it does not exist`,
		);
	}

	// Tauri validates every `externalBin` during `cargo build`, including the
	// companion binaries that this same command is about to produce. Stage
	// target-suffixed placeholders first so clean CI checkouts can compile them
	// without depending on stale artifacts; real binaries overwrite these below.
	mkdirSync(bundledBinDir, { recursive: true });
	copyFileSync(sidecarSource, sidecarDestination);
	stageExternalBinPlaceholder(cliDestination);
	stageExternalBinPlaceholder(webDestination);

	run(
		`cargo build --manifest-path ${resolve(srcTauriDir, "Cargo.toml")} --bin helmor-cli --bin helmor-web --release --target ${triple}`,
		repoRoot,
	);

	if (!existsSync(cliSource)) {
		throw new Error(
			`[prepare-sidecar] expected compiled CLI at ${cliSource} but it does not exist`,
		);
	}
	if (!existsSync(webSource)) {
		throw new Error(
			`[prepare-sidecar] expected compiled web daemon at ${webSource} but it does not exist`,
		);
	}

	copyFileSync(cliSource, cliDestination);
	copyFileSync(webSource, webDestination);

	// Sign the target-suffixed copy (the one Tauri ingests as externalBin).
	// No-op when APPLE_SIGNING_IDENTITY is unset.
	signSidecarWithEntitlements(sidecarDestination);

	console.log(`[prepare-sidecar] staged sidecar → ${sidecarDestination}`);
	console.log(`[prepare-sidecar] staged CLI → ${cliDestination}`);
	console.log(`[prepare-sidecar] staged web daemon → ${webDestination}`);
}

main();
