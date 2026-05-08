import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRightIcon, FileIcon, LoaderCircleIcon } from "lucide-react";
import { useCallback, useState } from "react";
import {
	AppendContextButton,
	type AppendContextPayloadResult,
} from "@/components/append-context-button";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShimmerText } from "@/components/ui/shimmer-text";
import type { PrComment, PrCommentData } from "@/lib/api";
import { buildComposerPreviewPayload } from "@/lib/composer-insert";
import { cn } from "@/lib/utils";
import { buildPrCommentInsertText } from "../pr-comments";

type CommentsTabProps = {
	workspaceId: string | null;
	prCommentData: PrCommentData;
	isFetching: boolean;
	isActive: boolean;
	onReviewAllComments?: (comments: PrComment[]) => void | Promise<void>;
};

function formatRelativeTime(dateString: string): string {
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

export function CommentsTab({
	workspaceId,
	prCommentData,
	isFetching,
	isActive,
	onReviewAllComments,
}: CommentsTabProps) {
	const [reviewAllLoading, setReviewAllLoading] = useState(false);

	const unresolvedCount = prCommentData.comments.filter(
		(c) => !c.isThreadResolved,
	).length;
	const hasUnresolved = unresolvedCount > 0;

	const handleReviewAll = useCallback(async () => {
		if (!onReviewAllComments || reviewAllLoading) return;
		setReviewAllLoading(true);
		try {
			await onReviewAllComments(prCommentData.comments);
		} finally {
			setReviewAllLoading(false);
		}
	}, [onReviewAllComments, prCommentData.comments, reviewAllLoading]);

	const handleInsertComment = useCallback(
		(comment: PrComment): AppendContextPayloadResult => {
			if (!workspaceId) return null;
			const submitText = buildPrCommentInsertText(comment);
			const label = comment.filePath
				? `Comment on ${comment.filePath}`
				: `Comment by @${comment.author}`;
			return {
				target: { workspaceId },
				label,
				submitText,
				key: `pr-comment:${comment.id}`,
				preview: buildComposerPreviewPayload({
					title: comment.filePath
						? `PR Comment – ${comment.filePath}`
						: `PR Comment by @${comment.author}`,
					content: submitText,
					preferredKind: "code",
				}),
			};
		},
		[workspaceId],
	);

	const isLoading = isFetching && prCommentData.comments.length === 0;

	const headerLabel = isLoading
		? null
		: hasUnresolved
			? `${unresolvedCount} unresolved`
			: prCommentData.comments.length > 0
				? "All resolved"
				: "No comments";

	return (
		<div
			id="inspector-panel-comments"
			role="tabpanel"
			aria-labelledby="inspector-tab-comments"
			hidden={!isActive}
			className={cn(
				"relative flex min-h-0 flex-1 flex-col",
				!isActive && "pointer-events-none absolute inset-0 invisible opacity-0",
			)}
		>
			{/* Tab header bar */}
			<div className="flex h-8 shrink-0 items-center justify-between border-b border-border/60 bg-muted/25 px-3">
				{isLoading ? (
					<div className="flex items-center gap-1.5 text-muted-foreground">
						<LoaderCircleIcon
							className="size-3 animate-spin opacity-50"
							strokeWidth={2}
						/>
						<span className="text-[11px]">Loading comments…</span>
					</div>
				) : (
					<span className="text-[11px] text-muted-foreground">
						{headerLabel}
					</span>
				)}

				{hasUnresolved && onReviewAllComments && (
					<button
						type="button"
						onClick={() => void handleReviewAll()}
						disabled={reviewAllLoading}
						className="cursor-pointer text-[11px] text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
						aria-label="Review all PR comments"
						aria-busy={reviewAllLoading || undefined}
					>
						{reviewAllLoading ? (
							<span className="inline-flex items-center gap-1.5">
								<LoaderCircleIcon
									className="size-3 animate-spin"
									strokeWidth={2}
								/>
								<ShimmerText>Reviewing…</ShimmerText>
							</span>
						) : (
							"Review all"
						)}
					</button>
				)}
			</div>

			{/* Thread */}
			<ScrollArea className="min-h-0 flex-1">
				{prCommentData.comments.map((comment) => (
					<CommentEntry
						key={comment.id}
						comment={comment}
						onInsertComment={handleInsertComment}
					/>
				))}
			</ScrollArea>
		</div>
	);
}

function CommentEntry({
	comment,
	onInsertComment,
}: {
	comment: PrComment;
	onInsertComment: (comment: PrComment) => AppendContextPayloadResult;
}) {
	const basename = comment.filePath?.split("/").pop() ?? null;
	const relativeTime = formatRelativeTime(comment.createdAt);
	const isResolved = comment.isThreadResolved;

	return (
		<div className="group/comment-entry border-b border-border/40 px-3 py-3 transition-colors hover:bg-muted/20">
			<div className="flex items-start gap-2">
				{/* Left: content */}
				<div className="min-w-0 flex-1">
					{/* Author row */}
					<div className="flex items-center gap-1.5">
						{isResolved ? (
							<span
								aria-label="Resolved"
								className="mt-px size-[7px] shrink-0 rounded-full bg-[oklch(0.62_0.14_165)]"
							/>
						) : (
							<span
								aria-label="Unresolved"
								className="mt-px size-[7px] shrink-0 rounded-full border-[1.5px] border-[var(--workspace-pr-conflicts-accent)]"
							/>
						)}
						<span className="truncate text-[11.5px] font-medium text-foreground">
							@{comment.author}
						</span>
						<span className="shrink-0 text-[10.5px] text-muted-foreground/50">
							·
						</span>
						<span className="shrink-0 text-[10.5px] text-muted-foreground/50">
							{relativeTime}
						</span>
					</div>

					{/* File chip */}
					{basename && (
						<div className="mt-1.5">
							<span
								className="inline-flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
								title={comment.filePath ?? undefined}
							>
								<FileIcon className="size-2.5 shrink-0" strokeWidth={1.7} />
								{basename}
							</span>
						</div>
					)}

					{/* Body */}
					<p
						className={cn(
							"mt-2 break-words text-[12.5px] leading-relaxed whitespace-pre-wrap",
							isResolved ? "text-muted-foreground" : "text-foreground/90",
						)}
					>
						{comment.body.trim() || (
							<span className="italic text-muted-foreground/60">
								No comment body
							</span>
						)}
					</p>
				</div>

				{/* Right: actions — revealed on hover */}
				<div className="flex shrink-0 items-center gap-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover/comment-entry:opacity-100">
					<AppendContextButton
						subjectLabel={
							comment.filePath
								? `Comment on ${comment.filePath}`
								: `Comment by @${comment.author}`
						}
						getPayload={() => onInsertComment(comment)}
						errorTitle="Couldn't insert comment"
						className="size-5 rounded-sm text-muted-foreground opacity-55 transition-[opacity,color,background-color] hover:bg-accent/60 hover:text-primary hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3"
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label={`Open comment by @${comment.author}`}
						onClick={() => void openUrl(comment.url)}
						className="size-5 rounded-sm text-muted-foreground opacity-55 transition-[opacity,color,background-color] hover:bg-accent/60 hover:text-primary hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5"
					>
						<ArrowUpRightIcon strokeWidth={1.8} />
					</Button>
				</div>
			</div>
		</div>
	);
}
