import type { AgentModelOption } from "@/lib/api";

const SAFE_PI_FALLBACK_MODEL_ID = "pi:anthropic/claude-opus-4-7";
const LEGACY_OPENAI_CODEX_PREFIX = "openai-codex/";
const AZURE_OPENAI_RESPONSES_PREFIX = "azure-openai-responses/";

type ResolvePiHandoffModelInput = {
	assignedProvider?: string | null;
	assignedModelId?: string | null;
	allowedModelIds: readonly string[];
	piModels: readonly AgentModelOption[];
};

export type PiHandoffModelResolution = {
	assignedProvider: string | null;
	assignedModelId: string | null;
	requestedModelId: string | null;
	resolvedModelId: string | null;
	fallbackUsed: boolean;
	policyApplied: boolean;
	allowedModelIds: string[];
	suggestedModelIds: string[];
};

export function resolvePiHandoffModel({
	assignedProvider,
	assignedModelId,
	allowedModelIds,
	piModels,
}: ResolvePiHandoffModelInput): PiHandoffModelResolution {
	const provider = normalizeProvider(
		assignedProvider,
		assignedModelId,
		piModels,
	);
	if (provider !== "pi") {
		return {
			assignedProvider: assignedProvider ?? null,
			assignedModelId: assignedModelId ?? null,
			requestedModelId: assignedModelId ?? null,
			resolvedModelId: assignedModelId ?? null,
			fallbackUsed: false,
			policyApplied: false,
			allowedModelIds: normalizeAllowedModelIds(allowedModelIds),
			suggestedModelIds: [],
		};
	}

	const allowed = normalizeAllowedModelIds(allowedModelIds);
	const suggested = preferredAllowedModels(allowed, piModels);
	const policyApplied = allowed.length > 0;
	const requested = assignedModelId?.trim() || null;
	const requestedCanonical = requested
		? canonicalPiModelId(requested, piModels)
		: null;
	let resolvedModelId = requestedCanonical;
	let fallbackUsed = false;

	if (!resolvedModelId) {
		resolvedModelId = pickFallbackModelId(suggested, piModels);
		fallbackUsed = requested !== null;
	}

	if (
		policyApplied &&
		resolvedModelId &&
		!new Set(allowed).has(resolvedModelId)
	) {
		resolvedModelId = pickFallbackModelId(suggested, piModels);
		fallbackUsed = true;
	}

	return {
		assignedProvider: "pi",
		assignedModelId: resolvedModelId,
		requestedModelId: requested,
		resolvedModelId,
		fallbackUsed,
		policyApplied,
		allowedModelIds: allowed,
		suggestedModelIds: suggested,
	};
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

function normalizeProvider(
	assignedProvider: string | null | undefined,
	assignedModelId: string | null | undefined,
	piModels: readonly AgentModelOption[],
): string | null {
	const provider = assignedProvider?.trim() || null;
	if (provider) return provider;
	if (assignedModelId && canonicalPiModelId(assignedModelId, piModels)) {
		return "pi";
	}
	return null;
}

function normalizeAllowedModelIds(modelIds: readonly string[]): string[] {
	return Array.from(
		new Set(
			modelIds
				.map((id) => canonicalizeLegacyId(id).trim())
				.filter((id) => id.startsWith("pi:")),
		),
	);
}

function preferredAllowedModels(
	allowedModelIds: readonly string[],
	piModels: readonly AgentModelOption[],
): string[] {
	if (allowedModelIds.length === 0) return [];
	const allowed = new Set(allowedModelIds);
	const inCatalogOrder = piModels
		.map((model) => model.id)
		.filter((id) => allowed.has(id));
	const catalogIds = new Set(inCatalogOrder);
	return [
		...inCatalogOrder,
		...allowedModelIds.filter((id) => !catalogIds.has(id)),
	];
}

function pickFallbackModelId(
	suggestedModelIds: readonly string[],
	piModels: readonly AgentModelOption[],
): string {
	return suggestedModelIds[0] ?? piModels[0]?.id ?? SAFE_PI_FALLBACK_MODEL_ID;
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
