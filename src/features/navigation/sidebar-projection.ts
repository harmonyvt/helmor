import type { WorkspaceGroup, WorkspaceRow, WorkspaceSummary } from "@/lib/api";
import { summaryToArchivedRow } from "@/lib/workspace-helpers";

export type PendingArchiveEntry = {
	row: WorkspaceRow;
	sourceGroupId: string;
	sourceIndex: number;
	stage: "preparing" | "running" | "confirmed";
	sortTimestamp: number;
};

export type PendingCreationEntry = {
	repoId: string;
	row: WorkspaceRow;
	stage: "creating" | "confirmed";
	resolvedWorkspaceId: string | null;
};

type ProjectedArchivedRow = {
	row: WorkspaceRow;
	sortTimestamp: number;
};

export function projectSidebarLists({
	baseGroups,
	baseArchivedSummaries,
	pendingArchives,
	pendingCreations,
}: {
	baseGroups: WorkspaceGroup[];
	baseArchivedSummaries: WorkspaceSummary[];
	pendingArchives: ReadonlyMap<string, PendingArchiveEntry>;
	pendingCreations: ReadonlyMap<string, PendingCreationEntry>;
}): {
	groups: WorkspaceGroup[];
	archivedRows: WorkspaceRow[];
} {
	const hiddenLiveIds = new Set(pendingArchives.keys());
	for (const [optimisticWorkspaceId, pendingCreation] of pendingCreations) {
		hiddenLiveIds.add(optimisticWorkspaceId);
		if (pendingCreation.resolvedWorkspaceId) {
			hiddenLiveIds.add(pendingCreation.resolvedWorkspaceId);
		}
	}
	const groups =
		hiddenLiveIds.size === 0
			? baseGroups
			: baseGroups.map((group) => ({
					...group,
					rows: group.rows.filter((row) => !hiddenLiveIds.has(row.id)),
				}));

	const liveGroups = Array.from(pendingCreations.values()).reduce(
		(currentGroups, pendingCreation) =>
			insertPendingCreationRow(currentGroups, pendingCreation.row),
		groups,
	);

	const archivedById = new Map<string, ProjectedArchivedRow>();
	for (let index = 0; index < baseArchivedSummaries.length; index += 1) {
		const summary = baseArchivedSummaries[index];
		const pending = pendingArchives.get(summary.id);
		archivedById.set(summary.id, {
			row: summaryToArchivedRow(summary),
			// While a pending entry exists, inherit its sortTimestamp so the
			// item doesn't jump when server data arrives. Once the pending
			// entry is reconciled away, fall back to stable server ordering.
			sortTimestamp: pending ? pending.sortTimestamp : -index,
		});
	}

	for (const [workspaceId, pendingArchive] of pendingArchives) {
		if (archivedById.has(workspaceId)) {
			continue;
		}

		archivedById.set(workspaceId, {
			row: {
				...pendingArchive.row,
				state: "archived",
			},
			sortTimestamp: pendingArchive.sortTimestamp,
		});
	}

	const archivedRows = Array.from(archivedById.values())
		.sort((left, right) => right.sortTimestamp - left.sortTimestamp)
		.map((entry) => entry.row);

	return {
		groups: liveGroups,
		archivedRows,
	};
}

export function shouldReconcilePendingArchive(
	workspaceId: string,
	baseGroups: WorkspaceGroup[],
	baseArchivedSummaries: WorkspaceSummary[],
): boolean {
	const stillLive = baseGroups.some((group) =>
		group.rows.some((row) => row.id === workspaceId),
	);
	if (stillLive) {
		return false;
	}

	return baseArchivedSummaries.some((summary) => summary.id === workspaceId);
}

export function shouldReconcilePendingCreation(
	pendingCreation: PendingCreationEntry,
	baseGroups: WorkspaceGroup[],
): boolean {
	const resolvedWorkspaceId = pendingCreation.resolvedWorkspaceId;
	if (pendingCreation.stage !== "confirmed" || !resolvedWorkspaceId) {
		return false;
	}

	return baseGroups.some((group) =>
		group.rows.some((row) => row.id === resolvedWorkspaceId),
	);
}

function insertPendingCreationRow(
	groups: WorkspaceGroup[],
	row: WorkspaceRow,
): WorkspaceGroup[] {
	return groups.map((group) =>
		group.id === "progress"
			? {
					...group,
					rows: group.rows.some((item) => item.id === row.id)
						? group.rows
						: [row, ...group.rows],
				}
			: group,
	);
}

// ---- PR-first layout projection ----

export type PrGroupTone = "pr-open" | "pr-merged" | "pr-closed" | "pr-none";

export type StackedWorkspaceRow = {
	row: WorkspaceRow;
	depth: number;
};

export type PrStatusGroup = {
	id: PrGroupTone;
	label: string;
	rows: StackedWorkspaceRow[];
};

