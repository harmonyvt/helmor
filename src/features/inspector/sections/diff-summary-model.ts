import type { AgentModelOption } from "@/lib/api";
import type { InspectorFileItem } from "@/lib/editor-session";

/**
 * Pick the Pi model that should be pre-selected when the user starts a diff
 * review. A configured settings override wins, then a favourited Pi model,
 * then the first Pi model in the catalog so the review never starts with an
 * empty default (which would let the conversation surface choose a non-Pi
 * model).
 */
export function resolvePreferredPiModelId(
	piModels: readonly AgentModelOption[],
	configuredModelId: string | null | undefined,
	favouriteModelIds: readonly string[],
): string | null {
	if (piModels.length === 0) return null;
	const configured = configuredModelId
		? piModels.find((model) => model.id === configuredModelId)
		: null;
	if (configured) return configured.id;
	const favouriteSet = new Set(favouriteModelIds);
	const favourite = piModels.find((model) => favouriteSet.has(model.id));
	if (favourite) return favourite.id;
	return piModels[0]?.id ?? null;
}

export function groupChanges(changes: readonly InspectorFileItem[]) {
	const map = new Map<string, InspectorFileItem[]>();
	for (const item of changes) {
		const key = item.path.includes("/") ? item.path.split("/")[0] : "(root)";
		map.set(key, [...(map.get(key) ?? []), item]);
	}
	return [...map.entries()]
		.map(([key, items]) => ({
			key,
			label: key === "(root)" ? "Repository root" : key,
			items: [...items].sort((a, b) => a.path.localeCompare(b.path)),
		}))
		.sort(
			(a, b) =>
				b.items.length - a.items.length || a.label.localeCompare(b.label),
		);
}

export function changeStatusForPath(
	changes: readonly InspectorFileItem[],
	path: string,
): InspectorFileItem["status"] {
	return changes.find((item) => item.path === path)?.status ?? "M";
}

export function buildDiffReviewPrompt({
	workspaceRootPath,
	workspaceBranch,
	workspaceTargetBranch,
	changes,
}: {
	workspaceRootPath: string;
	workspaceBranch: string | null;
	workspaceTargetBranch: string | null;
	changes: readonly InspectorFileItem[];
}) {
	const fileList =
		changes.length === 0
			? "- No changed files were reported by Helmor yet. Inspect git status directly."
			: changes
					.slice(0, 120)
					.map(
						(item) =>
							`- ${item.status} ${item.path} (+${item.insertions}/-${item.deletions})`,
					)
					.join("\n");
	const truncated =
		changes.length > 120
			? `\n- ... ${changes.length - 120} more files omitted from this preview; inspect git directly for the full diff.`
			: "";

	return `Review the current git diff for this Helmor workspace and produce a concise rich summary.

Workspace root: ${workspaceRootPath}
Current branch: ${workspaceBranch ?? "unknown"}
Target branch: ${workspaceTargetBranch ?? "unknown"}

Helmor's current changed-file preview:
${fileList}${truncated}

Requirements:
- Do not modify files, stage changes, commit, push, install packages, or run destructive commands.
- Inspect the actual diff with safe read-only git commands such as git status --short, git diff --stat, git diff --cached --stat, git diff, git diff --cached, and target-branch comparisons when useful.
- Summarize the user-visible intent of the diff in 3-5 bullets.
- Group related changes by feature or subsystem, not just by folder.
- Call out risky files, likely test coverage, and review focus areas.
- Suggest a practical commit split only if the diff naturally divides into multiple commits.
- Render the answer as structured Markdown with clear headings, compact tables where helpful, and file references in backticks.`;
}
