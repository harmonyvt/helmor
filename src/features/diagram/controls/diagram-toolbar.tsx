// Header strip for the diagram surface: mode + hop + language filters,
// search, layout direction, exit button.

import {
	ArrowLeft,
	MoveHorizontal,
	MoveVertical,
	RefreshCcw,
} from "lucide-react";
import type { ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CodeGraphLanguage, CodeGraphStats } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LayoutDirection } from "../layout/apply-layout";
import type { DiagramFilter } from "../layout/subgraph";

type DiagramToolbarProps = {
	filter: DiagramFilter;
	onFilterChange: (next: Partial<DiagramFilter>) => void;
	direction: LayoutDirection;
	onDirectionChange: (direction: LayoutDirection) => void;
	nodeCount: number;
	totalNodes: number;
	stats: CodeGraphStats | null;
	isFetching: boolean;
	onRefresh: () => void;
	onExit: () => void;
};

const LANGUAGE_OPTIONS: { value: CodeGraphLanguage; label: string }[] = [
	{ value: "typescript", label: "TS" },
	{ value: "tsx", label: "TSX" },
	{ value: "javascript", label: "JS" },
	{ value: "jsx", label: "JSX" },
	{ value: "rust", label: "RS" },
	{ value: "python", label: "PY" },
];

export function DiagramToolbar({
	filter,
	onFilterChange,
	direction,
	onDirectionChange,
	nodeCount,
	totalNodes,
	stats,
	isFetching,
	onRefresh,
	onExit,
}: DiagramToolbarProps) {
	function toggleLanguage(lang: CodeGraphLanguage) {
		const next = new Set(filter.includeLanguages);
		if (next.has(lang)) next.delete(lang);
		else next.add(lang);
		onFilterChange({ includeLanguages: next });
	}

	function onSearchChange(event: ChangeEvent<HTMLInputElement>) {
		onFilterChange({ searchQuery: event.target.value });
	}

	return (
		<div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-3 py-2 text-[12px]">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={onExit}
						className="text-muted-foreground hover:text-foreground"
						aria-label="Back to chat"
					>
						<ArrowLeft className="size-4" />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">Back to chat</TooltipContent>
			</Tooltip>

			<div className="font-medium text-foreground">Diagram</div>

			<div className="ml-2 inline-flex overflow-hidden rounded-md border border-border">
				{(["changedOnly", "focus", "all"] as DiagramFilter["mode"][]).map(
					(mode) => (
						<button
							type="button"
							key={mode}
							onClick={() => onFilterChange({ mode })}
							className={cn(
								"cursor-pointer px-2 py-1 text-[11px] capitalize transition-colors",
								filter.mode === mode
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:bg-muted/60",
							)}
						>
							{mode === "changedOnly" ? "Changed" : mode}
						</button>
					),
				)}
			</div>

			<label className="flex items-center gap-1 text-muted-foreground">
				<span>Hops</span>
				<input
					type="number"
					min={0}
					max={6}
					value={filter.hopCount}
					onChange={(event) =>
						onFilterChange({
							hopCount: Math.max(
								0,
								Math.min(6, Number.parseInt(event.target.value, 10) || 0),
							),
						})
					}
					className="w-12 rounded border border-border bg-background px-1.5 py-0.5 text-foreground"
				/>
			</label>

			<div className="inline-flex items-center gap-1">
				{LANGUAGE_OPTIONS.map((option) => {
					const enabled = filter.includeLanguages.has(option.value);
					return (
						<button
							type="button"
							key={option.value}
							onClick={() => toggleLanguage(option.value)}
							className={cn(
								"cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase transition-colors",
								enabled
									? "bg-muted text-foreground"
									: "bg-transparent text-muted-foreground/60 line-through",
							)}
						>
							{option.label}
						</button>
					);
				})}
			</div>

			<Input
				value={filter.searchQuery}
				onChange={onSearchChange}
				placeholder="Filter by path…"
				className="h-7 w-48 text-[12px]"
			/>

			<div className="ml-auto flex items-center gap-2 text-muted-foreground">
				<span title="Visible / total nodes">
					{nodeCount} / {totalNodes}
				</span>
				{stats && stats.externalPackages > 0 && (
					<span title="External packages (not shown as nodes)">
						·{stats.externalPackages} ext
					</span>
				)}
				<div className="inline-flex overflow-hidden rounded-md border border-border">
					<button
						type="button"
						onClick={() => onDirectionChange("LR")}
						className={cn(
							"cursor-pointer p-1",
							direction === "LR"
								? "bg-muted text-foreground"
								: "text-muted-foreground",
						)}
						aria-label="Layout left to right"
					>
						<MoveHorizontal className="size-3.5" />
					</button>
					<button
						type="button"
						onClick={() => onDirectionChange("TB")}
						className={cn(
							"cursor-pointer p-1",
							direction === "TB"
								? "bg-muted text-foreground"
								: "text-muted-foreground",
						)}
						aria-label="Layout top to bottom"
					>
						<MoveVertical className="size-3.5" />
					</button>
				</div>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={onRefresh}
							disabled={isFetching}
							className="text-muted-foreground hover:text-foreground"
							aria-label="Refresh graph"
						>
							<RefreshCcw
								className={cn("size-4", isFetching && "animate-spin")}
							/>
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">Rebuild graph</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}
