import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
	GitBranch,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	X,
} from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WorkspaceCommitButtonMode } from "@/features/commit/button";
import { CommentsTab } from "@/features/inspector/sections/comments";
import type { PrSyncState, WorkspaceDetail, WorkspaceStatus } from "@/lib/api";
import type { DiffOpenOptions } from "@/lib/editor-session";
import { workspacePrCommentsQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import {
	GOAL_LANES,
	goalLaneForWorkspace,
	isMergedGoalWorkspace,
	isMovableGoalLaneId,
} from "./board-model";
import { ActionsTab, ChangesTab, ThreadTab } from "./card-detail-tabs";
import { GoalTerminalView } from "./terminal-view";
import { useGoalCardCommitLifecycle } from "./use-card-commit-lifecycle";

type PrBadgeMeta = {
	label: string;
	className: string;
	Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

function getPrBadgeMeta(prSyncState?: PrSyncState | null): PrBadgeMeta {
	switch (prSyncState) {
		case "open":
			return {
				label: "Open",
				className:
					"bg-[color-mix(in_srgb,var(--workspace-pr-open-accent)_12%,transparent)] text-[var(--workspace-pr-open-accent)]",
				Icon: GitPullRequest,
			};
		case "merged":
			return {
				label: "Merged",
				className:
					"bg-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_12%,transparent)] text-[var(--workspace-pr-merged-accent)]",
				Icon: GitMerge,
			};
		case "closed":
			return {
				label: "Closed",
				className: "bg-destructive/10 text-destructive",
				Icon: GitPullRequestClosed,
			};
		default:
			return {
				label: "PR",
				className: "bg-muted/60 text-muted-foreground/70",
				Icon: GitPullRequest,
			};
	}
}

function PrStateBadge({
	prSyncState,
	prUrl,
}: {
	prSyncState?: PrSyncState | null;
	prUrl: string;
}) {
	const { label, className, Icon } = getPrBadgeMeta(prSyncState);
	return (
		<button
			type="button"
			onClick={() => void openUrl(prUrl)}
			className={cn(
				"flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-75",
				className,
			)}
			aria-label={`Open pull request — ${label}`}
		>
			<Icon className="size-2.5 shrink-0" strokeWidth={1.8} />
			{label}
		</button>
	);
}

type GoalCardDetailProps = {
	workspace: WorkspaceDetail;
	onClose: () => void;
	onMove: (lane: WorkspaceStatus) => void;
	onOpen?: () => void;
	activeEditorPath?: string | null;
	onOpenEditorFile?: (path: string, options?: DiffOpenOptions) => void;
	onOpenSettings?: () => void;
};

type CardDetailTab = "thread" | "changes" | "actions" | "comments" | "terminal";

export function GoalCardDetailPanel({
	workspace: ws,
	onClose,
	onMove,
	onOpen,
	activeEditorPath,
	onOpenEditorFile,
	onOpenSettings,
}: GoalCardDetailProps) {
	const [activeTab, setActiveTab] = useState<CardDetailTab>("thread");
	const commit = useGoalCardCommitLifecycle(ws);
	const prCommentsQuery = useQuery(workspacePrCommentsQueryOptions(ws.id));
	const currentLaneId = goalLaneForWorkspace(ws);
	const currentLane = GOAL_LANES.find((lane) => lane.id === currentLaneId);
	const moveLanes = GOAL_LANES.filter(
		(lane): lane is (typeof GOAL_LANES)[number] & { id: WorkspaceStatus } =>
			isMovableGoalLaneId(lane.id) && lane.id !== ws.status,
	);

	const unresolvedCommentCount = useMemo(
		() =>
			prCommentsQuery.data?.comments.filter((c) => !c.isThreadResolved)
				.length ?? 0,
		[prCommentsQuery.data],
	);

	const handleCommitAction = useCallback(
		async (mode: WorkspaceCommitButtonMode) => {
			setActiveTab("thread");
			await commit.handleInspectorCommitAction(mode);
		},
		[commit.handleInspectorCommitAction],
	);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border/60 bg-sidebar/60">
			<div className="flex shrink-0 flex-col gap-1.5 border-b border-border/60 px-4 py-3">
				<div className="flex items-start gap-2">
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<h3 className="line-clamp-2 text-sm font-semibold leading-[1.35] tracking-[-0.01em]">
							{ws.title}
						</h3>
						{ws.branch && (
							<div className="flex items-center gap-1">
								<GitBranch className="size-2.5 shrink-0 text-muted-foreground/60" />
								<span className="truncate font-mono text-[10px] text-muted-foreground/70">
									{ws.branch}
								</span>
							</div>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1 pt-0.5">
						{onOpen && (
							<button
								type="button"
								onClick={onOpen}
								className="cursor-pointer rounded px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
							>
								Open ↗
							</button>
						)}
						<button
							type="button"
							onClick={onClose}
							className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
							aria-label="Close"
						>
							<X className="size-3.5" />
						</button>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-1.5">
					{currentLane && (
						<span className="flex items-center gap-1 text-[11px] text-muted-foreground">
							<span
								className="size-1.5 shrink-0 rounded-full"
								style={{ backgroundColor: currentLane.color }}
								aria-hidden="true"
							/>
							{currentLane.label}
						</span>
					)}
					{ws.prUrl && (
						<PrStateBadge prSyncState={ws.prSyncState} prUrl={ws.prUrl} />
					)}
					{isMergedGoalWorkspace(ws) ? (
						<span className="text-[11px] text-muted-foreground">
							Moved by PR state
						</span>
					) : (
						moveLanes.map((lane) => (
							<button
								key={lane.id}
								type="button"
								onClick={() => onMove(lane.id)}
								className="cursor-pointer rounded border border-border/50 px-1.5 py-px text-[10px] text-muted-foreground/70 transition-colors hover:border-border hover:bg-accent hover:text-accent-foreground"
							>
								→ {lane.label}
							</button>
						))
					)}
				</div>
			</div>

			<Tabs
				value={activeTab}
				onValueChange={(v) => setActiveTab(v as CardDetailTab)}
				className="flex min-h-0 flex-1 flex-col overflow-hidden"
			>
				<TabsList
					variant="line"
					className={cn(
						"h-9 shrink-0 rounded-none border-b border-border/60 bg-transparent px-1",
					)}
				>
					<TabsTrigger value="thread" className="text-[12px]">
						Thread
					</TabsTrigger>
					<TabsTrigger value="changes" className="text-[12px]">
						Changes
					</TabsTrigger>
					<TabsTrigger value="actions" className="text-[12px]">
						Actions
					</TabsTrigger>
					<TabsTrigger
						value="comments"
						className="flex items-center gap-1 text-[12px]"
					>
						Comments
						{unresolvedCommentCount > 0 && (
							<span className="inline-flex min-w-[14px] items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--workspace-pr-conflicts-accent)_15%,transparent)] px-1 py-px text-[9px] font-semibold tabular-nums text-[var(--workspace-pr-conflicts-accent)]">
								{unresolvedCommentCount > 99 ? "99+" : unresolvedCommentCount}
							</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="terminal" className="text-[12px]">
						Terminal
					</TabsTrigger>
				</TabsList>

				<TabsContent
					value="thread"
					className="flex min-h-0 flex-1 flex-col overflow-hidden mt-0"
				>
					<ThreadTab
						workspace={ws}
						onOpen={onOpen}
						selectedSessionId={commit.selectedSessionId}
						displayedSessionId={commit.displayedSessionId}
						onSelectSession={commit.setSelectedSessionId}
						onResolveDisplayedSession={commit.setDisplayedSessionId}
						onSendingSessionsChange={commit.setSendingSessionIds}
						onInteractionSessionsChange={commit.handleInteractionSessionsChange}
						onSessionCompleted={commit.handleSessionCompleted}
						onSessionAborted={commit.handleSessionAborted}
						pendingPromptForSession={commit.pendingPromptForSession}
						onPendingPromptConsumed={commit.handlePendingPromptConsumed}
					/>
				</TabsContent>

				<TabsContent
					value="changes"
					className="flex min-h-0 flex-1 flex-col overflow-hidden mt-0"
				>
					<ChangesTab
						workspace={ws}
						activeEditorPath={activeEditorPath}
						onOpenEditorFile={onOpenEditorFile}
						onCommitAction={handleCommitAction}
						commitButtonMode={commit.commitButtonMode}
						commitButtonState={commit.commitButtonState}
						changeRequest={commit.changeRequest}
						forgeIsRefreshing={commit.forgeIsRefreshing}
					/>
				</TabsContent>

				<TabsContent
					value="actions"
					className="flex min-h-0 flex-1 flex-col overflow-hidden mt-0"
				>
					<ActionsTab
						workspace={ws}
						onCommitAction={handleCommitAction}
						commitButtonMode={commit.commitButtonMode}
						commitButtonState={commit.commitButtonState}
						changeRequest={commit.changeRequest}
					/>
				</TabsContent>

				<TabsContent
					value="comments"
					className="flex min-h-0 flex-1 flex-col overflow-hidden mt-0"
				>
					{!prCommentsQuery.isFetching &&
					prCommentsQuery.isFetched &&
					!prCommentsQuery.data?.prUrl ? (
						<div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
							<GitPullRequest
								className="size-8 text-muted-foreground/20"
								strokeWidth={1.2}
							/>
							<div className="space-y-1">
								<p className="text-[12px] font-medium text-muted-foreground">
									No pull request yet
								</p>
								<p className="text-[11px] text-muted-foreground/70">
									Create a PR from the{" "}
									<button
										type="button"
										onClick={() => setActiveTab("actions")}
										className="cursor-pointer text-foreground/75 underline underline-offset-2 transition-colors hover:text-foreground"
									>
										Actions tab
									</button>
								</p>
							</div>
						</div>
					) : (
						<CommentsTab
							workspaceId={ws.id}
							prCommentData={prCommentsQuery.data ?? { comments: [] }}
							isFetching={prCommentsQuery.isFetching}
							isActive={activeTab === "comments"}
						/>
					)}
				</TabsContent>

				<TabsContent
					value="terminal"
					className="flex min-h-0 flex-1 flex-col overflow-hidden mt-0"
				>
					<GoalTerminalView
						workspaceId={ws.id}
						repoId={ws.repoId}
						onOpenSettings={onOpenSettings ?? (() => {})}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}
