import { describe, expect, it } from "bun:test";
import { parseSendMessageParams } from "./request-parser";

describe("request parser", () => {
	it("parses remote Pi execution metadata", () => {
		expect(
			parseSendMessageParams({
				sessionId: "sidecar-session",
				prompt: "hello",
				remote: {
					backend: "docker",
					cwd: "~/helmor-workspaces/repo/branch",
					containerName: "helmor-repo-default",
				},
			}),
		).toMatchObject({
			sessionId: "sidecar-session",
			prompt: "hello",
			images: [],
			remote: {
				backend: "docker",
				cwd: "~/helmor-workspaces/repo/branch",
				containerName: "helmor-repo-default",
			},
		});
	});

	it("rejects invalid remote execution metadata", () => {
		expect(() =>
			parseSendMessageParams({
				sessionId: "sidecar-session",
				prompt: "hello",
				remote: { backend: "codex", cwd: "/tmp/repo" },
			}),
		).toThrow("params.remote.backend must be docker or ssh");
	});
});
