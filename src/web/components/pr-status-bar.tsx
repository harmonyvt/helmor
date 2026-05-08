import { useQuery } from "@tanstack/react-query";
import {
	ChevronDown,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
} from "lucide-react";
import { useState } from "react";
import { workspaceDetailQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";

interface PrStatusBarProps {
	workspaceId: string;
}

function PrStateIcon({ state }: { state: string }) {
	if (state === "merged") {
		return (
			<GitMerge
				className="h-4 w-4 shrink-0"
				style={{ color: "var(--workspace-pr-merged-accent)" }}
			/>
		);
	}
	if (state === "closed") {
		return (
			<GitPullRequestClosed
				className="h-4 w-4 shrink-0"
				style={{ color: "var(--workspace-pr-closed-accent)" }}
			/>
		);
	}
	// open / draft / fallback
	return (
		<GitPullRequest
			className="h-4 w-4 shrink-0"
			style={{ color: "var(--workspace-pr-open-accent)" }}
		/>
	);
}

export function PrStatusBar({ workspaceId }: PrStatusBarProps) {
	const [expanded, setExpanded] = useState(false);

	const { data: detail } = useQuery({
		...workspaceDetailQueryOptions(workspaceId),
	});

	// Only render when there is PR data
	if (!detail?.prSyncState || detail.prSyncState === "none") {
		return null;
	}
	if (!detail.prTitle && !detail.prUrl) {
		return null;
	}

	const prState = detail.prSyncState; // "open" | "closed" | "merged"
	const prTitle = detail.prTitle ?? "";
	const prBranch = detail.branch ?? null;
	const prTarget = detail.intendedTargetBranch ?? detail.defaultBranch ?? null;

	// Extract PR number from URL if present
	let prNumber: number | null = null;
	if (detail.prUrl) {
		const match = /\/pull\/(\d+)/.exec(detail.prUrl);
		if (match?.[1]) {
			prNumber = Number.parseInt(match[1], 10);
		}
	}

	return (
		<div className="shrink-0 border-b border-border bg-sidebar">
			{/* Collapsed row */}
			<button
				type="button"
				className="h-10 w-full flex items-center gap-2 px-4 cursor-pointer"
				onClick={() => setExpanded((v) => !v)}
			>
				<PrStateIcon state={prState} />
				{prNumber !== null && (
					<span className="text-xs font-medium text-muted-foreground">
						#{prNumber}
					</span>
				)}
				<span className="text-sm truncate flex-1 text-left">{prTitle}</span>
				<ChevronDown
					className={cn(
						"h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0",
						expanded && "rotate-180",
					)}
				/>
			</button>

			{/* Expandable content */}
			<div
				className={cn(
					"grid overflow-hidden transition-all duration-200",
					expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="px-4 pb-3 pt-1">
						<p className="text-sm font-medium text-foreground mb-1">
							{prTitle}
						</p>
						{(prBranch || prTarget) && (
							<p className="text-xs text-muted-foreground font-mono">
								{prBranch && prTarget
									? `${prBranch} → ${prTarget}`
									: (prBranch ?? prTarget)}
							</p>
						)}
						{detail.prUrl && (
							<a
								href={detail.prUrl}
								target="_blank"
								rel="noreferrer"
								className="text-xs text-muted-foreground underline underline-offset-2 cursor-pointer"
								onClick={(e) => e.stopPropagation()}
							>
								{detail.prUrl}
							</a>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
