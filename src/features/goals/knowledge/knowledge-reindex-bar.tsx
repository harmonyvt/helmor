import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Database, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reindexGoalKnowledge } from "@/lib/api";
import { knowledgeStatusQueryOptions } from "@/lib/query-client";

type KnowledgeReindexBarProps = {
	goalWorkspaceId: string;
	repoId: string | null;
	onAddNote?: () => void;
};

export function KnowledgeReindexBar({
	goalWorkspaceId,
	onAddNote,
}: KnowledgeReindexBarProps) {
	const { data: status } = useQuery(knowledgeStatusQueryOptions());

	const reindexMutation = useMutation({
		mutationFn: () => reindexGoalKnowledge(goalWorkspaceId),
	});

	const documentCount = status?.documentCount ?? 0;
	const isSidecarRunning = status?.state === "running";

	let lastRunText: string | null = null;
	if (status?.lastRun) {
		try {
			const completedAt = (status.lastRun as { completedAt?: string })
				?.completedAt;
			if (completedAt) {
				const d = new Date(completedAt);
				if (!Number.isNaN(d.getTime())) {
					lastRunText = formatDistanceToNow(d, { addSuffix: false });
				}
			}
		} catch {
			// ignore
		}
	}

	let statusText: string;
	if (!isSidecarRunning) {
		statusText = "KB sidecar not running";
	} else if (documentCount === 0) {
		statusText = "No documents indexed";
	} else {
		statusText = `${documentCount} docs${lastRunText ? ` · ${lastRunText} ago` : ""}`;
	}

	return (
		<div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
			<Database className="h-3.5 w-3.5 shrink-0" />
			<span className="flex-1 truncate">{statusText}</span>
			<div className="flex gap-1 shrink-0">
				{onAddNote && (
					<Button
						size="sm"
						variant="ghost"
						className="h-6 gap-1 px-2 text-xs cursor-pointer"
						onClick={onAddNote}
					>
						<Plus className="h-3 w-3" />
						Note
					</Button>
				)}
				<Button
					size="sm"
					variant="ghost"
					className="h-6 gap-1 px-2 text-xs cursor-pointer"
					onClick={() => reindexMutation.mutate()}
					disabled={reindexMutation.isPending || !isSidecarRunning}
				>
					{reindexMutation.isPending ? (
						<LoaderCircle className="h-3 w-3 animate-spin" />
					) : (
						<RefreshCw className="h-3 w-3" />
					)}
					Reindex
				</Button>
			</div>
		</div>
	);
}
