// Owns the React Query subscription for the workspace's CodeGraph plus
// the local filter state. Surfaced types are kept narrow so the diagram
// surface doesn't reach into React Query directly.

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
	type CodeGraph,
	type CodeGraphBuildProgress,
	getCodeGraph,
} from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import {
	computeSubgraph,
	type DiagramFilter,
	defaultFilter,
	type Subgraph,
} from "../layout/subgraph";

export type CodeGraphState = {
	graph: CodeGraph | null;
	subgraph: Subgraph | null;
	isLoading: boolean;
	isFetching: boolean;
	error: Error | null;
	progress: CodeGraphBuildProgress | null;
	refetch: () => void;
	filter: DiagramFilter;
	setFilter: (next: Partial<DiagramFilter>) => void;
};

export function useCodeGraph(workspaceId: string | null): CodeGraphState {
	const [filter, setFilterState] = useState<DiagramFilter>(() =>
		defaultFilter(),
	);
	const [progress, setProgress] = useState<CodeGraphBuildProgress | null>(null);

	const query = useQuery({
		queryKey: helmorQueryKeys.codeGraph(workspaceId ?? "__none__"),
		queryFn: async () => {
			if (!workspaceId) {
				throw new Error("Cannot fetch code graph without workspace");
			}
			setProgress(null);
			return getCodeGraph(workspaceId, (event) => setProgress(event));
		},
		enabled: workspaceId !== null,
		staleTime: 60_000,
		refetchOnWindowFocus: false,
	});

	const subgraph = useMemo(
		() => (query.data ? computeSubgraph(query.data, filter) : null),
		[query.data, filter],
	);

	const setFilter = useCallback((next: Partial<DiagramFilter>) => {
		setFilterState((prev) => ({ ...prev, ...next }));
	}, []);

	const refetch = useCallback(() => {
		setProgress(null);
		void query.refetch();
	}, [query]);

	return {
		graph: query.data ?? null,
		subgraph,
		isLoading: query.isLoading,
		isFetching: query.isFetching,
		error: (query.error as Error | null) ?? null,
		progress,
		refetch,
		filter,
		setFilter,
	};
}
