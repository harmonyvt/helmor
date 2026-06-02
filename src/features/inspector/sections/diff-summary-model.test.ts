import { describe, expect, it } from "vitest";
import type { AgentModelOption } from "@/lib/api";
import { resolvePreferredPiModelId } from "./diff-summary-model";

const piFast: AgentModelOption = {
	id: "pi:azure-openai-responses/gpt-5.5",
	provider: "pi",
	label: "Pi · GPT-5.5",
	cliModel: "azure-openai-responses/gpt-5.5",
	supportsContextUsage: false,
};

const piClaude: AgentModelOption = {
	id: "pi:anthropic/claude-sonnet-4-6",
	provider: "pi",
	label: "Pi · Claude Sonnet 4.6",
	cliModel: "anthropic/claude-sonnet-4-6",
	supportsContextUsage: false,
};

describe("resolvePreferredPiModelId", () => {
	it("prefers the configured Diff review model when it is available", () => {
		expect(
			resolvePreferredPiModelId([piFast, piClaude], piClaude.id, [piFast.id]),
		).toBe(piClaude.id);
	});

	it("falls back to a favourite Pi model when the configured model is unavailable", () => {
		expect(
			resolvePreferredPiModelId([piFast, piClaude], "pi:missing/model", [
				piFast.id,
			]),
		).toBe(piFast.id);
	});

	it("falls back to the first Pi model when there is no configured or favourite model", () => {
		expect(resolvePreferredPiModelId([piFast, piClaude], null, [])).toBe(
			piFast.id,
		);
	});
});
