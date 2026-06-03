// Full-window "Pi diff review" surface. Renders the same diff-summary body
// that lives inside the inspector sidebar tab, but with full-viewport chrome
// (background, header bar, exit affordance). Mounted by App.tsx when
// `workspaceViewMode === "diff-summary"`. Mirrors the diagram surface pattern.

import { useQuery } from "@tanstack/react-query";
import { DiffSummaryTab } from "@/features/inspector/sections/diff-summary";
import type { DiffOpenOptions, InspectorFileItem } from "@/lib/editor-session";
import { workspaceGitPanelQueryOptions } from "@/lib/query-client";

type WorkspaceDiffSummarySurfaceProps = {
	workspaceId: string | null;
	repoId: string | null;
	workspaceRootPath: string | null;
	workspaceBranch: string | null;
	workspaceTargetBranch: string | null;
	onOpenEditorFile: (path: string, options?: DiffOpenOptions) => void;
	onExit: () => void;
};

export function WorkspaceDiffSummarySurface({
	workspaceId,
	repoId,
	workspaceRootPath,
	workspaceBranch,
	workspaceTargetBranch,
	onOpenEditorFile,
	onExit,
}: WorkspaceDiffSummarySurfaceProps) {
	// Shares the same query key as the inspector sidebar, so React Query
	// dedupes the request when both are open.
	const changesQuery = useQuery({
		...workspaceGitPanelQueryOptions(workspaceRootPath ?? ""),
		enabled: !!workspaceRootPath,
	});
	const changes: InspectorFileItem[] = changesQuery.data?.items ?? [];

	return (
		<DiffSummaryTab
			workspaceId={workspaceId}
			repoId={repoId}
			workspaceRootPath={workspaceRootPath}
			workspaceBranch={workspaceBranch}
			workspaceTargetBranch={workspaceTargetBranch}
			changes={changes}
			onOpenEditorFile={onOpenEditorFile}
			variant="fullWindow"
			onExit={onExit}
		/>
	);
}
