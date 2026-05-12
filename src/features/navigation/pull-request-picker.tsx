import { GitMerge, LoaderCircle, Search } from "lucide-react";
import { useState } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GithubPullRequestSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Stack detection
// ---------------------------------------------------------------------------

export type StackGroup = {
	prs: GithubPullRequestSummary[];
	isStack: boolean;
};

/**
 * Group a flat list of PRs into stack chains.
 *
 * A "stack" is a sequence of PRs where each PR's headBranch is the
 * baseBranch of the next PR. Detection is purely based on the branch names
 * already present in GithubPullRequestSummary — no extra API calls needed.
 *
 * Edge cases handled:
 * - Cycles: visited-set guard terminates the walk early.
 * - Orphans (chain root outside the 30-PR window): appended as standalone.
 * - Parallel PRs on the same base: both detected as roots, rendered without
 *   a stack header.
 * - Duplicate headBranch values: last-wins; earlier PR becomes a standalone
 *   root.
 */
export function computeStackGroups(
	pullRequests: GithubPullRequestSummary[],
): StackGroup[] {
	// headBranch → PR: used to check whether a baseBranch is "owned" by
	// another PR (root detection).
	const headBranchToPr = new Map<string, GithubPullRequestSummary>();
	// baseBranch → PR: used to follow the chain forward.
	// Key = a PR's baseBranch, value = that PR.
	// baseBranchToPr.get(X) answers "which PR has X as its base?" i.e. the
	// PR stacked on top of the branch named X.
	const baseBranchToPr = new Map<string, GithubPullRequestSummary>();

	for (const pr of pullRequests) {
		headBranchToPr.set(pr.headBranch, pr);
		baseBranchToPr.set(pr.baseBranch, pr);
	}

	// A PR is a root when its baseBranch is not any other PR's headBranch.
	const headBranches = new Set(pullRequests.map((pr) => pr.headBranch));
	const roots = pullRequests.filter((pr) => !headBranches.has(pr.baseBranch));

	const visited = new Set<number>();
	const groups: StackGroup[] = [];

	for (const root of roots) {
		if (visited.has(root.number)) continue;
		const chain: GithubPullRequestSummary[] = [];
		let current: GithubPullRequestSummary | undefined = root;
		while (current && !visited.has(current.number)) {
			visited.add(current.number);
			chain.push(current);
			// Next = the PR whose baseBranch equals current.headBranch
			current = baseBranchToPr.get(current.headBranch);
		}
		groups.push({ prs: chain, isStack: chain.length >= 2 });
	}

	// Orphan pass: PRs whose root was outside the fetched window.
	for (const pr of pullRequests) {
		if (!visited.has(pr.number)) {
			groups.push({ prs: [pr], isStack: false });
		}
	}

	return groups;
}

// ---------------------------------------------------------------------------
// PullRequestPicker component
// ---------------------------------------------------------------------------

type PullRequestPickerProps = {
	pullRequests: GithubPullRequestSummary[];
	loading: boolean;
	selectedPrNumber: number | null;
	creating: boolean;
	onSelect: (number: number) => void;
};

