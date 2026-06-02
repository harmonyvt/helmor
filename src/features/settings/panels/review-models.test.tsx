import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentModelSection } from "@/lib/api";
import { createHelmorQueryClient, helmorQueryKeys } from "@/lib/query-client";
import { DEFAULT_SETTINGS, SettingsContext } from "@/lib/settings";
import { renderWithProviders } from "@/test/render-with-providers";
import { DiffSummaryModelRow, PrCommentReviewModelRow } from "./review-models";

const modelSections: AgentModelSection[] = [
	{
		id: "codex",
		label: "Codex",
		status: "ready",
		options: [
			{
				id: "gpt-5.5",
				provider: "codex",
				label: "GPT-5.5",
				cliModel: "gpt-5.5",
				supportsContextUsage: false,
			},
		],
	},
	{
		id: "pi",
		label: "Pi",
		status: "ready",
		options: [
			{
				id: "pi:azure-openai-responses/gpt-5.5",
				provider: "pi",
				label: "Pi · GPT-5.5",
				cliModel: "azure-openai-responses/gpt-5.5",
				providerKey: "azure-openai-responses",
				supportsContextUsage: false,
			},
		],
	},
];

function renderSettingsRow(row: ReactElement, updateSettings = vi.fn()) {
	const queryClient = createHelmorQueryClient();
	queryClient.setQueryData(helmorQueryKeys.agentModelSections, modelSections);

	renderWithProviders(
		<SettingsContext.Provider
			value={{
				settings: DEFAULT_SETTINGS,
				isLoaded: true,
				updateSettings,
			}}
		>
			{row}
		</SettingsContext.Provider>,
		{ queryClient },
	);

	return { updateSettings };
}

describe("review model settings rows", () => {
	afterEach(() => {
		cleanup();
	});

	it("limits the Diff review model picker to Pi models", async () => {
		const user = userEvent.setup();
		const { updateSettings } = renderSettingsRow(<DiffSummaryModelRow />);

		await user.click(
			screen.getByRole("button", { name: "Select Diff review Pi model" }),
		);

		const menu = screen.getByRole("menu");
		expect(within(menu).getByText("Pi · GPT-5.5")).toBeInTheDocument();
		expect(within(menu).queryByText("GPT-5.5")).not.toBeInTheDocument();

		await user.click(within(menu).getByText("Pi · GPT-5.5"));
		expect(updateSettings).toHaveBeenCalledWith({
			diffSummaryModelId: "pi:azure-openai-responses/gpt-5.5",
		});
	});

	it("keeps the PR comment review picker able to choose any model", async () => {
		const user = userEvent.setup();
		const { updateSettings } = renderSettingsRow(<PrCommentReviewModelRow />);

		await user.click(
			screen.getByRole("button", { name: "Select PR comment review model" }),
		);

		const menu = screen.getByRole("menu");
		await user.click(within(menu).getByText("GPT-5.5"));
		expect(updateSettings).toHaveBeenCalledWith({
			prCommentReviewModelId: "gpt-5.5",
		});
	});
});
