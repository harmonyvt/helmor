import type { AgentModelOption, AgentModelSection } from "./api";

const PI_PROVIDER_LABELS: Record<string, string> = {
	anthropic: "Anthropic",
	"azure-openai-responses": "Azure OpenAI Responses",
	"openai-codex": "OpenAI Codex",
	openai: "OpenAI",
};

const CODEX_PROFILE_LABELS: Record<string, string> = {
	azure: "Azure",
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

export function getCodexProfileKey(model: AgentModelOption): string {
	return (model.codexProfile ?? model.providerKey ?? "default").trim();
}

export function getCodexProfileLabel(profileKey: string): string {
	if (profileKey === "default") return "Default";
	return CODEX_PROFILE_LABELS[profileKey] ?? profileKey;
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