export function PullRequestPicker({
	pullRequests,
	loading,
	selectedPrNumber,
	creating,
	onSelect,
}: PullRequestPickerProps) {
	if (pullRequests.length === 0 && !loading) {
		return (
			<div className="min-h-28 min-w-0 rounded-md border border-app-border/50 px-3 py-8 text-center text-[12px] text-muted-foreground">
				No open pull requests.
			</div>
		);
	}

	if (pullRequests.length === 0 && loading) {
		return (
			<div className="flex min-h-28 min-w-0 items-center justify-center gap-2 rounded-md border border-app-border/50 px-3 py-8 text-[12px] text-muted-foreground">
				<LoaderCircle className="size-3.5 animate-spin" />
				Loading pull requests...
			</div>
		);
	}

	const groups = computeStackGroups(pullRequests);

	return (
		<div className="min-w-0 overflow-hidden rounded-md border border-app-border/50">
			<div className="border-b border-app-border/50 bg-muted/40 px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.02em] text-muted-foreground">
				Pull requests
			</div>
			<TooltipProvider delayDuration={400}>
				<div
					aria-label="Open pull requests"
					className="max-h-[260px] min-w-0 overflow-y-auto p-1"
				>
					{groups.map((group) => (
						<div key={group.prs[0]?.number}>
							{group.isStack && (
								<div className="mb-0.5 mt-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground/70 first:mt-0">
									Stack ({group.prs.length})
								</div>
							)}
							{group.prs.map((pr) => (
								<PullRequestRow
									key={pr.number}
									pr={pr}
									isSelected={selectedPrNumber === pr.number}
									creating={creating}
									indented={group.isStack}
									onSelect={onSelect}
								/>
							))}
						</div>
					))}
				</div>
			</TooltipProvider>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Individual PR row
// ---------------------------------------------------------------------------

function PullRequestRow({
	pr,
	isSelected,
	creating,
	indented,
	onSelect,
}: {
	pr: GithubPullRequestSummary;
	isSelected: boolean;
	creating: boolean;
	indented: boolean;
	onSelect: (number: number) => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-pressed={isSelected}
					className={cn(
						"flex w-full cursor-pointer items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60",
						isSelected && "bg-accent text-foreground",
						indented && "pl-3",
					)}
					onClick={() => onSelect(pr.number)}
					disabled={creating}
				>
					{/* Left: title + branch relationship */}
					<div className="min-w-0 flex-1">
						<div className="truncate text-[12px]">
							#{pr.number} {pr.title}
						</div>
						<div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
							{pr.baseBranch} ← {pr.headBranch}
						</div>
					</div>
					{/* Right: additions / deletions */}
					<div className="flex shrink-0 items-center gap-1 pt-0.5 font-medium tabular-nums text-[11px]">
						<span className="text-green-600 dark:text-green-400">
							+{pr.additions}
						</span>
						<span className="text-destructive">-{pr.deletions}</span>
					</div>
				</button>
			</TooltipTrigger>
			<TooltipContent
				side="top"
				align="start"
				className="max-w-sm flex-col items-start gap-1"
			>
				<p className="font-medium leading-snug">
					#{pr.number} {pr.title}
				</p>
				<p className="font-mono text-[10px] opacity-70">
					{pr.headBranch} -&gt; {pr.baseBranch}
				</p>
			</TooltipContent>
		</Tooltip>
	);
}

// ---------------------------------------------------------------------------
// GoalPullRequestPicker — rich stack-aware click-row list for the Goal tab
// ---------------------------------------------------------------------------

type GoalPullRequestPickerProps = {
	pullRequests: GithubPullRequestSummary[];
	loading: boolean;
	selectedPrNumber: number | null;
	disabled: boolean;
	onSelect: (number: number) => void;
};

export function GoalPullRequestPicker({
	pullRequests,
	loading,
	selectedPrNumber,
	disabled,
	onSelect,
}: GoalPullRequestPickerProps) {
	const [searchQuery, setSearchQuery] = useState("");

	const filtered = searchQuery.trim()
		? pullRequests.filter((pr) => {
				const q = searchQuery.toLowerCase();
				return (
					pr.title.toLowerCase().includes(q) ||
					pr.headBranch.toLowerCase().includes(q) ||
					pr.baseBranch.toLowerCase().includes(q) ||
					String(pr.number).includes(q)
				);
			})
		: pullRequests;

	if (loading && pullRequests.length === 0) {
		return (
			<div className="flex min-h-[72px] items-center justify-center gap-2 rounded-md border border-app-border/50 px-3 py-4 text-[12px] text-muted-foreground">
				<LoaderCircle className="size-3.5 animate-spin" />
				Loading pull requests…
			</div>
		);
	}

	if (!loading && pullRequests.length === 0) {
		return (
			<div className="flex min-h-[72px] items-center justify-center rounded-md border border-app-border/50 px-3 py-4 text-center text-[12px] text-muted-foreground">
				No open pull requests.
			</div>
		);
	}

	const groups = computeStackGroups(filtered);

	return (
		<div className="min-w-0 overflow-hidden rounded-md border border-app-border/50">
			{/* Search bar */}
			<div className="flex items-center gap-1.5 border-b border-app-border/50 px-2.5 py-1.5">
				<Search className="size-3 shrink-0 text-muted-foreground/60" />
				<input
					type="search"
					placeholder="Search pull requests…"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
				/>
			</div>
			<TooltipProvider delayDuration={400}>
				<div
					aria-label="Open pull requests"
					className="max-h-[200px] min-w-0 overflow-y-auto p-1"
				>
					{filtered.length === 0 ? (
						<p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
							No results for "{searchQuery}"
						</p>
					) : (
						groups.map((group) =>
							group.isStack ? (
								<GoalStackGroup
									key={group.prs[0]?.number}
									group={group}
									selectedPrNumber={selectedPrNumber}
									disabled={disabled}
									onSelect={onSelect}
								/>
							) : (
								<GoalPrRow
									key={group.prs[0]?.number}
									pr={group.prs[0]!}
									isRoot={false}
									isLast={true}
									showConnector={false}
									isSelected={selectedPrNumber === group.prs[0]?.number}
									disabled={disabled}
									onSelect={onSelect}
								/>
							),
						)
					)}
				</div>
			</TooltipProvider>
		</div>
	);
}

function GoalStackGroup({
	group,
	selectedPrNumber,
	disabled,
	onSelect,
}: {
	group: StackGroup;
	selectedPrNumber: number | null;
	disabled: boolean;
	onSelect: (number: number) => void;
}) {
	return (
		<div className="mb-1 last:mb-0">
			<div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground/70 first:pt-0">
				<GitMerge className="size-3" />
				Stack ({group.prs.length})
			</div>
			{group.prs.map((pr, index) => (
				<GoalPrRow
					key={pr.number}
					pr={pr}
					isRoot={index === 0}
					isLast={index === group.prs.length - 1}
					showConnector={true}
					isSelected={selectedPrNumber === pr.number}
					disabled={disabled}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}

function GoalPrRow({
	pr,
	isRoot,
	isLast,
	showConnector,
	isSelected,
	disabled,
	onSelect,
}: {
	pr: GithubPullRequestSummary;
	isRoot: boolean;
	isLast: boolean;
	showConnector: boolean;
	isSelected: boolean;
	disabled: boolean;
	onSelect: (number: number) => void;
}) {
	return (
		<div className="flex min-w-0">
			{/* Stack connector column */}
			{showConnector && (
				<div className="relative flex w-5 shrink-0 items-center justify-center">
					{/* Line from top → dot center (all non-root items) */}
					{!isRoot && (
						<div className="absolute top-0 bottom-1/2 left-1/2 w-px bg-border/50" />
					)}
					{/* Dot */}
					<div
						className={cn(
							"relative z-10 size-1.5 shrink-0 rounded-full",
							isRoot ? "bg-primary" : "bg-muted-foreground/40",
						)}
					/>
					{/* Line from dot center → bottom (all non-last items) */}
					{!isLast && (
						<div className="absolute top-1/2 bottom-0 left-1/2 w-px bg-border/50" />
					)}
				</div>
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-pressed={isSelected}
						disabled={disabled}
						onClick={() => onSelect(pr.number)}
						className={cn(
							"flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60",
							isSelected && "bg-accent text-foreground",
						)}
					>
						<div className="min-w-0 flex-1">
							<div className="flex min-w-0 items-center gap-1.5">
								<span className="truncate text-[12px]">
									#{pr.number} {pr.title}
								</span>
								{isRoot && showConnector && (
									<span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.04em] text-primary">
										Root
									</span>
								)}
							</div>
							<div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
								{pr.baseBranch} ← {pr.headBranch}
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-1 pt-0.5 font-medium tabular-nums text-[11px]">
							<span className="text-green-600 dark:text-green-400">
								+{pr.additions}
							</span>
							<span className="text-destructive">-{pr.deletions}</span>
						</div>
					</button>
				</TooltipTrigger>
				<TooltipContent
					side="top"
					align="start"
					className="max-w-sm flex-col items-start gap-1"
				>
					<p className="font-medium leading-snug">
						#{pr.number} {pr.title}
					</p>
					<p className="font-mono text-[10px] opacity-70">
						{pr.headBranch} → {pr.baseBranch}
					</p>
				</TooltipContent>
			</Tooltip>
		</div>
	);
}
