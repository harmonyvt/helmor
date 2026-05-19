import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
	ChevronLeft,
	Database,
	LoaderCircle,
	Plus,
	RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { KnowledgeAddNoteSheet } from "@/features/goals/knowledge/knowledge-add-note-sheet";
import { KnowledgeDetailPane } from "@/features/goals/knowledge/knowledge-detail-pane";
import { KnowledgeEmptyState } from "@/features/goals/knowledge/knowledge-empty-state";
import { KnowledgeEntryList } from "@/features/goals/knowledge/knowledge-entry-list";
import { KnowledgeNamespaceFilter } from "@/features/goals/knowledge/knowledge-namespace-filter";
import { KnowledgeSearchBar } from "@/features/goals/knowledge/knowledge-search-bar";
import { useKnowledgeQuery } from "@/features/goals/knowledge/use-knowledge-query";
import { reindexGoalKnowledge, reindexProjectKnowledge } from "@/lib/api";
import { knowledgeStatusQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";

// ─── Local status bar ──────────────────────────────────────────────────────────
// Adapted from KnowledgeReindexBar — supports both goal and project reindex
// depending on whether a workspaceId is available.

type KnowledgeStatusBarProps = {
	workspaceId: string | null;
	repoId: string | null;
	onAddNote?: () => void;
};

function KnowledgeStatusBar({
	workspaceId,
	repoId,
	onAddNote,
}: KnowledgeStatusBarProps) {
	const { data: status } = useQuery(knowledgeStatusQueryOptions());

	const goalMutation = useMutation({
		mutationFn: () => reindexGoalKnowledge(workspaceId!),
	});
	const projectMutation = useMutation({
		mutationFn: () => reindexProjectKnowledge(repoId!),
	});

	const mutation = workspaceId ? goalMutation : projectMutation;
	const canReindex = workspaceId ? !!workspaceId : !!repoId;
	const isSidecarRunning = status?.state === "running";
	const documentCount = status?.documentCount ?? 0;

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
			<Database className="size-3.5 shrink-0" />
			<span className="flex-1 truncate">{statusText}</span>
			<div className="flex shrink-0 gap-1">
				{onAddNote && (
					<Button
						size="sm"
						variant="ghost"
						className="h-6 gap-1 px-2 text-xs cursor-pointer"
						onClick={onAddNote}
					>
						<Plus className="size-3" />
						Note
					</Button>
				)}
				<Button
					size="sm"
					variant="ghost"
					className="h-6 gap-1 px-2 text-xs cursor-pointer"
					onClick={() => mutation.mutate()}
					disabled={mutation.isPending || !isSidecarRunning || !canReindex}
				>
					{mutation.isPending ? (
						<LoaderCircle className="size-3 animate-spin" />
					) : (
						<RefreshCw className="size-3" />
					)}
					Reindex
				</Button>
			</div>
		</div>
	);
}

// ─── KnowledgeSection ──────────────────────────────────────────────────────────

type KnowledgeSectionProps = {
	workspaceId: string | null;
	repoId: string | null;
	isActive: boolean;
};

export function KnowledgeSection({
	workspaceId,
	repoId,
	isActive,
}: KnowledgeSectionProps) {
	const [query, setQuery] = useState("");
	const [namespace, setNamespace] = useState<"all" | "project" | "goal">("all");
	const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
	const [showAddSheet, setShowAddSheet] = useState(false);

	const { filteredMatches, isLoading, debouncedQuery } = useKnowledgeQuery({
		query,
		repoId,
		goalWorkspaceId: workspaceId,
		namespace,
	});

	const { data: status } = useQuery(knowledgeStatusQueryOptions());

	const selectedMatch =
		filteredMatches.find((m) => m.sourceId === selectedMatchId) ?? null;

	const showNoIndex =
		debouncedQuery.length === 0 && (status?.documentCount ?? 0) === 0;
	const emptyNode = showNoIndex ? (
		<KnowledgeEmptyState variant="no-index" />
	) : (
		<KnowledgeEmptyState variant="no-results" query={debouncedQuery} />
	);

	return (
		<div
			role="tabpanel"
			id="inspector-panel-knowledge"
			aria-labelledby="inspector-tab-knowledge"
			className={cn("flex h-full flex-col bg-sidebar", !isActive && "hidden")}
		>
			<KnowledgeStatusBar
				workspaceId={workspaceId}
				repoId={repoId}
				onAddNote={workspaceId ? () => setShowAddSheet(true) : undefined}
			/>

			<div className="flex items-center gap-2 border-b border-border/60 px-2 py-1.5">
				<div className="flex-1">
					<KnowledgeSearchBar value={query} onChange={setQuery} />
				</div>
				<KnowledgeNamespaceFilter value={namespace} onChange={setNamespace} />
			</div>

			{selectedMatch ? (
				<div className="flex min-h-0 flex-1 flex-col">
					<button
						type="button"
						className="flex cursor-pointer items-center gap-1.5 border-b border-border/60 px-3 py-2 text-left text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors"
						onClick={() => setSelectedMatchId(null)}
					>
						<ChevronLeft className="size-3" strokeWidth={2} />
						Back to results
					</button>
					<div className="min-h-0 flex-1 overflow-auto p-3">
						<KnowledgeDetailPane match={selectedMatch} />
					</div>
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-hidden">
					<KnowledgeEntryList
						matches={filteredMatches}
						selectedMatchId={selectedMatchId}
						isLoading={isLoading}
						onSelect={setSelectedMatchId}
						emptyNode={emptyNode}
					/>
				</div>
			)}

			{workspaceId && (
				<KnowledgeAddNoteSheet
					open={showAddSheet}
					onOpenChange={setShowAddSheet}
					goalWorkspaceId={workspaceId}
					repoId={repoId}
				/>
			)}
		</div>
	);
}
