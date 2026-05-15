import { skipToken, useQuery } from "@tanstack/react-query";
import { GitBranch, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceConversationContainer } from "@/features/conversation";
import { ActionsSection } from "@/features/inspector/sections/actions";
import { ChangesSection } from "@/features/inspector/sections/changes";
import type { WorkspaceDetail, WorkspaceStatus } from "@/lib/api";
import { listWorkspaceChangesWithContent } from "@/lib/api";
import type { DiffOpenOptions } from "@/lib/editor-session";
import { helmorQueryKeys } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import {
	GOAL_LANES,
	goalLaneForWorkspace,
	isMergedGoalWorkspace,
	isMovableGoalLaneId,
} from "./board-model";
import { GoalTerminalView } from "./terminal-view";

const EMPTY_FLASHING = new Set<string>();

type GoalCardDetailProps = {
	workspace: WorkspaceDetail;
	onClose: () => void;
	onMove: (lane: WorkspaceStatus) => void;
	onOpen?: () => void;
	activeEditorPath?: string | null;
	onOpenEditorFile?: (path: string, options?: DiffOpenOptions) => void;
	onOpenSettings?: () => void;
};

type CardDetailTab = "thread" | "changes" | "actions" | "terminal";

function ThreadTab({
	workspace,
	onOpen,
}: {
	workspace: WorkspaceDetail;
	onOpen?: () => void;
}) {
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
		workspace.activeSessionId ?? null,
	);
	const [displayedSessionId, setDisplayedSessionId] = useState<string | null>(
		workspace.activeSessionId ?? null,
	);

	const handleSelectSession = useCallback((id: string | null) => {
		setSelectedSessionId(id);
	}, []);

	const handleResolveDisplayedSession = useCallback((id: string | null) => {
		setDisplayedSessionId(id);
	}, []);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<WorkspaceConversationContainer
				selectedWorkspaceId={workspace.id}
				displayedWorkspaceId={workspace.id}
				selectedSessionId={selectedSessionId}
				displayedSessionId={displayedSessionId}
				repoId={workspace.repoId}
				onSelectSession={handleSelectSession}
				onResolveDisplayedSession={handleResolveDisplayedSession}
				workspaceRootPath={workspace.rootPath ?? null}
				compact
				headerLeading={
					onOpen ? (
						<button
							type="button"
							onClick={onOpen}
							className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
						>
							Open workspace ↗
						</button>
					) : null
				}
			/>
		</div>
	);
}

function ChangesTab({
	workspace,
	activeEditorPath,
	onOpenEditorFile,
}: {
	workspace: WorkspaceDetail;
	activeEditorPath?: string | null;
	onOpenEditorFile?: (path: string, options?: DiffOpenOptions) => void;
}) {
	const rootPath = workspace.rootPath ?? null;
	const changesQuery = useQuery({
		queryKey: helmorQueryKeys.workspaceChanges(rootPath ?? "__none__"),
		queryFn: rootPath
			? () => listWorkspaceChangesWithContent(rootPath)
			: skipToken,
		staleTime: 5_000,
	});

	if (!workspace.rootPath) {
		return (
			<div className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">
				Workspace not yet initialised
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<ChangesSection
				workspaceId={workspace.id}
				workspaceRootPath={workspace.rootPath}
				workspaceTargetBranch={workspace.intendedTargetBranch ?? null}
				changes={changesQuery.data?.items ?? []}
				editorMode={false}
				activeEditorPath={activeEditorPath ?? null}
				onOpenEditorFile={onOpenEditorFile ?? (() => {})}
				flashingPaths={EMPTY_FLASHING}
				changeRequest={null}
			/>
		</div>
	);
}

function ActionsTab({ workspace }: { workspace: WorkspaceDetail }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<ActionsSection
				workspaceId={workspace.id}
				repoId={workspace.repoId}
				workspaceRemote={workspace.remote ?? null}
				workspaceState={workspace.state ?? null}
				bodyHeight={500}
				expanded={true}
				changeRequest={null}
			/>
		</div>
	);
}

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
	const currentLaneId = goalLaneForWorkspace(ws);
	const currentLane = GOAL_LANES.find((lane) => lane.id === currentLaneId);
	const moveLanes = GOAL_LANES.filter(
		(lane): lane is (typeof GOAL_LANES)[number] & { id: WorkspaceStatus } =>
			isMovableGoalLaneId(lane.id) && lane.id !== ws.status,
	);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border/60 bg-sidebar/60">
			{/* Header */}
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

				{/* Lane row */}
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

			{/* Tabs */}
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
					<TabsTrigger value="terminal" className="text-[12px]">
						Terminal
					</TabsTrigger>
				</TabsList>

				<TabsContent
					value="thread"
					className="flex min-h-0 flex-1 flex-col overflow-hidden mt-0"
				>
					<ThreadTab workspace={ws} onOpen={onOpen} />
				</TabsContent>

				<TabsContent
					value="changes"
					className="flex min-h-0 flex-1 flex-col overflow-hidden mt-0"
				>
					<ChangesTab
						workspace={ws}
						activeEditorPath={activeEditorPath}
						onOpenEditorFile={onOpenEditorFile}
					/>
				</TabsContent>

				<TabsContent
					value="actions"
					className="flex min-h-0 flex-1 flex-col overflow-hidden mt-0"
				>
					<ActionsTab workspace={ws} />
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
