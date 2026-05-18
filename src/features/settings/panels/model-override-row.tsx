import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { ModelIcon } from "@/components/model-icon";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentModelOption } from "@/lib/api";
import { agentModelSectionsQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { findModelOption } from "@/lib/workspace-helpers";
import { SettingsRow } from "../components/settings-row";

function providerLabel(model: AgentModelOption): string {
	switch (model.provider) {
		case "claude":
			return "Claude";
		case "codex":
			return "Codex";
		case "pi":
			return model.providerKey ? `Pi · ${model.providerKey}` : "Pi";
		default:
			return model.provider;
	}
}

type ModelOverrideRowProps = {
	title: string;
	description: string;
	ariaLabel: string;
	value: string | null;
	defaultLabel?: string;
	onChange: (modelId: string | null) => void;
};

export function ModelOverrideRow({
	title,
	description,
	ariaLabel,
	value,
	defaultLabel = "Use default model",
	onChange,
}: ModelOverrideRowProps) {
	const modelSectionsQuery = useQuery(agentModelSectionsQueryOptions());
	const modelSections = modelSectionsQuery.data ?? [];
	const allModels = modelSections.flatMap((section) => section.options);
	const selectedModel = findModelOption(modelSections, value);
	const selectedLabel = selectedModel
		? selectedModel.label
		: value
			? modelSectionsQuery.isPending
				? "Loading..."
				: "Model unavailable"
			: defaultLabel;

	return (
		<SettingsRow title={title} description={description}>
			<DropdownMenu>
				<DropdownMenuTrigger
					className={cn(
						"flex h-8 w-[360px] cursor-pointer items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-3 text-[13px] text-foreground hover:bg-muted/50",
						"min-w-0 gap-1.5",
					)}
					aria-label={ariaLabel}
				>
					<span className="flex min-w-0 items-center gap-1.5">
						<ModelIcon model={selectedModel} className="size-[13px] shrink-0" />
						<span className="min-w-0 truncate whitespace-nowrap">
							{selectedLabel}
						</span>
						{selectedModel ? (
							<span className="shrink-0 text-[10px] text-muted-foreground">
								{providerLabel(selectedModel)}
							</span>
						) : null}
					</span>
					<ChevronDown className="size-3 shrink-0 opacity-40" />
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					sideOffset={4}
					className="min-w-[18rem]"
				>
					<DropdownMenuItem onClick={() => onChange(null)} className="gap-2">
						<span className="flex size-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
							-
						</span>
						<span className="min-w-0 flex-1 truncate">{defaultLabel}</span>
					</DropdownMenuItem>
					{allModels.length === 0 ? (
						<DropdownMenuItem disabled>
							{modelSectionsQuery.isPending
								? "Loading models..."
								: "No models available"}
						</DropdownMenuItem>
					) : null}
					{allModels.map((model) => (
						<DropdownMenuItem
							key={model.id}
							onClick={() => onChange(model.id)}
							className="gap-2"
						>
							<ModelIcon model={model} className="size-4 shrink-0" />
							<span className="min-w-0 flex-1 truncate">{model.label}</span>
							<span className="shrink-0 text-[10px] text-muted-foreground">
								{providerLabel(model)}
							</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</SettingsRow>
	);
}
