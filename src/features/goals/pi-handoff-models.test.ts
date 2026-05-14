import { describe, expect, it } from "vitest";
import type { AgentModelOption } from "@/lib/api";
import { canonicalPiModelId } from "./pi-handoff-models";

const piModels: AgentModelOption[] = [
	{
		id: "pi:anthropic/claude-sonnet-4-6",
		provider: "pi",
		label: "Pi · Claude Sonnet 4.6",
		cliModel: "anthropic/claude-sonnet-4-6",
		supportsContextUsage: false,
	},
	{
		id: "pi:azure-openai-responses/gpt-5.5",
		provider: "pi",
		label: "Pi · GPT-5.5",
		cliModel: "azure-openai-responses/gpt-5.5",
		supportsContextUsage: false,
	},
];

describe("canonicalPiModelId", () => {
	it("canonicalizes raw Pi cli model ids", () => {
		expect(canonicalPiModelId("azure-openai-responses/gpt-5.5", piModels)).toBe(
			"pi:azure-openai-responses/gpt-5.5",
		);
	});

	it("maps legacy openai-codex Pi ids to azure-openai-responses", () => {
		expect(canonicalPiModelId("pi:openai-codex/gpt-5.5", piModels)).toBe(
			"pi:azure-openai-responses/gpt-5.5",
		);
	});

	it("maps bare GPT model ids to the Pi Azure OpenAI Responses namespace", () => {
		expect(canonicalPiModelId("gpt-5.5", piModels)).toBe(
			"pi:azure-openai-responses/gpt-5.5",
		);
	});
});
