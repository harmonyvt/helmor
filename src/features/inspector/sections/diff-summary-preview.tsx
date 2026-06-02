import { LoaderCircle, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { InspectorFileItem } from "@/lib/editor-session";
import { cn } from "@/lib/utils";

type ChangeGroup = {
	key: string;
	label: string;
	items: InspectorFileItem[];
};

type DiffSummaryPreviewProps = {
	changes: InspectorFileItem[];
	groups: ChangeGroup[];
	canReview: boolean;
	isStarting: boolean;
	totalInsertions: number;
	totalDeletions: number;
	onStartReview: () => void;
	onOpenPath: (path: string) => void;
};

const STATUS_LABELS: Record<InspectorFileItem["status"], string> = {
	A: "Added",
	M: "Modified",
	D: "Deleted",
};

export function DiffSummaryPreview({
	changes,
	groups,
	canReview,
	isStarting,
	totalInsertions,
	totalDeletions,
	onStartReview,
	onOpenPath,
}: DiffSummaryPreviewProps) {
	const headerLabel = !canReview
		? changes.length === 0
			? "No changed files"
			: "Workspace not ready"
		: `${changes.length} file${changes.length === 1 ? "" : "s"} · +${totalInsertions} / -${totalDeletions}`;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-8 shrink-0 items-center justify-between border-b border-border/60 bg-muted/25 px-3">
				<span className="truncate text-[11px] text-muted-foreground">
					{headerLabel}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-6 cursor-pointer gap-1.5 px-2 text-[11px] text-primary hover:text-primary/80"
					onClick={onStartReview}
					disabled={!canReview || isStarting}
				>
					{isStarting ? (
						<LoaderCircle className="size-3 animate-spin" />
					) : (
						<Sparkles className="size-3" />
					)}
					Ask Pi
				</Button>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div className="space-y-3 p-3">
					<div className="grid grid-cols-3 gap-2">
						<Metric label="Files" value={changes.length} />
						<Metric label="Added" value={`+${totalInsertions}`} />
						<Metric label="Removed" value={`-${totalDeletions}`} />
					</div>
					{changes.length === 0 ? (
						<p className="rounded-md border border-border/70 bg-muted/25 p-3 text-[12px] text-muted-foreground">
							There are no changed files to summarize. Edit some files, then
							come back to ask Pi for a diff review.
						</p>
					) : (
						<div className="space-y-2">
							{groups.map((group) => (
								<div
									key={group.key}
									className="rounded-md border border-border/70 bg-background/45"
								>
									<div className="flex items-center justify-between border-b border-border/50 px-2.5 py-1.5">
										<span className="truncate text-[12px] font-medium">
											{group.label}
										</span>
										<Badge
											variant="secondary"
											className="h-5 rounded px-1.5 text-[10px]"
										>
											{group.items.length}
										</Badge>
									</div>
									<div className="divide-y divide-border/45">
										{group.items.slice(0, 8).map((item) => (
											<button
												key={item.path}
												type="button"
												className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/35"
												onClick={() => onOpenPath(item.path)}
												aria-label={`${STATUS_LABELS[item.status]} ${item.path}`}
											>
												<span
													aria-hidden="true"
													className={cn(
														"w-3 shrink-0 text-center text-[10px] font-semibold",
														statusClass(item.status),
													)}
												>
													{item.status}
												</span>
												<span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
													{item.path}
												</span>
												<span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
													+{item.insertions} -{item.deletions}
												</span>
											</button>
										))}
										{group.items.length > 8 ? (
											<div className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
												+{group.items.length - 8} more
											</div>
										) : null}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</ScrollArea>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: number | string }) {
	return (
		<div className="rounded-md border border-border/70 bg-background/45 px-2.5 py-2">
			<div className="text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
				{label}
			</div>
			<div className="mt-1 text-[15px] font-semibold tabular-nums text-foreground">
				{value}
			</div>
		</div>
	);
}

function statusClass(status: InspectorFileItem["status"]): string {
	switch (status) {
		case "A":
			return "text-green-500";
		case "D":
			return "text-red-500";
		default:
			return "text-yellow-500";
	}
}
