import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { KnowledgeMatch } from "@/lib/api";
import { knowledgeQueryOptions } from "@/lib/query-client";

type Namespace = "all" | "project" | "goal";

type UseKnowledgeQueryParams = {
	query: string;
	repoId: string | null;
	goalWorkspaceId: string | null;
	namespace?: Namespace;
};

type UseKnowledgeQueryResult = {
	matches: KnowledgeMatch[];
	filteredMatches: KnowledgeMatch[];
	isLoading: boolean;
	isFetching: boolean;
	debouncedQuery: string;
};

export function useKnowledgeQuery({
	query,
	repoId,
	goalWorkspaceId,
	namespace = "all",
}: UseKnowledgeQueryParams): UseKnowledgeQueryResult {
	const [debouncedQuery, setDebouncedQuery] = useState(query);

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(query);
		}, 300);
		return () => clearTimeout(timer);
	}, [query]);

	const queryResult = useQuery({
		...knowledgeQueryOptions({
			query: debouncedQuery,
			repoId,
			goalWorkspaceId,
		}),
		enabled: debouncedQuery.length > 0,
	});

	const matches = queryResult.data?.matches ?? [];

	const filteredMatches = matches.filter((m) => {
		if (namespace === "project") return m.goalWorkspaceId == null;
		if (namespace === "goal") return m.goalWorkspaceId != null;
		return true;
	});

	return {
		matches,
		filteredMatches,
		isLoading: queryResult.isLoading,
		isFetching: queryResult.isFetching,
		debouncedQuery,
	};
}
