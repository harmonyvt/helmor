import { useSettings } from "@/lib/settings";
import { ModelOverrideRow } from "./model-override-row";

export function GitChangeSummaryModelRow() {
	const { settings, updateSettings } = useSettings();

	return (
		<ModelOverrideRow
			title="Git change summary model"
			description="Provider and model used when the Summary tab creates an AI summary of workspace changes. Leave on default to use your new-chat model."
			ariaLabel="Select Git change summary model"
			value={settings.gitChangeSummaryModelId}
			onChange={(modelId) =>
				updateSettings({ gitChangeSummaryModelId: modelId })
			}
		/>
	);
}
