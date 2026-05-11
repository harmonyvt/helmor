import type { ProviderModelInfo } from "./session-manager.js";

const CODEX_EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const;

const PI_EFFORT_LEVELS = ["minimal", "low", "medium", "high"] as const;
const PI_EFFORT_LEVELS_WITH_XHIGH = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

const MODEL_CATALOG: Record<
	"claude" | "codex" | "pi",
	readonly ProviderModelInfo[]
> = {
	claude: [
		{
			id: "default",
			label: "Opus 4.7 1M",
			cliModel: "default",
			effortLevels: ["low", "medium", "high", "xhigh", "max"],
		},
		{
			id: "claude-opus-4-6[1m]",
			label: "Opus 4.6 1M",
			cliModel: "claude-opus-4-6[1m]",
			effortLevels: ["low", "medium", "high", "max"],
			supportsFastMode: true,
		},
		{
			id: "sonnet",
			label: "Sonnet",
			cliModel: "sonnet",
			effortLevels: ["low", "medium", "high", "max"],
		},
		{
			id: "haiku",
			label: "Haiku",
			cliModel: "haiku",
			effortLevels: [],
		},
	],
	codex: [
		{
			id: "gpt-5.5",
			label: "GPT-5.5",
			cliModel: "gpt-5.5",
			effortLevels: CODEX_EFFORT_LEVELS,
			supportsFastMode: true,
		},
		{
			id: "gpt-5.4",
			label: "GPT-5.4",
			cliModel: "gpt-5.4",
			effortLevels: CODEX_EFFORT_LEVELS,
			supportsFastMode: true,
		},
		{
			id: "gpt-5.4-mini",
			label: "GPT-5.4-Mini",
			cliModel: "gpt-5.4-mini",
			effortLevels: CODEX_EFFORT_LEVELS,
			supportsFastMode: true,
		},
		{
			id: "gpt-5.3-codex",
			label: "GPT-5.3-Codex",
			cliModel: "gpt-5.3-codex",
			effortLevels: CODEX_EFFORT_LEVELS,
			supportsFastMode: true,
		},
		{
			id: "gpt-5.3-codex-spark",
			label: "GPT-5.3-Codex-Spark",
			cliModel: "gpt-5.3-codex-spark",
			effortLevels: CODEX_EFFORT_LEVELS,
			supportsFastMode: true,
		},
		{
			id: "gpt-5.2",
			label: "GPT-5.2",
			cliModel: "gpt-5.2",
			effortLevels: CODEX_EFFORT_LEVELS,
			supportsFastMode: true,
		},
	],
	pi: [
		{
			id: "pi:anthropic/claude-opus-4-7",
			label: "Pi · Claude Opus 4.7",
			cliModel: "anthropic/claude-opus-4-7",
			effortLevels: PI_EFFORT_LEVELS_WITH_XHIGH,
		},
		{
			id: "pi:anthropic/claude-sonnet-4-6",
			label: "Pi · Claude Sonnet 4.6",
			cliModel: "anthropic/claude-sonnet-4-6",
			effortLevels: PI_EFFORT_LEVELS,
		},
		{
			id: "pi:azure-openai-responses/gpt-5.5",
			label: "Pi · GPT-5.5",
			cliModel: "azure-openai-responses/gpt-5.5",
			effortLevels: PI_EFFORT_LEVELS_WITH_XHIGH,
		},
		{
			id: "pi:azure-openai-responses/gpt-5.4",
			label: "Pi · GPT-5.4",
			cliModel: "azure-openai-responses/gpt-5.4",
			effortLevels: PI_EFFORT_LEVELS_WITH_XHIGH,
		},
		{
			id: "pi:azure-openai-responses/gpt-5.4-mini",
			label: "Pi · GPT-5.4-Mini",
			cliModel: "azure-openai-responses/gpt-5.4-mini",
			effortLevels: PI_EFFORT_LEVELS_WITH_XHIGH,
		},
		{
			id: "pi:azure-openai-responses/gpt-5.3-codex",
			label: "Pi · GPT-5.3-Codex",
			cliModel: "azure-openai-responses/gpt-5.3-codex",
			effortLevels: PI_EFFORT_LEVELS_WITH_XHIGH,
		},
	],
};

export function listProviderModels(
	provider: "claude" | "codex" | "pi",
): ProviderModelInfo[] {
	return MODEL_CATALOG[provider].map((model) => ({ ...model }));
}

export function modelSupportsFastMode(
	provider: "claude" | "codex" | "pi",
	modelId: string | undefined | null,
): boolean {
	if (!modelId) return false;
	return MODEL_CATALOG[provider].some(
		(model) => model.id === modelId && model.supportsFastMode === true,
	);
}
