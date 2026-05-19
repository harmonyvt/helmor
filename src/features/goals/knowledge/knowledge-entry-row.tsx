import { formatDistanceToNow } from "date-fns";
import type { KnowledgeMatch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { KnowledgeScoreBar } from "./knowledge-score-bar";
import { KnowledgeSourceBadge } from "./knowledge-source-badge";

type KnowledgeEntryRowProps = {
	match: KnowledgeMatch;
	isSelected: boolean;
	onClick: () => void;
};

export function KnowledgeEntryRow({
	match,
	isSelected,
	onClick,
}: KnowledgeEntryRowProps) {
	let updatedAtText: string | null = null;
	if (match.updatedAt) {
		try {
			const d = new Date(match.updatedAt);
			if (!Number.isNaN(d.getTime())) {
				updatedAtText = formatDistanceToNow(d, { addSuffix: true });
			}
		} catch {
			// ignore
		}
	}

	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"w-full text-left rounded-lg border px-3 py-2.5 cursor-pointer transition-colors",
				isSelected
					? "bg-accent border-border"
					: "border-border/40 hover:border-border hover:bg-accent/30",
			)}
		>
			<div className="text-sm font-medium text-foreground truncate">
				{match.title}
			</div>
			{match.excerpt && (
				<div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
					{match.excerpt}
				</div>
			)}
			<div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
				<KnowledgeSourceBadge sourceType={match.sourceType} />
				{match.goalWorkspaceId ? (
					<span className="text-[10px] text-blue-500 dark:text-blue-400">
						Goal
					</span>
				) : (
					<span className="text-[10px] text-muted-foreground">Project</span>
				)}
				{updatedAtText && (
					<span className="text-[10px] text-muted-foreground ml-auto">
						{updatedAtText}
					</span>
				)}
			</div>
			<div className="mt-1.5">
				<KnowledgeScoreBar score={match.score} />
			</div>
		</button>
	);
}
