import { useSettings } from "@/lib/settings";
import { ModelOverrideRow } from "./model-override-row";

export function PrCommentReviewModelRow() {
	const { settings, updateSettings } = useSettings();

	return (
		<ModelOverrideRow
			title="PR comment review model"
			description="Provider and model used when Review all starts a session from the Comments tab. Leave on default to use your new-chat model."
			ariaLabel="Select PR comment review model"
			value={settings.prCommentReviewModelId}
			onChange={(modelId) =>
				updateSettings({ prCommentReviewModelId: modelId })
			}
		/>
	);
}
