import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentModelOption } from "@/lib/api";
import { DEFAULT_SETTINGS, SettingsContext } from "@/lib/settings";
import { renderWithProviders } from "@/test/render-with-providers";
import { HandoffModelsView } from "./handoff-models-view";

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

describe("HandoffModelsView", () => {
	it("manages the Goals handoff model allowlist", async () => {
		const user = userEvent.setup();
		const updateSettings = vi.fn();

		renderWithProviders(
			<SettingsContext.Provider
				value={{
					settings: DEFAULT_SETTINGS,
					isLoaded: true,
					updateSettings,
				}}
			>
				<HandoffModelsView piModels={piModels} />
			</SettingsContext.Provider>,
		);

		expect(screen.getByText("Allowed handoff models")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /All Pi models/ }));
		await user.click(screen.getByRole("menuitemcheckbox", { name: /GPT-5.5/ }));

		expect(updateSettings).toHaveBeenCalledWith({
			piHandoffModelIds: ["pi:anthropic/claude-sonnet-4-6"],
		});
	});
});
