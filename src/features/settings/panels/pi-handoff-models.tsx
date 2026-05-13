import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { ModelIcon } from "@/components/model-icon";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentModelOption } from "@/lib/api";
import { agentModelSectionsQueryOptions } from "@/lib/query-client";
import { useSettings } from "@/lib/settings";
import { SettingsNotice, SettingsRow } from "../components/settings-row";

export function PiHandoffModelsPanel() {
	const { settings, updateSettings } = useSettings();
	const modelSectionsQuery = useQuery(agentModelSectionsQueryOptions());
	const piModels =
		modelSectionsQuery.data?.find((section) => section.id === "pi")?.options ??
		[];
	const selectedIds = settings.piHandoffModelIds;
	const selected = new Set(selectedIds);
	const missingSelectedIds = selectedIds.filter(
		(id) => !piModels.some((model) => model.id === id),
	);
	const selectedModels = selectedIds
		.map((id) => piModels.find((model) => model.id === id))
		.filter((model): model is AgentModelOption => Boolean(model));
	const summary =
		selectedIds.length === 0
			? "All Pi models"
			: selectedSummary(selectedModels, missingSelectedIds);

	function updateSelected(nextIds: string[]) {
		updateSettings({ piHandoffModelIds: Array.from(new Set(nextIds)) });
	}

	function toggleModel(modelId: string, checked: boolean) {
		if (checked) {
			updateSelected([...selectedIds, modelId]);
			return;
		}
		if (selectedIds.length === 0) {
			updateSelected(
				piModels.map((model) => model.id).filter((id) => id !== modelId),
			);
			return;
		}
		updateSelected(selectedIds.filter((id) => id !== modelId));
	}

	return (
		<SettingsRow
			title="Goal handoff models"
			description="Limit which Pi models Goals can assign to child workspaces. With no limit, Helmor forwards the supervisor model after canonicalizing it for Pi."
			align="start"
			className="gap-8"
		>
			<div className="flex w-[360px] flex-col gap-2.5">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="w-full justify-between gap-2"
						>
							<span className="min-w-0 truncate text-left">{summary}</span>
							<ChevronDown className="size-3.5 shrink-0 opacity-50" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-[360px]">
						<DropdownMenuItem onClick={() => updateSelected([])}>
							Allow all Pi models
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						{piModels.length === 0 ? (
							<div className="px-2 py-1.5 text-[12px] text-muted-foreground">
								Check Pi models first to choose an allowlist.
							</div>
						) : (
							piModels.map((model) => (
								<DropdownMenuCheckboxItem
									key={model.id}
									checked={selectedIds.length === 0 || selected.has(model.id)}
									onCheckedChange={(checked) =>
										toggleModel(model.id, checked === true)
									}
									onSelect={(event) => event.preventDefault()}
									className="gap-2 pr-8"
								>
									<ModelIcon model={model} className="size-3.5" />
									<span className="min-w-0 flex-1 truncate">{model.label}</span>
									<span className="shrink-0 font-mono text-[10px] text-muted-foreground">
										{model.cliModel}
									</span>
								</DropdownMenuCheckboxItem>
							))
						)}
					</DropdownMenuContent>
				</DropdownMenu>

				{selectedIds.length === 0 ? (
					<div className="text-[12px] leading-snug text-muted-foreground">
						All currently available Pi models may be used for handoffs.
					</div>
				) : (
					<div className="flex flex-wrap gap-1.5">
						{selectedModels.map((model) => (
							<span
								key={model.id}
								className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted/45 px-1.5 py-0.5 text-[11px] text-muted-foreground"
							>
								<ModelIcon model={model} className="size-3" />
								<span className="truncate">{model.label}</span>
							</span>
						))}
						{missingSelectedIds.map((id) => (
							<span
								key={id}
								className="inline-flex max-w-full items-center rounded-md bg-muted/45 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
							>
								{id}
							</span>
						))}
					</div>
				)}

				{missingSelectedIds.length > 0 ? (
					<SettingsNotice tone="warn">
						{missingSelectedIds.length} selected model
						{missingSelectedIds.length === 1 ? " is" : "s are"} not in the
						current Pi model list. Handoffs can still use saved ids.
					</SettingsNotice>
				) : null}
			</div>
		</SettingsRow>
	);
}

function selectedSummary(
	selectedModels: readonly AgentModelOption[],
	missingSelectedIds: readonly string[],
): string {
	const count = selectedModels.length + missingSelectedIds.length;
	if (count === 0) return "No Pi models selected";
	if (count === 1)
		return selectedModels[0]?.label ?? missingSelectedIds[0] ?? "1 model";
	return `${count} Pi models allowed`;
}
