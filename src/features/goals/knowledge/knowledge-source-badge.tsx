import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type KnowledgeSourceBadgeProps = {
	sourceType: string;
};

function getSourceMeta(sourceType: string): {
	label: string;
	className: string;
} {
	switch (sourceType) {
		case "pi_note":
			return {
				label: "Pi note",
				className:
					"bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
			};
		case "goal_doc":
			return {
				label: "Goal doc",
				className:
					"bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
			};
		case "code":
			return {
				label: "Code",
				className:
					"bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
			};
		case "research":
			return {
				label: "Research",
				className:
					"bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
			};
		default:
			return {
				label: sourceType,
				className: "bg-muted/40 text-muted-foreground border-border/40",
			};
	}
}

export function KnowledgeSourceBadge({
	sourceType,
}: KnowledgeSourceBadgeProps) {
	const { label, className } = getSourceMeta(sourceType);
	return (
		<Badge
			variant="outline"
			className={cn("text-[10px] font-medium px-1.5 py-0", className)}
		>
			{label}
		</Badge>
	);
}
