import { describe, expect, it } from "bun:test";
import { parsePiModelId } from "./model.js";

describe("parsePiModelId", () => {
	it("normalizes Helmor Pi model ids for SDK lookup", () => {
		expect(parsePiModelId("pi:anthropic/claude-sonnet-4-6")).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
		});
		expect(parsePiModelId("pi:openai-codex/gpt-5.5")).toEqual({
			provider: "azure-openai-responses",
			model: "gpt-5.5",
		});
		expect(parsePiModelId("gpt-5.4-mini")).toEqual({
			provider: "azure-openai-responses",
			model: "gpt-5.4-mini",
		});
	});
});
