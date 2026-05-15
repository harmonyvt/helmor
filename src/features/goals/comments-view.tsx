import { useQueries } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
	ArrowUpRight,
	FileIcon,
	GitPullRequest,
	LoaderCircle,
	MessageSquare,
} from "lucide-react";
import { memo, Suspense, useMemo, useState } from "react";
import { LazyStreamdown } from "@/components/streamdown-loader";
import type { PrComment, PrCommentData, WorkspaceDetail } from "@/lib/api";
import { workspacePrCommentsQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";

type FilterMode = "all" | "unresolved";

type CommentSourceRole = "goal" | "card";

type CommentSource = {
	role: CommentSourceRole;
	workspace: WorkspaceDetail;
};

type GoalCommentsViewProps = {
	goalWorkspace?: WorkspaceDetail | null;
	workspaces: WorkspaceDetail[];
	onSelectWorkspace?: (workspace: WorkspaceDetail) => void;
};

type SourceState = {
	source: CommentSource;
	data: PrCommentData;
	isLoading: boolean;
	isFetching: boolean;
	isError: boolean;
};

const EMPTY_COMMENT_DATA: PrCommentData = {
	comments: [],
	prNumber: null,
	prUrl: null,
};

function relativeTime(dateString: string): string {
	const date = new Date(dateString);
	const diffMs = Date.now() - date.getTime();
	const mins = Math.floor(diffMs / 60_000);
	if (mins < 1) return "just now";
	const hours = Math.floor(diffMs / 3_600_000);
	if (mins < 60) return `${mins}m ago`;
	const days = Math.floor(diffMs / 86_400_000);
	if (hours < 24) return `${hours}h ago`;
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
}

export function GoalCommentsView({
	goalWorkspace,
	workspaces,
	onSelectWorkspace,
}: GoalCommentsViewProps) {
	const [filterMode, setFilterMode] = useState<FilterMode>("all");

	const sources = useMemo(() => {
		const next: CommentSource[] = [];
		if (goalWorkspace) {
			next.push({ role: "goal", workspace: goalWorkspace });
		}
		for (const workspace of workspaces) {
			next.push({ role: "card", workspace });
		}
		return next;
	}, [goalWorkspace, workspaces]);

	const results = useQueries({
		queries: sources.map((source) => ({
			...workspacePrCommentsQueryOptions(source.workspace.id),
			enabled: source.workspace.state !== "archived",
		})),
	});

	const states: SourceState[] = sources.map((source, index) => {
		const result = results[index];
		return {
			source,
			data: result.data ?? EMPTY_COMMENT_DATA,
			isLoading: result.isLoading || (result.isFetching && !result.data),
			isFetching: result.isFetching,
			isError: result.isError,
		};
	});

	const totalComments = states.reduce(
		(count, state) => count + state.data.comments.length,
		0,
	);
	const unresolvedCount = states.reduce(
		(count, state) =>
			count +
			state.data.comments.filter((comment) => !comment.isThreadResolved).length,
		0,
	);
	const loadingCount = states.filter((state) => state.isLoading).length;

	// In "all" mode: show sections that have a PR or are loading/errored.
	// Silently collapse sections with no PR and no comments — they add noise.
	// In "unresolved" mode: show only sections with at least one unresolved comment,
	// plus any still loading (they might have content once resolved).
	const visibleStates = useMemo(() => {
		if (filterMode === "unresolved") {
			return states.filter(
				(s) => s.isLoading || s.data.comments.some((c) => !c.isThreadResolved),
			);
		}
		return states.filter(
			(s) => s.isLoading || s.isError || s.data.prUrl != null,
		);
	}, [states, filterMode]);

	// Count workspaces that have no PR and aren't loading — hidden in "all" mode.
	const hiddenNoPrCount = useMemo(
		() =>
			filterMode === "all"
				? states.filter(
						(s) => !s.isLoading && !s.isError && s.data.prUrl == null,
					).length
				: 0,
		[states, filterMode],
	);

	const allDoneLoading = loadingCount === 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-background">
			{/* Header */}
			<div className="flex shrink-0 items-center gap-3 border-b border-border/70 px-5 py-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 text-sm font-semibold">
						<MessageSquare className="size-4 shrink-0 text-muted-foreground" />
						<span>Pull request comments</span>
						{allDoneLoading && (
							<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
								{unresolvedCount > 0
									? `${unresolvedCount} unresolved`
									: `${totalComments} total`}
							</span>
						)}
					</div>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						Review comments from the goal workspace and every child workspace.
					</p>
				</div>

				<div className="flex shrink-0 items-center gap-2">
					{loadingCount > 0 && (
						<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
							<LoaderCircle className="size-3 animate-spin" />
							<span>Loading {loadingCount}</span>
						</div>
					)}

					{/* Filter toggle */}
					<div className="flex overflow-hidden rounded-md border border-border/60">
						{(["all", "unresolved"] as const).map((mode) => (
							<button
								key={mode}
								type="button"
								onClick={() => setFilterMode(mode)}
								className={cn(
									"cursor-pointer px-2.5 py-1 text-[11px] capitalize transition-colors",
									filterMode === mode
										? "bg-muted font-medium text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{mode}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{visibleStates.map((state) => (
					<CommentGroup
						key={state.source.workspace.id}
						state={state}
						onSelectWorkspace={
							onSelectWorkspace && state.source.role === "card"
								? () => onSelectWorkspace(state.source.workspace)
								: undefined
						}
					/>
				))}

				{/* Empty states */}
				{visibleStates.length === 0 && allDoneLoading ? (
					filterMode === "unresolved" ? (
						<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
							<MessageSquare
								className="size-8 text-muted-foreground/20"
								strokeWidth={1.2}
							/>
							<p className="text-sm text-muted-foreground">
								No unresolved comments.
							</p>
						</div>
					) : (
						<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
							<GitPullRequest
								className="size-8 text-muted-foreground/20"
								strokeWidth={1.2}
							/>
							<div className="space-y-1">
								<p className="text-sm text-muted-foreground">
									No pull requests yet.
								</p>
								<p className="text-[11px] text-muted-foreground/70">
									Create PRs from the Actions tab in each workspace.
								</p>
							</div>
						</div>
					)
				) : null}

				{/* Footer: workspaces without a PR are collapsed to save space */}
				{hiddenNoPrCount > 0 && (
					<div className="px-5 py-3 text-[11px] text-muted-foreground/50">
						{hiddenNoPrCount === 1
							? "1 workspace has no PR yet"
							: `${hiddenNoPrCount} workspaces have no PR yet`}
					</div>
				)}
			</div>
		</div>
	);
}

function CommentGroup({
	state,
	onSelectWorkspace,
}: {
	state: SourceState;
	onSelectWorkspace?: () => void;
}) {
	const { source, data, isLoading, isFetching, isError } = state;
	const unresolvedCount = data.comments.filter(
		(comment) => !comment.isThreadResolved,
	).length;
	const label = source.role === "goal" ? "Goal" : "Card";
	const prLabel = data.prNumber ? `#${data.prNumber}` : null;

	return (
		<section className="border-b border-border/50">
			<div className="flex items-center gap-3 bg-muted/20 px-5 py-3">
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-2">
						<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{label}
						</span>
						<span className="truncate text-[13px] font-medium">
							{source.workspace.title}
						</span>
						{prLabel ? (
							<span className="shrink-0 text-[11px] text-muted-foreground">
								{prLabel}
							</span>
						) : null}
					</div>
					<div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
						{unresolvedCount > 0 ? (
							<span className="font-medium text-[var(--workspace-pr-conflicts-accent)]">
								{unresolvedCount} unresolved
							</span>
						) : (
							<span>
								{data.comments.length === 0 ? "No comments" : "All resolved"}
							</span>
						)}
						{isFetching && !isLoading ? (
							<span className="text-muted-foreground/50">Refreshing…</span>
						) : null}
						{isError ? (
							<span className="text-destructive">Load failed</span>
						) : null}
					</div>
				</div>
				{onSelectWorkspace ? (
					<button
						type="button"
						onClick={onSelectWorkspace}
						className="shrink-0 cursor-pointer rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
					>
						Open card
					</button>
				) : null}
				{data.prUrl ? (
					<button
						type="button"
						onClick={() => void openUrl(data.prUrl!)}
						className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
						aria-label={`Open ${source.workspace.title} pull request`}
					>
						<ArrowUpRight className="size-3.5" />
					</button>
				) : null}
			</div>
			{isLoading ? (
				<div className="flex items-center gap-1.5 px-5 py-4 text-[12px] text-muted-foreground">
					<LoaderCircle className="size-3 animate-spin opacity-50" />
					<span>Loading comments…</span>
				</div>
			) : data.comments.length > 0 ? (
				<div>
					{data.comments.map((comment) => (
						<AggregatedComment key={comment.id} comment={comment} />
					))}
				</div>
			) : null}
		</section>
	);
}

const AggregatedComment = memo(function AggregatedComment({
	comment,
}: {
	comment: PrComment;
}) {
	const basename = comment.filePath?.split("/").pop() ?? null;
	return (
		<div className="group/comment flex items-start gap-3 border-t border-border/35 px-5 py-3 transition-colors hover:bg-muted/15">
			<span
				aria-label={comment.isThreadResolved ? "Resolved" : "Unresolved"}
				className={cn(
					"mt-1.5 size-2 shrink-0 rounded-full",
					comment.isThreadResolved
						? "bg-[oklch(0.62_0.14_165)]"
						: "border-[1.5px] border-[var(--workspace-pr-conflicts-accent)]",
				)}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-[12px] font-medium">
						@{comment.author}
					</span>
					<span className="text-[10.5px] text-muted-foreground/50">·</span>
					<span className="shrink-0 text-[10.5px] text-muted-foreground/60">
						{relativeTime(comment.createdAt)}
					</span>
				</div>
				{basename ? (
					<div className="mt-1.5">
						<span
							className="inline-flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
							title={comment.filePath ?? undefined}
						>
							<FileIcon className="size-2.5 shrink-0" strokeWidth={1.7} />
							{basename}
						</span>
					</div>
				) : null}
				<div
					className={cn(
						"conversation-markdown mt-2 max-w-none break-words text-[12.5px] leading-relaxed",
						comment.isThreadResolved
							? "text-muted-foreground"
							: "text-foreground/90",
					)}
				>
					<Suspense fallback={<p>{comment.body.trim()}</p>}>
						<LazyStreamdown className="conversation-streamdown" mode="static">
							{comment.body.trim() || "No comment body"}
						</LazyStreamdown>
					</Suspense>
				</div>
			</div>
			<button
				type="button"
				onClick={() => void openUrl(comment.url)}
				className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-55 transition-[opacity,color,background-color] hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus-visible:opacity-100"
				aria-label={`Open comment by @${comment.author}`}
			>
				<ArrowUpRight className="size-3.5" />
			</button>
		</div>
	);
});
