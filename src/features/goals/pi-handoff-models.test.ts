import { describe, expect, it } from "vitest";
import type { AgentModelOption, AgentModelSection } from "@/lib/api";
import {
	canonicalPiModelId,
	isDefaultGoalAssigneePiModelAllowed,
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
				id: "sonnet",
				provider: "claude",
				label: "Sonnet",
				cliModel: "sonnet",
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
	});

	it("rejects other Pi providers by default", () => {
		expect(isDefaultGoalAssigneePiModelAllowed(piModels[2])).toBe(false);
	});
});

describe("resolveGoalAssigneePiHandoffModel", () => {
	it("keeps an allowed active supervisor model under the default policy", () => {
		expect(
			resolveGoalAssigneePiHandoffModel({
				activeSupervisorModelId: "pi:azure-openai-responses/gpt-5.5",
				requestedModelId: null,
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

	it("falls back from a disallowed active supervisor model to the best available allowed model", () => {
		expect(
			resolveGoalAssigneePiHandoffModel({
				activeSupervisorModelId: "pi:moonshot/kimi-k2",
				requestedModelId: null,
				modelSections,
				piModels,
				allowAllModels: false,
			}),
		).toEqual(
			expect.objectContaining({
				assignedModelId: "pi:azure-openai-responses/gpt-5.5",
				resolvedModelId: "pi:azure-openai-responses/gpt-5.5",
				fallbackUsed: true,
				policyApplied: true,
				allowedModelIds: [
					"pi:azure-openai-responses/gpt-5.5",
					"pi:anthropic/claude-sonnet-4-6",
				],
			}),
		);
	});

	it("excludes Pi models that are not backed by currently available Claude or Codex models", () => {
		const sectionsWithoutCodexGpt55 = modelSections.map((section) =>
			section.id === "codex" ? { ...section, options: [] } : section,
		);

		expect(
			resolveGoalAssigneePiHandoffModel({
				activeSupervisorModelId: "pi:azure-openai-responses/gpt-5.5",
				requestedModelId: null,
				modelSections: sectionsWithoutCodexGpt55,
				piModels,
				allowAllModels: false,
			}),
		).toEqual(
			expect.objectContaining({
				assignedModelId: "pi:anthropic/claude-sonnet-4-6",
				resolvedModelId: "pi:anthropic/claude-sonnet-4-6",
				fallbackUsed: true,
				allowedModelIds: ["pi:anthropic/claude-sonnet-4-6"],
			}),
		);
	});

	it("uses the best available allowed model when no supervisor model is known", () => {
		expect(
			resolveGoalAssigneePiHandoffModel({
				activeSupervisorModelId: null,
				requestedModelId: null,
				modelSections,
				piModels,
				allowAllModels: false,
			}),
		).toEqual(
			expect.objectContaining({
				assignedModelId: "pi:azure-openai-responses/gpt-5.5",
				resolvedModelId: "pi:azure-openai-responses/gpt-5.5",
				policyApplied: true,
			}),
		);
	});

	it("allows any Pi model when the override is enabled", () => {
		expect(
			resolveGoalAssigneePiHandoffModel({
				activeSupervisorModelId: "pi:moonshot/kimi-k2",
				requestedModelId: null,
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
