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
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
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

type ReviewModelRowProps = {
	title: string;
	description: string;
	selectedModelId: string | null;
	models: AgentModelOption[];
	modelsLoading: boolean;
	emptyLabel: string;
	ariaLabel: string;
	onSelectModel: (modelId: string | null) => void;
};

function ReviewModelRow({
	title,
	description,
	selectedModelId,
	models,
	modelsLoading,
	emptyLabel,
	ariaLabel,
	onSelectModel,
}: ReviewModelRowProps) {
	const selectedReviewModel =
		models.find((model) => model.id === selectedModelId) ?? null;
	const selectedLabel = selectedReviewModel
		? selectedReviewModel.label
		: selectedModelId
			? modelsLoading
				? "Loading…"
				: "Model unavailable"
			: "Use default model";

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
						<ModelIcon
							model={selectedReviewModel}
							className="size-[13px] shrink-0"
						/>
						<span className="min-w-0 truncate whitespace-nowrap">
							{selectedLabel}
						</span>
						{selectedReviewModel ? (
							<span className="shrink-0 text-[10px] text-muted-foreground">
								{providerLabel(selectedReviewModel)}
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
					<DropdownMenuItem
						onClick={() => onSelectModel(null)}
						className="gap-2"
					>
						<span className="flex size-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
							—
						</span>
						<span className="min-w-0 flex-1 truncate">Use default model</span>
					</DropdownMenuItem>
					{models.length === 0 ? (
						<DropdownMenuItem disabled>
							{modelsLoading ? "Loading models…" : emptyLabel}
						</DropdownMenuItem>
					) : null}
					{models.map((model) => (
						<DropdownMenuItem
							key={model.id}
							onClick={() => onSelectModel(model.id)}
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

export function PrCommentReviewModelRow() {
	const { settings, updateSettings } = useSettings();
	const modelSectionsQuery = useQuery(agentModelSectionsQueryOptions());
	const modelSections = modelSectionsQuery.data ?? [];
	const allModels = modelSections.flatMap((section) => section.options);

	return (
		<ReviewModelRow
			title="PR comment review model"
			description="Provider and model used when Review all starts a session from the Comments tab. Leave on default to use your new-chat model."
			selectedModelId={settings.prCommentReviewModelId}
			models={allModels}
			modelsLoading={modelSectionsQuery.isPending}
			emptyLabel="No models available"
			ariaLabel="Select PR comment review model"
			onSelectModel={(modelId) =>
				updateSettings({ prCommentReviewModelId: modelId })
			}
		/>
	);
}

export function DiffSummaryModelRow() {
	const { settings, updateSettings } = useSettings();
	const modelSectionsQuery = useQuery(agentModelSectionsQueryOptions());
	const modelSections = modelSectionsQuery.data ?? [];
	const piModels =
		modelSections.find((section) => section.id === "pi")?.options ?? [];

	return (
		<ReviewModelRow
			title="Diff review Pi model"
			description="Pi model used when Ask Pi starts a diff review from the Diff review tab. Leave on default to use your favourite Pi model."
			selectedModelId={settings.diffSummaryModelId}
			models={piModels}
			modelsLoading={modelSectionsQuery.isPending}
			emptyLabel="No Pi models available"
			ariaLabel="Select Diff review Pi model"
			onSelectModel={(modelId) =>
				updateSettings({ diffSummaryModelId: modelId })
			}
		/>
	);
}
