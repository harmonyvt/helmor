import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { knowledgeStatusQueryOptions } from "@/lib/query-client";
import { KnowledgeAddNoteSheet } from "./knowledge-add-note-sheet";
import { KnowledgeDetailPane } from "./knowledge-detail-pane";
import { KnowledgeEmptyState } from "./knowledge-empty-state";
import { KnowledgeEntryList } from "./knowledge-entry-list";
import { KnowledgeNamespaceFilter } from "./knowledge-namespace-filter";
import { KnowledgeReindexBar } from "./knowledge-reindex-bar";
import { KnowledgeSearchBar } from "./knowledge-search-bar";
import { useKnowledgeQuery } from "./use-knowledge-query";

type Namespace = "all" | "project" | "goal";

type KnowledgeViewProps = {
	goalWorkspaceId: string;
	repoId: string | null;
};

export function KnowledgeView({ goalWorkspaceId, repoId }: KnowledgeViewProps) {
	const [query, setQuery] = useState("");
	const [namespace, setNamespace] = useState<Namespace>("all");
	const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
	const [showAddSheet, setShowAddSheet] = useState(false);

	const { filteredMatches, isLoading, debouncedQuery } = useKnowledgeQuery({
		query,
		repoId,
		goalWorkspaceId,
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
		<div className="flex h-full flex-col bg-background">
			<KnowledgeReindexBar
				goalWorkspaceId={goalWorkspaceId}
				repoId={repoId}
				onAddNote={() => setShowAddSheet(true)}
			/>
			<div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
				<div className="flex-1">
					<KnowledgeSearchBar value={query} onChange={setQuery} />
				</div>
				<KnowledgeNamespaceFilter value={namespace} onChange={setNamespace} />
			</div>
			<div className="flex flex-1 overflow-hidden gap-0">
				<div className="flex w-72 flex-shrink-0 flex-col border-r border-border/60 overflow-hidden">
					<KnowledgeEntryList
						matches={filteredMatches}
						selectedMatchId={selectedMatchId}
						isLoading={isLoading}
						onSelect={setSelectedMatchId}
						emptyNode={emptyNode}
					/>
				</div>
				<div className="flex flex-1 flex-col overflow-hidden p-3">
					<KnowledgeDetailPane match={selectedMatch} />
				</div>
			</div>
			<KnowledgeAddNoteSheet
				open={showAddSheet}
				onOpenChange={setShowAddSheet}
				goalWorkspaceId={goalWorkspaceId}
				repoId={repoId}
			/>
		</div>
	);
}
