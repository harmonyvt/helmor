import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentModelSection } from "@/lib/api";
import { createHelmorQueryClient, helmorQueryKeys } from "@/lib/query-client";
import { DEFAULT_SETTINGS, SettingsContext } from "@/lib/settings";
import { renderWithProviders } from "@/test/render-with-providers";
import { PiHandoffModelsPanel } from "./pi-handoff-models";

const sections: AgentModelSection[] = [
	{
		id: "pi",
		label: "Pi",
		status: "ready",
		options: [
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
		],
	},
];

describe("PiHandoffModelsPanel", () => {
	it("turns the unrestricted state into an allowlist when a model is unchecked", async () => {
		const user = userEvent.setup();
		const updateSettings = vi.fn();
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(helmorQueryKeys.agentModelSections, sections);
		renderWithProviders(
			<SettingsContext.Provider
				value={{
					settings: DEFAULT_SETTINGS,
					isLoaded: true,
					updateSettings,
				}}
			>
				<PiHandoffModelsPanel />
			</SettingsContext.Provider>,
			{ queryClient },
		);

		expect(
			screen.getByRole("button", { name: /All Pi models/ }),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /All Pi models/ }));
		await user.click(screen.getByRole("menuitemcheckbox", { name: /GPT-5.5/ }));

		expect(updateSettings).toHaveBeenCalledWith({
			piHandoffModelIds: ["pi:anthropic/claude-sonnet-4-6"],
		});
	});

	it("summarizes selected handoff models", () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(helmorQueryKeys.agentModelSections, sections);
		renderWithProviders(
			<SettingsContext.Provider
				value={{
					settings: {
						...DEFAULT_SETTINGS,
						piHandoffModelIds: ["pi:anthropic/claude-sonnet-4-6"],
					},
					isLoaded: true,
					updateSettings: vi.fn(),
				}}
			>
				<PiHandoffModelsPanel />
			</SettingsContext.Provider>,
			{ queryClient },
		);

		expect(
			screen.getByRole("button", { name: /Pi · Claude Sonnet 4.6/ }),
		).toBeInTheDocument();
	});
});
