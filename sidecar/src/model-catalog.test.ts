import { describe, expect, it } from "bun:test";
import { listProviderModels } from "./model-catalog";

describe("model catalog", () => {
	it("routes Pi GPT models through Azure OpenAI Responses", () => {
		const piModels = listProviderModels("pi").filter((model) =>
			model.label.startsWith("Pi · GPT"),
		);

		expect(piModels.map((model) => model.id)).toEqual([
			"pi:azure-openai-responses/gpt-5.5",
			"pi:azure-openai-responses/gpt-5.4",
			"pi:azure-openai-responses/gpt-5.4-mini",
			"pi:azure-openai-responses/gpt-5.3-codex",
		]);
		expect(piModels.every((model) => model.supportsFastMode)).toBe(false);
		expect(
			piModels.every((model) => model.effortLevels?.includes("minimal")),
		).toBe(true);
		expect(piModels.map((model) => model.cliModel)).toEqual([
			"azure-openai-responses/gpt-5.5",
			"azure-openai-responses/gpt-5.4",
			"azure-openai-responses/gpt-5.4-mini",
			"azure-openai-responses/gpt-5.3-codex",
		]);
	});
});
