import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { WorkspaceGroup, WorkspaceRow } from "@/lib/api";
import { type SessionSearchResult, searchSessions } from "@/lib/api";

function matchesQuery(row: WorkspaceRow, query: string): boolean {
	if (!query) return true;
	const q = query.toLowerCase();
	return Boolean(
		row.title?.toLowerCase().includes(q) ||
			row.branch?.toLowerCase().includes(q) ||
			row.prTitle?.toLowerCase().includes(q) ||
			row.repoName?.toLowerCase().includes(q) ||
			row.primarySessionTitle?.toLowerCase().includes(q) ||
			row.activeSessionTitle?.toLowerCase().includes(q),
	);
}

export type PaletteWorkspaceItem = {
	kind: "workspace";
	row: WorkspaceRow;
};

export type PaletteSessionItem = {
	kind: "session";
	result: SessionSearchResult;
};

export type PaletteItem = PaletteWorkspaceItem | PaletteSessionItem;

type UsePaletteSearchArgs = {
	query: string;
	workspaceGroups: WorkspaceGroup[];
	archivedRows: WorkspaceRow[];
};

/**
 * Returns filtered workspace items (client-side) and session items (backend
 * search). The backend search fires only when `query.length >= 2`.
 */
export function usePaletteSearch({
	query,
	workspaceGroups,
	archivedRows,
}: UsePaletteSearchArgs): {
	workspaceItems: PaletteWorkspaceItem[];
	sessionItems: PaletteSessionItem[];
	isLoadingSessions: boolean;
} {
	// Debounce the backend query by 150 ms to avoid hammering IPC on every
	// keystroke.
	const [debouncedQuery, setDebouncedQuery] = useState(query);
	useEffect(() => {
		const timer = setTimeout(() => setDebouncedQuery(query), 150);
		return () => clearTimeout(timer);
	}, [query]);

	// Client-side workspace filtering — instant, no IPC needed.
	const workspaceItems = useMemo<PaletteWorkspaceItem[]>(() => {
		const allRows: WorkspaceRow[] = [
			...workspaceGroups.flatMap((g) => g.rows),
			...archivedRows,
		];
		return allRows
			.filter((row) => matchesQuery(row, query))
			.map((row) => ({ kind: "workspace" as const, row }));
	}, [workspaceGroups, archivedRows, query]);

	// Backend session search — only runs when query is at least 2 chars.
	const { data: sessionResults, isFetching } = useQuery({
		queryKey: ["command-palette-sessions", debouncedQuery],
		queryFn: () => searchSessions(debouncedQuery),
		enabled: debouncedQuery.length >= 2,
		staleTime: 10_000,
	});

	const sessionItems = useMemo<PaletteSessionItem[]>(() => {
		if (!sessionResults) return [];
		return sessionResults.map((result) => ({
			kind: "session" as const,
			result,
		}));
	}, [sessionResults]);

	return {
		workspaceItems,
		sessionItems,
		isLoadingSessions: isFetching,
	};
}
