import { describe, expect, test } from "bun:test";
import { DEV_WEB_DAEMON_PORT } from "./dev-preview";
import { resolveDevWebConfig } from "./dev-web";

describe("dev web launcher", () => {
	test("defaults the development web API to the debug daemon", async () => {
		const config = await resolveDevWebConfig([], {
			HELMOR_WEB_MODE: "development",
		});

		expect(config.mode).toBe("development");
		expect(config.apiBase).toBe(`http://127.0.0.1:${DEV_WEB_DAEMON_PORT}`);
		expect(config.apiPort).toBe(String(DEV_WEB_DAEMON_PORT));
		expect(config.viteHost).toBe("127.0.0.1");
		expect(config.vitePort).toBe("1421");
	});

	test("network mode binds vite broadly and lets browsers use their current host", async () => {
		const config = await resolveDevWebConfig(["--network"], {
			HELMOR_WEB_MODE: "development",
		});

		expect(config.apiBase).toBe("");
		expect(config.apiPort).toBe(String(DEV_WEB_DAEMON_PORT));
		expect(config.viteHost).toBe("0.0.0.0");
	});

	test("resolves preview mode to the worktree daemon port", async () => {
		const config = await resolveDevWebConfig(["--preview"], {});

		expect(config.mode).toBe("preview");
		expect(config.apiBase).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(config.apiBase).not.toBe(`http://127.0.0.1:${DEV_WEB_DAEMON_PORT}`);
	});

	test("respects an explicit daemon port for preview/dev variants", async () => {
		const config = await resolveDevWebConfig(["--preview"], {
			HELMOR_WEB_PORT: "18123",
			HELMOR_WEB_DEV_PORT: "15123",
		});

		expect(config.mode).toBe("preview");
		expect(config.apiBase).toBe("http://127.0.0.1:18123");
		expect(config.apiPort).toBe("18123");
		expect(config.vitePort).toBe("15123");
	});

	test("passes through an explicit API base unchanged except trailing slash", async () => {
		const config = await resolveDevWebConfig(["--", "--clearScreen", "false"], {
			VITE_HELMOR_WEB_API_BASE: "http://127.0.0.1:19999/",
		});

		expect(config.apiBase).toBe("http://127.0.0.1:19999");
		expect(config.viteArgs).toEqual(["--clearScreen", "false"]);
	});
});