export type ProjectGroup = {
	repoName: string;
	repoIconSrc?: string | null;
	repoInitials?: string | null;
	prGroups: PrStatusGroup[];
	totalCount: number;
};

const PR_STATUS_ORDER: PrGroupTone[] = [
	"pr-open",
	"pr-merged",
	"pr-closed",
	"pr-none",
];

const PR_STATUS_LABELS: Record<PrGroupTone, string> = {
	"pr-open": "Open",
	"pr-merged": "Merged",
	"pr-closed": "Closed",
	"pr-none": "No PR",
};

function prGroupToneForRow(row: WorkspaceRow): PrGroupTone {
	switch (row.prSyncState) {
		case "open":
			return "pr-open";
		case "merged":
			return "pr-merged";
		case "closed":
			return "pr-closed";
		default:
			return "pr-none";
	}
}

function buildStackTree(rows: WorkspaceRow[]): StackedWorkspaceRow[] {
	const byBranch = new Map<string, WorkspaceRow>();
	for (const row of rows) {
		if (row.branch) {
			byBranch.set(row.branch, row);
		}
	}

	const childrenOf = new Map<string, WorkspaceRow[]>();
	const rootRows: WorkspaceRow[] = [];

	for (const row of rows) {
		const parentBranch = row.intendedTargetBranch;
		const parent = parentBranch ? byBranch.get(parentBranch) : undefined;
		if (parent && parent.id !== row.id) {
			const siblings = childrenOf.get(parent.id) ?? [];
			siblings.push(row);
			childrenOf.set(parent.id, siblings);
		} else {
			rootRows.push(row);
		}
	}

	const result: StackedWorkspaceRow[] = [];
	const visited = new Set<string>();

	function flatten(row: WorkspaceRow, depth: number) {
		if (visited.has(row.id)) return;
		visited.add(row.id);
		result.push({ row, depth });
		for (const child of childrenOf.get(row.id) ?? []) {
			flatten(child, depth + 1);
		}
	}

	for (const row of rootRows) {
		flatten(row, 0);
	}

	return result;
}

export function projectSidebarListsByPr(
	baseGroups: WorkspaceGroup[],
	pendingCreations: ReadonlyMap<string, PendingCreationEntry>,
): ProjectGroup[] {
	const hiddenIds = new Set<string>();
	for (const [optimisticId, pending] of pendingCreations) {
		hiddenIds.add(optimisticId);
		if (pending.resolvedWorkspaceId) {
			hiddenIds.add(pending.resolvedWorkspaceId);
		}
	}

	const filteredGroups =
		hiddenIds.size === 0
			? baseGroups
			: baseGroups.map((group) => ({
					...group,
					rows: group.rows.filter((row) => !hiddenIds.has(row.id)),
				}));

	const withPending = Array.from(pendingCreations.values()).reduce(
		(current, pending) => insertPendingCreationRow(current, pending.row),
		filteredGroups,
	);

	// Flatten all rows from all groups (excludes archived — those have their own section)
	const allRows: WorkspaceRow[] = [];
	for (const group of withPending) {
		for (const row of group.rows) {
			allRows.push(row);
		}
	}

	// Group by repo name
	const byRepo = new Map<
		string,
		{
			rows: WorkspaceRow[];
			repoIconSrc?: string | null;
			repoInitials?: string | null;
		}
	>();
	for (const row of allRows) {
		const key = row.repoName ?? "(unknown)";
		const existing = byRepo.get(key);
		if (existing) {
			existing.rows.push(row);
		} else {
			byRepo.set(key, {
				rows: [row],
				repoIconSrc: row.repoIconSrc,
				repoInitials: row.repoInitials,
			});
		}
	}

	const projectGroups: ProjectGroup[] = [];
	for (const [repoName, { rows, repoIconSrc, repoInitials }] of byRepo) {
		const stacked = buildStackTree(rows);

		// Partition into PR status groups
		const buckets = new Map<PrGroupTone, StackedWorkspaceRow[]>();
		for (const entry of stacked) {
			const tone = prGroupToneForRow(entry.row);
			const bucket = buckets.get(tone) ?? [];
			bucket.push(entry);
			buckets.set(tone, bucket);
		}

		const prGroups: PrStatusGroup[] = PR_STATUS_ORDER.filter(
			(tone) => (buckets.get(tone)?.length ?? 0) > 0,
		).map((tone) => ({
			id: tone,
			label: PR_STATUS_LABELS[tone],
			rows: buckets.get(tone) ?? [],
		}));

		projectGroups.push({
			repoName,
			repoIconSrc,
			repoInitials,
			prGroups,
			totalCount: rows.length,
		});
	}

	// Sort repos alphabetically for stable ordering
	projectGroups.sort((a, b) => a.repoName.localeCompare(b.repoName));

	return projectGroups;
}
