import { useQuery } from "@tanstack/react-query";
import { PiHandoffModelSelector } from "@/features/goals/pi-handoff-model-selector";
import { agentModelSectionsQueryOptions } from "@/lib/query-client";
import { useSettings } from "@/lib/settings";
import { SettingsRow } from "../components/settings-row";

export function PiHandoffModelsPanel() {
	const { settings, updateSettings } = useSettings();
	const modelSectionsQuery = useQuery(agentModelSectionsQueryOptions());
	const piModels =
		modelSectionsQuery.data?.find((section) => section.id === "pi")?.options ??
		[];

	return (
		<SettingsRow
			title="Goal handoff models"
			description="Limit which Pi models Goals can assign to child workspaces. With no limit, Helmor forwards the supervisor model after canonicalizing it for Pi."
			align="start"
			className="gap-8"
		>
			<PiHandoffModelSelector
				className="w-[360px]"
				piModels={piModels}
				selectedIds={settings.piHandoffModelIds}
				onSelectedIdsChange={(piHandoffModelIds) =>
					updateSettings({ piHandoffModelIds })
				}
			/>
		</SettingsRow>
	);
}
