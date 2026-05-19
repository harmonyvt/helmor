import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Database } from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { knowledgeStatusQueryOptions } from "@/lib/query-client";

type KbHeaderBadgeProps = {
	goalWorkspaceId: string;
};

export function KbHeaderBadge({
	goalWorkspaceId: _goalWorkspaceId,
}: KbHeaderBadgeProps) {
	const { data: status } = useQuery(knowledgeStatusQueryOptions());

	if (!(status && status.documentCount > 0)) {
		return null;
	}

	const completedAt = (status.lastRun as { completedAt?: string } | null)
		?.completedAt;

	let lastIndexedStr: string | null = null;
	if (completedAt) {
		const d = new Date(completedAt);
		if (!Number.isNaN(d.getTime())) {
			lastIndexedStr = formatDistanceToNow(d, { addSuffix: true });
		}
	}

	const tooltipText = `${status.documentCount} knowledge docs${lastIndexedStr ? ` · last indexed ${lastIndexedStr}` : ""}`;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="flex cursor-default items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent/40 transition-colors">
					<Database className="h-3 w-3" />
					<span>{status.documentCount}</span>
				</div>
			</TooltipTrigger>
			<TooltipContent>
				<p>{tooltipText}</p>
			</TooltipContent>
		</Tooltip>
	);
}
