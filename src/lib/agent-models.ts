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
	const piSection: AgentModelSection = {
		id: "pi",
		label: "Pi",
		status: "ready",
		options: models,
	};
	if (!current) return [piSection];
	let replaced = false;
	const next = current.map((section) => {
		if (section.id !== "pi") return section;
		replaced = true;
		return { ...section, options: models };
	});
	return replaced ? next : [...next, piSection];
}
