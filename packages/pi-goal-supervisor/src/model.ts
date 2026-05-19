import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export function parsePiModelId(modelId: string | undefined): {
	provider: string;
	model: string;
} {
	const raw = (modelId || "anthropic/claude-opus-4-7").replace(/^pi:/, "");
	const slash = raw.indexOf("/");
	if (slash > 0) {
		const provider = raw.slice(0, slash);
		return {
			provider:
				provider === "openai-codex" ? "azure-openai-responses" : provider,
			model: raw.slice(slash + 1),
		};
	}
	if (raw.startsWith("gpt-")) {
		return { provider: "azure-openai-responses", model: raw };
	}
	return { provider: "anthropic", model: raw };
}

export function resolvePiModel(
	modelRegistry: ModelRegistry,
	modelId: string | undefined,
) {
	const { provider, model } = parsePiModelId(modelId);
	return modelRegistry.find(provider, model) ?? modelRegistry.getAvailable()[0];
}
