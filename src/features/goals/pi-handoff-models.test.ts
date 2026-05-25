import { describe, expect, it } from "vitest";
import type { AgentModelOption, AgentModelSection } from "@/lib/api";
import {
	canonicalPiModelId,
	isDefaultGoalAssigneePiModelAllowed,
	listGoalAssigneePiModels,
	resolveGoalAssigneePiHandoffModel,
} from "./pi-handoff-models";

const piModels: AgentModelOption[] = [
	{
		id: "pi:anthropic/claude-sonnet-4-6",
		provider: "pi",
		label: "Pi · Claude Sonnet 4.6",
		cliModel: "anthropic/claude-sonnet-4-6",
		supportsContextUsage: false,
	},
	{
		id: "pi:anthropic/claude-haiku-4-5",
		provider: "pi",
		label: "Pi · Claude Haiku 4.5",
		cliModel: "anthropic/claude-haiku-4-5",
		supportsContextUsage: false,
	},
	{
		id: "pi:azure-openai-responses/gpt-5.5",
		provider: "pi",
		label: "Pi · GPT-5.5",
		cliModel: "azure-openai-responses/gpt-5.5",
		supportsContextUsage: false,
	},
	{
		id: "pi:moonshot/kimi-k2",
		provider: "pi",
		label: "Pi · Kimi K2",
		cliModel: "moonshot/kimi-k2",
		providerKey: "moonshot",
		supportsContextUsage: false,
	},
];

const modelSections: AgentModelSection[] = [
	{
		id: "claude",
		label: "Claude Code",
		options: [
			{
				id: "claude-sonnet-4-6",
				provider: "claude",
				label: "Sonnet 4.6",
				cliModel: "claude-sonnet-4-6",
				supportsContextUsage: true,
			},
			{
				id: "claude-haiku-4-5",
				provider: "claude",
				label: "Haiku 4.5",
				cliModel: "claude-haiku-4-5",
				supportsContextUsage: true,
			},
		],
	},
	{
		id: "codex",
		label: "Codex",
		options: [
			{
				id: "gpt-5.5",
				provider: "codex",
				label: "GPT-5.5",
				cliModel: "gpt-5.5",
				supportsContextUsage: true,
			},
		],
	},
	{ id: "pi", label: "Pi", options: piModels },
];

describe("canonicalPiModelId", () => {
	it("canonicalizes raw Pi cli model ids", () => {
		expect(canonicalPiModelId("azure-openai-responses/gpt-5.5", piModels)).toBe(
			"pi:azure-openai-responses/gpt-5.5",
		);
	});

	it("maps legacy openai-codex Pi ids to azure-openai-responses", () => {
		expect(canonicalPiModelId("pi:openai-codex/gpt-5.5", piModels)).toBe(
			"pi:azure-openai-responses/gpt-5.5",
		);
	});

	it("maps bare GPT model ids to the Pi Azure OpenAI Responses namespace", () => {
		expect(canonicalPiModelId("gpt-5.5", piModels)).toBe(
			"pi:azure-openai-responses/gpt-5.5",
		);
	});
});

describe("isDefaultGoalAssigneePiModelAllowed", () => {
	it("allows Anthropic and Codex-backed Pi models by default", () => {
		expect(isDefaultGoalAssigneePiModelAllowed(piModels[0])).toBe(true);
		expect(isDefaultGoalAssigneePiModelAllowed(piModels[1])).toBe(true);
		expect(isDefaultGoalAssigneePiModelAllowed(piModels[2])).toBe(true);
	});

	it("rejects other Pi providers by default", () => {
		expect(isDefaultGoalAssigneePiModelAllowed(piModels[3])).toBe(false);
	});
});

describe("resolveGoalAssigneePiHandoffModel", () => {
	it("uses the requested model when it is available under the default policy", () => {
		expect(
			resolveGoalAssigneePiHandoffModel({
				requestedModelId: "pi:azure-openai-responses/gpt-5.5",
				modelSections,
				piModels,
				allowAllModels: false,
			}),
		).toEqual(
			expect.objectContaining({
				assignedModelId: "pi:azure-openai-responses/gpt-5.5",
				resolvedModelId: "pi:azure-openai-responses/gpt-5.5",
				fallbackUsed: false,
				policyApplied: true,
			}),
		);
	});

	it("does not guess a model when no requested model is provided", () => {
		expect(
			resolveGoalAssigneePiHandoffModel({
				requestedModelId: null,
				modelSections,
				piModels,
				allowAllModels: false,
			}),
		).toEqual(
			expect.objectContaining({
				assignedModelId: null,
				resolvedModelId: null,
				fallbackUsed: false,
				policyApplied: true,
				suggestedModelIds: [
					"pi:azure-openai-responses/gpt-5.5",
					"pi:anthropic/claude-sonnet-4-6",
					"pi:anthropic/claude-haiku-4-5",
				],
				allowedModelIds: [
					"pi:azure-openai-responses/gpt-5.5",
					"pi:anthropic/claude-sonnet-4-6",
					"pi:anthropic/claude-haiku-4-5",
				],
			}),
		);
	});

	it("rejects a requested model that is not backed by currently available Claude or Codex models", () => {
		const sectionsWithoutCodexGpt55 = modelSections.map((section) =>
			section.id === "codex" ? { ...section, options: [] } : section,
		);

		expect(
			resolveGoalAssigneePiHandoffModel({
				requestedModelId: "pi:azure-openai-responses/gpt-5.5",
				modelSections: sectionsWithoutCodexGpt55,
				piModels,
				allowAllModels: false,
			}),
		).toEqual(
			expect.objectContaining({
				assignedModelId: null,
				resolvedModelId: null,
				fallbackUsed: false,
				allowedModelIds: [
					"pi:anthropic/claude-sonnet-4-6",
					"pi:anthropic/claude-haiku-4-5",
				],
				suggestedModelIds: [
					"pi:anthropic/claude-sonnet-4-6",
					"pi:anthropic/claude-haiku-4-5",
				],
			}),
		);
	});

	it("lists available assignee models in best-first order", () => {
		expect(
			listGoalAssigneePiModels({
				modelSections,
				piModels,
				allowAllModels: false,
			}).map((model) => model.id),
		).toEqual([
			"pi:azure-openai-responses/gpt-5.5",
			"pi:anthropic/claude-sonnet-4-6",
			"pi:anthropic/claude-haiku-4-5",
		]);
	});

	it("allows any Pi model when the override is enabled", () => {
		expect(
			resolveGoalAssigneePiHandoffModel({
				requestedModelId: "pi:moonshot/kimi-k2",
				modelSections,
				piModels,
				allowAllModels: true,
			}),
		).toEqual(
			expect.objectContaining({
				assignedModelId: "pi:moonshot/kimi-k2",
				resolvedModelId: "pi:moonshot/kimi-k2",
				fallbackUsed: false,
				policyApplied: false,
			}),
		);
	});
});
