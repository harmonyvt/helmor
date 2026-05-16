import type { AgentModelOption } from "@/lib/api";

const LEGACY_OPENAI_CODEX_PREFIX = "openai-codex/";
const AZURE_OPENAI_RESPONSES_PREFIX = "azure-openai-responses/";
const DEFAULT_ALLOWED_GOAL_ASSIGNEE_PI_PROVIDERS = new Set([
	"anthropic",
	AZURE_OPENAI_RESPONSES_PREFIX.slice(0, -1),
	LEGACY_OPENAI_CODEX_PREFIX.slice(0, -1),
]);

export type PiHandoffModelPolicyResult = {
	assignedProvider: "pi";
	assignedModelId: string | null;
	requestedModelId: string | null;
	resolvedModelId: string | null;
	fallbackUsed: boolean;
	policyApplied: boolean;
	allowedModelIds: string[];
	suggestedModelIds: string[];
};

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

export function isDefaultGoalAssigneePiModelAllowed(
	model: Pick<AgentModelOption, "id" | "cliModel" | "providerKey">,
): boolean {
	return DEFAULT_ALLOWED_GOAL_ASSIGNEE_PI_PROVIDERS.has(
		piModelProviderKey(model),
	);
}

export function resolveGoalAssigneePiHandoffModel({
	activeSupervisorModelId,
	requestedModelId,
	piModels,
	allowAllModels,
}: {
	activeSupervisorModelId: string | null;
	requestedModelId: string | null;
	piModels: readonly AgentModelOption[];
	allowAllModels: boolean;
}): PiHandoffModelPolicyResult {
	const allowedModelIds = piModels
		.filter(isDefaultGoalAssigneePiModelAllowed)
		.map((model) => model.id);
	const candidateModelId = activeSupervisorModelId
		? canonicalPiModelId(activeSupervisorModelId, piModels)
		: requestedModelId
			? canonicalPiModelId(requestedModelId, piModels)
			: null;

	if (allowAllModels || !candidateModelId) {
		return {
			assignedProvider: "pi",
			assignedModelId: candidateModelId,
			requestedModelId,
			resolvedModelId: candidateModelId,
			fallbackUsed: false,
			policyApplied: false,
			allowedModelIds: allowAllModels
				? piModels.map((model) => model.id)
				: allowedModelIds,
			suggestedModelIds: candidateModelId ? [candidateModelId] : [],
		};
	}

	const candidateModel = piModels.find(
		(model) => model.id === candidateModelId,
	);
	const candidateAllowed = candidateModel
		? isDefaultGoalAssigneePiModelAllowed(candidateModel)
		: isDefaultAllowedPiModelId(candidateModelId);
	const resolvedModelId = candidateAllowed
		? candidateModelId
		: (allowedModelIds[0] ?? null);

	return {
		assignedProvider: "pi",
		assignedModelId: resolvedModelId,
		requestedModelId,
		resolvedModelId,
		fallbackUsed: resolvedModelId !== candidateModelId,
		policyApplied: true,
		allowedModelIds,
		suggestedModelIds: resolvedModelId ? [resolvedModelId] : [],
	};
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

function piModelProviderKey(
	model: Pick<AgentModelOption, "id" | "cliModel" | "providerKey">,
): string {
	return (
		model.providerKey ??
		model.cliModel.split("/", 1)[0] ??
		stripPiPrefix(model.id).split("/", 1)[0] ??
		"unknown"
	).trim();
}

function isDefaultAllowedPiModelId(modelId: string): boolean {
	const cliModel = stripPiPrefix(canonicalizeLegacyId(modelId));
	if (cliModel.startsWith("gpt-")) return true;
	const providerKey = cliModel.split("/", 1)[0] ?? "";
	return DEFAULT_ALLOWED_GOAL_ASSIGNEE_PI_PROVIDERS.has(providerKey);
}
