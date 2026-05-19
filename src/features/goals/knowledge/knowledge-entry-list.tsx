import type React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { KnowledgeMatch } from "@/lib/api";
import { KnowledgeEntryRow } from "./knowledge-entry-row";

type KnowledgeEntryListProps = {
	matches: KnowledgeMatch[];
	selectedMatchId: string | null;
	isLoading: boolean;
	onSelect: (matchId: string) => void;
	emptyNode: React.ReactNode;
};

function SkeletonRow() {
	return (
		<div className="rounded-lg border border-border/40 p-3 space-y-2">
			<Skeleton className="h-3.5 w-3/4" />
			<Skeleton className="h-2.5 w-full" />
			<Skeleton className="h-2.5 w-1/2" />
		</div>
	);
}

export function KnowledgeEntryList({
	matches,
	selectedMatchId,
	isLoading,
	onSelect,
	emptyNode,
}: KnowledgeEntryListProps) {
	if (isLoading) {
		return (
			<div className="flex flex-col gap-2 p-2">
				<SkeletonRow />
				<SkeletonRow />
				<SkeletonRow />
				<SkeletonRow />
				<SkeletonRow />
			</div>
		);
	}

	if (matches.length === 0) {
		return <>{emptyNode}</>;
	}

	return (
		<ScrollArea className="h-full">
			<div className="flex flex-col gap-1.5 p-2">
				{matches.map((match) => (
					<KnowledgeEntryRow
						key={match.sourceId}
						match={match}
						isSelected={match.sourceId === selectedMatchId}
						onClick={() => onSelect(match.sourceId)}
					/>
				))}
			</div>
		</ScrollArea>
	);
}
