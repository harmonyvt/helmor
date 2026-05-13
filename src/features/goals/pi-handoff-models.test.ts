import { describe, expect, it } from "vitest";
import type { AgentModelOption } from "@/lib/api";
import { canonicalPiModelId, resolvePiHandoffModel } from "./pi-handoff-models";

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
});

describe("resolvePiHandoffModel", () => {
	it("keeps the requested Pi model when it is allowed", () => {
		expect(
			resolvePiHandoffModel({
				assignedProvider: "pi",
				assignedModelId: "anthropic/claude-sonnet-4-6",
				allowedModelIds: ["pi:anthropic/claude-sonnet-4-6"],
				piModels,
			}),
		).toMatchObject({
			assignedProvider: "pi",
			assignedModelId: "pi:anthropic/claude-sonnet-4-6",
			fallbackUsed: false,
			policyApplied: true,
		});
	});

	it("falls back to an allowed model when the requested Pi model is blocked", () => {
		expect(
			resolvePiHandoffModel({
				assignedProvider: "pi",
				assignedModelId: "azure-openai-responses/gpt-5.5",
				allowedModelIds: ["pi:anthropic/claude-sonnet-4-6"],
				piModels,
			}),
		).toMatchObject({
			assignedProvider: "pi",
			requestedModelId: "azure-openai-responses/gpt-5.5",
			resolvedModelId: "pi:anthropic/claude-sonnet-4-6",
			fallbackUsed: true,
			policyApplied: true,
		});
	});

	it("canonicalizes unrestricted Pi handoffs instead of forwarding raw cli ids", () => {
		expect(
			resolvePiHandoffModel({
				assignedProvider: "pi",
				assignedModelId: "azure-openai-responses/gpt-5.5",
				allowedModelIds: [],
				piModels,
			}),
		).toMatchObject({
			assignedModelId: "pi:azure-openai-responses/gpt-5.5",
			fallbackUsed: false,
			policyApplied: false,
		});
	});

	it("does not rewrite non-Pi handoffs", () => {
		expect(
			resolvePiHandoffModel({
				assignedProvider: "claude",
				assignedModelId: "sonnet",
				allowedModelIds: ["pi:anthropic/claude-sonnet-4-6"],
				piModels,
			}),
		).toMatchObject({
			assignedProvider: "claude",
			assignedModelId: "sonnet",
			policyApplied: false,
		});
		expect(
			resolvePiHandoffModel({
				assignedProvider: "codex",
				assignedModelId: "gpt-5.5",
				allowedModelIds: ["pi:anthropic/claude-sonnet-4-6"],
				piModels,
			}),
		).toMatchObject({
			assignedProvider: "codex",
			assignedModelId: "gpt-5.5",
			policyApplied: false,
		});
	});
});
