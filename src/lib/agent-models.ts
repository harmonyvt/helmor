import type { AgentModelOption, AgentModelSection } from "./api";

const PI_PROVIDER_LABELS: Record<string, string> = {
	anthropic: "Anthropic",
	"azure-openai-responses": "Azure OpenAI Responses",
	"openai-codex": "OpenAI Codex",
	openai: "OpenAI",
};

export function getPiModelProviderKey(model: AgentModelOption): string {
	return (
		model.providerKey ??
		model.cliModel.split("/", 1)[0] ??
		"unknown"
	).trim();
}

export function getPiModelProviderLabel(providerKey: string): string {
	return PI_PROVIDER_LABELS[providerKey] ?? providerKey;
}

export function replacePiModels(
	current: AgentModelSection[] | undefined,
	models: AgentModelOption[],
): AgentModelSection[] | undefined {
	if (!current) return current;
	return current.map((section) =>
		section.id === "pi" ? { ...section, options: models } : section,
	);
}
