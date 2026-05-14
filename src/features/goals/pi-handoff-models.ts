import type { AgentModelOption } from "@/lib/api";

const LEGACY_OPENAI_CODEX_PREFIX = "openai-codex/";
const AZURE_OPENAI_RESPONSES_PREFIX = "azure-openai-responses/";

export function canonicalPiModelId(
	modelId: string,
	piModels: readonly AgentModelOption[],
): string | null {
	const raw = modelId.trim();
	if (!raw) return null;

	const legacyCanonical = canonicalizeLegacyId(raw);
	const direct = piModels.find(
		(model) =>
			model.id === raw ||
			model.id === legacyCanonical ||
			model.cliModel === raw ||
			model.cliModel === stripPiPrefix(legacyCanonical),
	);
	if (direct) return direct.id;

	const cliModel = stripPiPrefix(legacyCanonical);
	if (cliModel.includes("/")) return `pi:${cliModel}`;
	if (cliModel.startsWith("gpt-")) {
		return `pi:${AZURE_OPENAI_RESPONSES_PREFIX}${cliModel}`;
	}
	return null;
}

function canonicalizeLegacyId(modelId: string): string {
	const raw = modelId.trim();
	const unprefixed = stripPiPrefix(raw);
	if (unprefixed.startsWith(LEGACY_OPENAI_CODEX_PREFIX)) {
		return `pi:${AZURE_OPENAI_RESPONSES_PREFIX}${unprefixed.slice(
			LEGACY_OPENAI_CODEX_PREFIX.length,
		)}`;
	}
	return raw.startsWith("pi:") ? raw : unprefixed;
}

function stripPiPrefix(modelId: string): string {
	return modelId.startsWith("pi:") ? modelId.slice(3) : modelId;
}
