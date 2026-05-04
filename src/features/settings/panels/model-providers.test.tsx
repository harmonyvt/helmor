import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModelSection } from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import { renderWithProviders } from "@/test/render-with-providers";

const apiMocks = vi.hoisted(() => ({
	checkPiModels: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		checkPiModels: apiMocks.checkPiModels,
	};
});

import { PiModelsCheckPanel } from "./model-providers";

const staticSections: AgentModelSection[] = [
	{
		id: "claude",
		label: "Claude Code",
		status: "ready",
		options: [],
	},
	{
		id: "pi",
		label: "Pi",
		status: "ready",
		options: [
			{
				id: "pi:anthropic/static",
				provider: "pi",
				label: "Pi · Static",
				cliModel: "anthropic/static",
				supportsContextUsage: false,
			},
		],
	},
];

describe("PiModelsCheckPanel", () => {
	beforeEach(() => {
		apiMocks.checkPiModels.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("updates the agent model cache with checked Pi models", async () => {
		const user = userEvent.setup();
		apiMocks.checkPiModels.mockResolvedValue({
			status: "ready",
			providers: [
				{
					key: "anthropic",
					label: "Anthropic",
					modelCount: 1,
				},
			],
			models: [
				{
					id: "pi:anthropic/claude-sonnet-4-6",
					provider: "pi",
					label: "Pi · Claude Sonnet 4.6",
					cliModel: "anthropic/claude-sonnet-4-6",
					providerKey: "anthropic",
					effortLevels: [],
					supportsFastMode: false,
					supportsContextUsage: false,
				},
			],
			error: null,
		});

		const { queryClient } = renderWithProviders(<PiModelsCheckPanel />);
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			staticSections,
		);

		await user.click(screen.getByRole("button", { name: "Check Pi" }));

		expect(await screen.findByText("1 Pi models")).toBeInTheDocument();
		expect(screen.getByText("Anthropic · 1")).toBeInTheDocument();
		expect(screen.getByText("Pi · Claude Sonnet 4.6")).toBeInTheDocument();

		const sections = queryClient.getQueryData<AgentModelSection[]>(
			helmorQueryKeys.agentModelSections,
		);
		expect(sections?.find((section) => section.id === "pi")?.options).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "pi:anthropic/claude-sonnet-4-6",
					cliModel: "anthropic/claude-sonnet-4-6",
				}),
			]),
		);
	});

	it("keeps static fallback models when Pi returns no models", async () => {
		const user = userEvent.setup();
		apiMocks.checkPiModels.mockResolvedValue({
			status: "ready",
			providers: [],
			models: [],
			error: null,
		});

		const { queryClient } = renderWithProviders(<PiModelsCheckPanel />);
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			staticSections,
		);

		await user.click(screen.getByRole("button", { name: "Check Pi" }));

		expect(
			await screen.findByText(/No Pi models are currently available/),
		).toBeInTheDocument();
		expect(
			queryClient
				.getQueryData<AgentModelSection[]>(helmorQueryKeys.agentModelSections)
				?.find((section) => section.id === "pi")?.options,
		).toEqual(staticSections[1]?.options);
	});

	it("shows check errors inline", async () => {
		const user = userEvent.setup();
		apiMocks.checkPiModels.mockRejectedValue(new Error("Pi exploded"));

		renderWithProviders(<PiModelsCheckPanel />);

		await user.click(screen.getByRole("button", { name: "Check Pi" }));

		await waitFor(() =>
			expect(screen.getByText("Pi exploded")).toBeInTheDocument(),
		);
	});
});
