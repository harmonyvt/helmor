import { cn } from "@/lib/utils";

type KnowledgeScoreBarProps = {
	score: number;
};

export function KnowledgeScoreBar({ score }: KnowledgeScoreBarProps) {
	const colorClass =
		score >= 0.7
			? "bg-green-500/60"
			: score >= 0.4
				? "bg-amber-500/60"
				: "bg-muted-foreground/40";

	return (
		<div className="h-1 w-full rounded-full bg-muted/30">
			<div
				className={cn(
					"h-full rounded-full transition-all duration-300",
					colorClass,
				)}
				style={{ width: `${Math.round(score * 100)}%` }}
			/>
		</div>
	);
}
