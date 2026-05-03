import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AgentModelSection } from "@/lib/api";
import { createHelmorQueryClient, helmorQueryKeys } from "@/lib/query-client";
import { useRefreshPiModels } from "./use-refresh-pi-models";

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

describe("useRefreshPiModels", () => {
	it("refreshes Pi models automatically after the catalog loads", async () => {
		apiMocks.checkPiModels.mockResolvedValue({
			status: "ready",
			providers: [{ key: "anthropic", label: "Anthropic", modelCount: 1 }],
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
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			staticSections,
		);

		renderHook(() => useRefreshPiModels(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={queryClient}>
					{children}
				</QueryClientProvider>
			),
		});

		await waitFor(() => expect(apiMocks.checkPiModels).toHaveBeenCalledOnce());
		await waitFor(() => {
			expect(
				queryClient
					.getQueryData<AgentModelSection[]>(helmorQueryKeys.agentModelSections)
					?.find((section) => section.id === "pi")?.options,
			).toEqual([
				expect.objectContaining({
					id: "pi:anthropic/claude-sonnet-4-6",
				}),
			]);
		});
	});
});
