import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	createTauriConfigOverride,
	DEV_WEB_DAEMON_PORT,
	derivePreviewIdentity,
	derivePreviewWebDaemonPort,
	ensurePreviewResourceDirs,
	PREVIEW_DATA_DIR_NAME,
	PREVIEW_MCP_PORT_BLOCK_SIZE,
	PREVIEW_MCP_PORT_START,
	PREVIEW_VITE_PORT_SPAN,
	PREVIEW_VITE_PORT_START,
	PREVIEW_WEB_DAEMON_PORT_SPAN,
	PREVIEW_WEB_DAEMON_PORT_START,
} from "./dev-preview";

describe("dev preview identity", () => {
	test("derives a stable slug and hash from the worktree path", () => {
		const first = derivePreviewIdentity(
			"/Users/harmony/worktrees/Feature Preview",
			"/Users/harmony",
		);
		const second = derivePreviewIdentity(
			"/Users/harmony/worktrees/Feature Preview",
			"/Users/harmony",
		);

		expect(first.slug).toBe("feature-preview");
		expect(first.hash).toMatch(/^[a-f0-9]{10}$/);
		expect(first.key).toBe(`${first.slug}-${first.hash}`);
		expect(second).toEqual(first);
	});

	test("derives preview ports inside non-default preview ranges", () => {
		const identity = derivePreviewIdentity(
			"/Users/harmony/worktrees/helmor",
			"/Users/harmony",
		);

		expect(identity.vitePortBase).toBeGreaterThanOrEqual(
			PREVIEW_VITE_PORT_START,
		);
		expect(identity.vitePortBase).toBeLessThan(
			PREVIEW_VITE_PORT_START + PREVIEW_VITE_PORT_SPAN,
		);
		expect(identity.mcpBasePort).toBeGreaterThanOrEqual(PREVIEW_MCP_PORT_START);
		expect(identity.mcpBasePort).toBeLessThan(50_000);
		expect(identity.mcpBasePort % PREVIEW_MCP_PORT_BLOCK_SIZE).toBe(0);
		expect(identity.webDaemonPort).toBeGreaterThanOrEqual(
			PREVIEW_WEB_DAEMON_PORT_START,
		);
		expect(identity.webDaemonPort).toBeLessThan(
			PREVIEW_WEB_DAEMON_PORT_START + PREVIEW_WEB_DAEMON_PORT_SPAN,
		);
		expect(identity.webDaemonPort).not.toBe(DEV_WEB_DAEMON_PORT);
	});

	test("places preview data under the home preview directory", () => {
		const identity = derivePreviewIdentity(
			"/Users/harmony/worktrees/helmor",
			"/Users/harmony",
		);

		expect(identity.dataDir).toBe(
			path.join("/Users/harmony", PREVIEW_DATA_DIR_NAME, identity.key),
		);
		expect(identity.webDaemonPort).toBe(
			derivePreviewWebDaemonPort(identity.dataDir),
		);
	});

	test("builds the Tauri dev config override", () => {
		const identity = derivePreviewIdentity(
			"/Users/harmony/worktrees/helmor",
			"/Users/harmony",
		);

		expect(createTauriConfigOverride(identity, 15_321)).toEqual({
			productName: identity.productName,
			identifier: identity.identifier,
			build: {
				devUrl: "http://localhost:15321",
			},
		});
	});

	test("creates ignored resource directories needed by Tauri dev builds", () => {
		const root = mkdtempSync(path.join(tmpdir(), "helmor-preview-"));
		try {
			ensurePreviewResourceDirs(root);

			expect(existsSync(path.join(root, "dist-web"))).toBe(true);
			expect(existsSync(path.join(root, "dist-web", "index.html"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
