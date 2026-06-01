import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { GitBranchIcon, GitCommitIcon, GitMergeIcon } from "lucide-react";
import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GitTimelineCommit } from "@/lib/api";
import { workspaceGitTimelineQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";

// ─── Decoration parsing ────────────────────────────────────────────────────────
// `%D` from `git log --decorate=short` looks like:
//   "HEAD -> main, origin/main, tag: v1.0, refs/stash"
// We split on `, `, then classify each segment so we can render it with the
// right style (HEAD pointer, local branch, remote branch, tag).

type DecorationKind = "head" | "branch" | "remote" | "tag";

type ParsedDecoration = {
	kind: DecorationKind;
	label: string;
	/** True when this segment is `HEAD -> <branch>` — the local branch the
	 * workspace currently has checked out. Rendered with extra emphasis. */
	isHeadTarget?: boolean;
};

function parseDecorations(raw: string): ParsedDecoration[] {
	if (!raw.trim()) return [];
	return raw
		.split(", ")
		.map((segment) => segment.trim())
		.filter(Boolean)
		.map<ParsedDecoration | null>((segment) => {
			// `HEAD -> main` — the current branch tip. Show HEAD itself, then
			// the branch with `isHeadTarget` so we can highlight it.
			if (segment.startsWith("HEAD -> ")) {
				const branch = segment.slice("HEAD -> ".length);
				return { kind: "branch", label: branch, isHeadTarget: true };
			}
			if (segment === "HEAD") {
				return { kind: "head", label: "HEAD" };
			}
			if (segment.startsWith("tag: ")) {
				return { kind: "tag", label: segment.slice("tag: ".length) };
			}
			// `origin/main`, `upstream/feature/foo`, … — anything containing a
			// "/" is treated as a remote-tracking ref. Local branches never
			// contain "/" in git's decoration output (refs/heads/<name>).
			if (segment.includes("/")) {
				return { kind: "remote", label: segment };
			}
			return { kind: "branch", label: segment };
		})
		.filter((d): d is ParsedDecoration => d !== null);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeDate(iso: string): string {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	try {
		return formatDistanceToNowStrict(date, { addSuffix: true });
	} catch {
		return "";
	}
}

function initialsFor(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
	return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// ─── Decoration chip ───────────────────────────────────────────────────────────

function DecorationChip({ decoration }: { decoration: ParsedDecoration }) {
	const base =
		"inline-flex h-4 shrink-0 items-center gap-1 rounded-sm border px-1 text-[10px] font-medium leading-none";
	switch (decoration.kind) {
		case "head":
			return (
				<span
					className={cn(
						base,
						"border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300",
					)}
				>
					HEAD
				</span>
			);
		case "branch":
			return (
				<span
					className={cn(
						base,
						decoration.isHeadTarget
							? "border-blue-500/40 bg-blue-500/15 text-blue-600 dark:text-blue-300"
							: "border-border bg-muted/40 text-muted-foreground",
					)}
				>
					<GitBranchIcon
						className="size-2.5"
						strokeWidth={2}
						aria-hidden="true"
					/>
					{decoration.label}
				</span>
			);
		case "remote":
			return (
				<span
					className={cn(
						base,
						"border-border bg-muted/20 text-muted-foreground",
					)}
				>
					{decoration.label}
				</span>
			);
		case "tag":
			return (
				<span
					className={cn(
						base,
						"border-violet-500/40 bg-violet-500/15 text-violet-600 dark:text-violet-300",
					)}
				>
					{decoration.label}
				</span>
			);
	}
}

// ─── Commit row ────────────────────────────────────────────────────────────────

type CommitRowProps = {
	commit: GitTimelineCommit;
	/** True when this commit is the tip of the current branch (carries HEAD). */
	isHead: boolean;
	/** False on the very first row — hide the line segment above the dot. */
	hasLineAbove: boolean;
	/** False on the very last row — hide the line segment below the dot. */
	hasLineBelow: boolean;
};

function CommitRow({
	commit,
	isHead,
	hasLineAbove,
	hasLineBelow,
}: CommitRowProps) {
	const decorations = useMemo(
		() => parseDecorations(commit.refs),
		[commit.refs],
	);
	const relativeDate = useMemo(
		() => formatRelativeDate(commit.authorDate),
		[commit.authorDate],
	);
	const isMerge = commit.parents.length >= 2;

	return (
		<div className="group/commit relative flex items-stretch gap-2 px-2 py-1.5 transition-colors hover:bg-accent/30">
			{/* Graph rail — fixed-width column with the vertical line + dot. */}
			<div
				className="relative flex w-5 shrink-0 justify-center"
				aria-hidden="true"
			>
				{/* Vertical line. Painted in two halves (above + below the dot)
				 * so the very first and very last rows don't have a line
				 * hanging off the end. */}
				<span
					className={cn(
						"absolute top-0 left-1/2 w-px -translate-x-1/2 bg-border",
						hasLineAbove ? "h-3" : "h-0",
					)}
				/>
				<span
					className={cn(
						"absolute bottom-0 left-1/2 w-px -translate-x-1/2 bg-border",
						hasLineBelow ? "top-3 h-auto" : "h-0",
					)}
				/>
				{/* Commit dot. Merges get a hollow ring + merge icon, normal
				 * commits get a filled circle. HEAD commit gets an accent
				 * outline so the user sees where they are at a glance. */}
				<span
					className={cn(
						"relative z-10 mt-2.5 flex size-3 items-center justify-center rounded-full border-2 bg-sidebar",
						isHead
							? "border-blue-500 shadow-[0_0_0_2px_var(--color-sidebar)] ring-2 ring-blue-500/30"
							: isMerge
								? "border-muted-foreground/60"
								: "border-foreground/70",
					)}
				>
					{isMerge ? (
						<GitMergeIcon
							className="size-2 text-muted-foreground"
							strokeWidth={2.5}
						/>
					) : (
						<span
							className={cn(
								"size-1.5 rounded-full",
								isHead ? "bg-blue-500" : "bg-foreground/70",
							)}
						/>
					)}
				</span>
			</div>

			{/* Commit body. */}
			<div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
				<div className="flex min-w-0 items-center gap-1.5">
					{/* Subject — bold for emphasis, truncated to one line. The
					 * full message is in a tooltip so long subjects stay
					 * discoverable. */}
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
								{commit.subject || "(no subject)"}
							</span>
						</TooltipTrigger>
						<TooltipContent side="left" className="max-w-md text-[11px]">
							{commit.subject || "(no subject)"}
						</TooltipContent>
					</Tooltip>
					{/* Short SHA — monospace chip on the right so it lines up
					 * across rows and is easy to copy/scan. */}
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={() => {
									navigator.clipboard.writeText(commit.sha).catch(() => {});
								}}
								className="shrink-0 cursor-pointer rounded-sm border border-transparent px-1 font-mono text-[10px] tracking-tight text-muted-foreground hover:border-border hover:text-foreground"
							>
								{commit.shortSha}
							</button>
						</TooltipTrigger>
						<TooltipContent side="left" className="font-mono text-[10px]">
							{commit.sha}
							<div className="mt-0.5 text-muted-foreground">Click to copy</div>
						</TooltipContent>
					</Tooltip>
				</div>

				{decorations.length > 0 && (
					<div className="flex min-w-0 flex-wrap items-center gap-1">
						{decorations.map((decoration, idx) => (
							<DecorationChip
								// Refs are unique per commit in practice, but a HEAD
								// pointer can coexist with the same branch label, so
								// include the kind in the key to be safe.
								key={`${decoration.kind}:${decoration.label}:${idx}`}
								decoration={decoration}
							/>
						))}
					</div>
				)}

				<div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-semibold uppercase text-muted-foreground">
								{initialsFor(commit.authorName)}
							</span>
						</TooltipTrigger>
						<TooltipContent side="left" className="text-[11px]">
							{commit.authorName}
							{commit.authorEmail ? (
								<div className="text-muted-foreground">
									{commit.authorEmail}
								</div>
							) : null}
						</TooltipContent>
					</Tooltip>
					<span className="truncate">{commit.authorName}</span>
					{relativeDate && (
						<>
							<span aria-hidden="true">·</span>
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="shrink-0">{relativeDate}</span>
								</TooltipTrigger>
								<TooltipContent side="left" className="text-[11px]">
									{commit.authorDate}
								</TooltipContent>
							</Tooltip>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

// ─── Section ───────────────────────────────────────────────────────────────────

type GitTimelineSectionProps = {
	workspaceRootPath: string | null;
	isActive: boolean;
};

export function GitTimelineSection({
	workspaceRootPath,
	isActive,
}: GitTimelineSectionProps) {
	const enabled = isActive && !!workspaceRootPath;
	const { data, isLoading, isError, error } = useQuery({
		...workspaceGitTimelineQueryOptions(workspaceRootPath ?? "__none__"),
		enabled,
	});

	const commits = data ?? [];
	// The HEAD commit is the one whose decoration string contains the literal
	// "HEAD" token. In practice this is always commits[0] for a normal
	// checkout, but we look it up explicitly so detached-HEAD / pre-rebase
	// states still highlight the right row.
	const headSha = useMemo(() => {
		const headRow = commits.find((c) =>
			c.refs.split(", ").some((seg) => seg.trim().startsWith("HEAD")),
		);
		return headRow?.sha ?? null;
	}, [commits]);

	return (
		<div
			role="tabpanel"
			id="inspector-panel-git-timeline"
			aria-labelledby="inspector-tab-git-timeline"
			className={cn("flex h-full flex-col bg-sidebar", !isActive && "hidden")}
		>
			{/* Status bar — mirrors the Knowledge tab's header strip. */}
			<div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
				<GitCommitIcon className="size-3.5 shrink-0" />
				<span className="flex-1 truncate">
					{workspaceRootPath
						? commits.length > 0
							? `${commits.length} commit${commits.length === 1 ? "" : "s"}`
							: isLoading
								? "Loading history…"
								: "No commits"
						: "No workspace selected"}
				</span>
			</div>

			{!workspaceRootPath ? (
				<div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
					Select a workspace to view its commit history.
				</div>
			) : isError ? (
				<div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
					Failed to load history
					{error instanceof Error ? `: ${error.message}` : "."}
				</div>
			) : commits.length === 0 && !isLoading ? (
				<div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
					This branch has no commits yet.
				</div>
			) : (
				<ScrollArea className="min-h-0 flex-1">
					<ol className="flex flex-col py-1">
						{commits.map((commit, index) => (
							<li key={commit.sha}>
								<CommitRow
									commit={commit}
									isHead={commit.sha === headSha}
									hasLineAbove={index > 0}
									hasLineBelow={index < commits.length - 1}
								/>
							</li>
						))}
					</ol>
				</ScrollArea>
			)}
		</div>
	);
}
