import { describe, expect, it } from "bun:test";
import { buildCodexAppServerArgs } from "./codex-app-server";

describe("codex app-server args", () => {
	it("launches app-server with Helmor notification override by default", () => {
		expect(buildCodexAppServerArgs()).toEqual([
			"app-server",
			"-c",
			"notify=[]",
		]);
	});

	it("places profile before the app-server subcommand", () => {
		expect(buildCodexAppServerArgs("azure")).toEqual([
			"--profile",
			"azure",
			"app-server",
			"-c",
			"notify=[]",
		]);
	});
});
