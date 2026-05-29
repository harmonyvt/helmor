import type { AgentModelOption, AgentModelSection } from "@/lib/api";

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

export function listGoalAssigneePiModels({
	modelSections,
	piModels,
	allowAllModels,
}: {
	modelSections: readonly AgentModelSection[];
	piModels: readonly AgentModelOption[];
	allowAllModels: boolean;
}): AgentModelOption[] {
	const eligibleModels = allowAllModels
		? [...piModels]
		: piModels.filter((model) =>
				isDefaultGoalAssigneePiModelAllowed(model, modelSections),
			);
	return eligibleModels.sort(compareGoalAssigneePiModels);
}

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
	modelSections: readonly AgentModelSection[] = [],
): boolean {
	const providerKey = piModelProviderKey(model);
	if (!DEFAULT_ALLOWED_GOAL_ASSIGNEE_PI_PROVIDERS.has(providerKey)) {
		return false;
	}
	if (modelSections.length === 0) return true;
	return isBackedByAvailableClaudeOrCodexModel(model, modelSections);
}

export function resolveGoalAssigneePiHandoffModel({
	requestedModelId,
	modelSections,
	piModels,
	allowAllModels,
}: {
	requestedModelId: string | null;
	modelSections: readonly AgentModelSection[];
	piModels: readonly AgentModelOption[];
	allowAllModels: boolean;
}): PiHandoffModelPolicyResult {
	const allowedModelIds = listGoalAssigneePiModels({
		modelSections,
		piModels,
		allowAllModels: false,
	}).map((model) => model.id);
	const candidateModelId = requestedModelId
		? canonicalPiModelId(requestedModelId, piModels)
		: null;

	if (allowAllModels) {
		const allModelIds = listGoalAssigneePiModels({
			modelSections,
			piModels,
			allowAllModels: true,
		}).map((model) => model.id);
		return {
			assignedProvider: "pi",
			assignedModelId: candidateModelId,
			requestedModelId,
			resolvedModelId: candidateModelId,
			fallbackUsed: false,
			policyApplied: false,
			allowedModelIds: allModelIds,
			suggestedModelIds: candidateModelId ? [candidateModelId] : [],
		};
	}

	if (!candidateModelId) {
		return {
			assignedProvider: "pi",
			assignedModelId: null,
			requestedModelId,
			resolvedModelId: null,
			fallbackUsed: false,
			policyApplied: true,
			allowedModelIds,
			suggestedModelIds: allowedModelIds,
		};
	}

	const candidateModel = piModels.find(
		(model) => model.id === candidateModelId,
	);
	const candidateAllowed = candidateModel
		? isDefaultGoalAssigneePiModelAllowed(candidateModel, modelSections)
		: isDefaultAllowedPiModelId(candidateModelId, modelSections);
	const resolvedModelId = candidateAllowed ? candidateModelId : null;

	return {
		assignedProvider: "pi",
		assignedModelId: resolvedModelId,
		requestedModelId,
		resolvedModelId,
		fallbackUsed: false,
		policyApplied: true,
		allowedModelIds,
		suggestedModelIds: candidateAllowed ? [candidateModelId] : allowedModelIds,
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

function isDefaultAllowedPiModelId(
	modelId: string,
	modelSections: readonly AgentModelSection[],
): boolean {
	const cliModel = stripPiPrefix(canonicalizeLegacyId(modelId));
	const providerKey = cliModel.split("/", 1)[0] ?? "";
	if (!DEFAULT_ALLOWED_GOAL_ASSIGNEE_PI_PROVIDERS.has(providerKey)) {
		return false;
	}
	return isBackedByAvailableClaudeOrCodexModel(
		{
			id: modelId,
			cliModel,
			providerKey,
		},
		modelSections,
	);
}

function isBackedByAvailableClaudeOrCodexModel(
	model: Pick<AgentModelOption, "id" | "cliModel" | "providerKey">,
	modelSections: readonly AgentModelSection[],
): boolean {
	const providerKey = piModelProviderKey(model);
	const cliModel = stripPiPrefix(
		canonicalizeLegacyId(model.cliModel || model.id),
	);
	const bareModelId = cliModel.split("/").at(-1) ?? cliModel;

	if (
		providerKey === AZURE_OPENAI_RESPONSES_PREFIX.slice(0, -1) ||
		providerKey === LEGACY_OPENAI_CODEX_PREFIX.slice(0, -1) ||
		bareModelId.startsWith("gpt-")
	) {
		return sectionHasModel(modelSections, "codex", bareModelId);
	}

	if (providerKey === "anthropic") {
		return sectionHasModel(modelSections, "claude", bareModelId);
	}

	return false;
}

function sectionHasModel(
	modelSections: readonly AgentModelSection[],
	sectionId: "claude" | "codex",
	targetModel: string,
): boolean {
	const section = modelSections.find((entry) => entry.id === sectionId);
	if (!section) return false;
	return section.options.some((option) =>
		modelMatchesProviderOption(option, targetModel),
	);
}

function modelMatchesProviderOption(
	option: Pick<AgentModelOption, "id" | "cliModel" | "label">,
	targetModel: string,
): boolean {
	const normalizedTarget = normalizeProviderModelId(targetModel);
	if (normalizedTarget === "claude-opus-4-8") {
		return (
			option.id === "default" ||
			option.cliModel === "default" ||
			normalizeProviderModelId(option.label).includes("opus-4-8")
		);
	}
	if (normalizedTarget.startsWith("claude-sonnet-")) {
		return (
			option.id === "sonnet" ||
			option.cliModel === "sonnet" ||
			normalizeProviderModelId(option.label).includes("sonnet")
		);
	}
	if (normalizedTarget.startsWith("claude-haiku-")) {
		return (
			option.id === "haiku" ||
			option.cliModel === "haiku" ||
			normalizeProviderModelId(option.label).includes("haiku")
		);
	}
	return [option.id, option.cliModel, option.label].some(
		(value) => normalizeProviderModelId(value) === normalizedTarget,
	);
}

function normalizeProviderModelId(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/^pi:/, "")
		.split("/")
		.at(-1)!
		.replace(/\[.*?\]/g, "")
		.replace(/[^a-z0-9.]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function compareGoalAssigneePiModels(
	left: Pick<AgentModelOption, "id" | "cliModel" | "providerKey">,
	right: Pick<AgentModelOption, "id" | "cliModel" | "providerKey">,
): number {
	return goalAssigneeModelRank(left) - goalAssigneeModelRank(right);
}

function goalAssigneeModelRank(
	model: Pick<AgentModelOption, "id" | "cliModel" | "providerKey">,
): number {
	const cliModel = stripPiPrefix(
		canonicalizeLegacyId(model.cliModel || model.id),
	);
	const bareModelId = cliModel.split("/").at(-1) ?? cliModel;
	const providerKey = piModelProviderKey(model);

	const codexRank = [
		"gpt-5.5",
		"gpt-5.4",
		"gpt-5.3-codex",
		"gpt-5.4-mini",
		"gpt-5.3-codex-spark",
		"gpt-5.2",
	].indexOf(bareModelId);
	if (codexRank >= 0) return codexRank;

	const claudeRank = [
		"claude-opus-4-8",
		"claude-opus-4-7",
		"claude-opus-4-6",
		"claude-sonnet-4-6",
		"claude-haiku-4-5",
		"sonnet",
		"haiku",
	].indexOf(bareModelId);
	if (claudeRank >= 0) return 100 + claudeRank;

	if (providerKey === "anthropic") return 150;
	return 1_000;
}
