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
import { cn } from "@/lib/utils";

type PiHandoffModelSelectorProps = {
	piModels: readonly AgentModelOption[];
	selectedIds: readonly string[];
	onSelectedIdsChange: (selectedIds: string[]) => void;
	className?: string;
	triggerClassName?: string;
	contentAlign?: "start" | "center" | "end";
	unrestrictedDescription?: string;
};

export function PiHandoffModelSelector({
	piModels,
	selectedIds,
	onSelectedIdsChange,
	className,
	triggerClassName,
	contentAlign = "end",
	unrestrictedDescription = "All currently available Pi models may be used for handoffs.",
}: PiHandoffModelSelectorProps) {
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

	function updateSelected(nextIds: readonly string[]) {
		onSelectedIdsChange(Array.from(new Set(nextIds)));
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
		<div className={cn("flex flex-col gap-2.5", className)}>
			<div className="flex items-center gap-2">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className={cn(
								"min-w-0 flex-1 justify-between gap-2",
								triggerClassName,
							)}
						>
							<span className="min-w-0 truncate text-left">{summary}</span>
							<ChevronDown className="size-3.5 shrink-0 opacity-50" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align={contentAlign} className="w-[360px]">
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
				{selectedIds.length > 0 && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="shrink-0 text-muted-foreground hover:text-foreground"
						onClick={() => updateSelected([])}
					>
						Deselect all
					</Button>
				)}
			</div>

			{selectedIds.length === 0 ? (
				<div className="text-[12px] leading-snug text-muted-foreground">
					{unrestrictedDescription}
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
				<div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[12px] leading-snug text-amber-700 dark:text-amber-300">
					{missingSelectedIds.length} selected model
					{missingSelectedIds.length === 1 ? " is" : "s are"} not in the current
					Pi model list. Handoffs can still use saved ids.
				</div>
			) : null}
		</div>
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
