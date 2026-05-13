import type { AgentModelOption } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { PiHandoffModelSelector } from "../pi-handoff-model-selector";

type HandoffModelsViewProps = {
	piModels: readonly AgentModelOption[];
};

export function HandoffModelsView({ piModels }: HandoffModelsViewProps) {
	const { settings, updateSettings } = useSettings();

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
			<div className="space-y-1.5">
				<h3 className="font-medium text-sm">Allowed handoff models</h3>
				<p className="text-[12px] leading-snug text-muted-foreground">
					Choose which Pi models Goals can assign when it creates or reroutes
					child workspaces. Leave unrestricted to allow the current Pi
					supervisor model after Helmor canonicalizes it.
				</p>
			</div>
			<PiHandoffModelSelector
				piModels={piModels}
				selectedIds={settings.piHandoffModelIds}
				onSelectedIdsChange={(piHandoffModelIds) =>
					updateSettings({ piHandoffModelIds })
				}
				contentAlign="start"
			/>
		</div>
	);
}
