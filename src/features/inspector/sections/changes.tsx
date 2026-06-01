import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
	getMaterialFileIcon,
	getMaterialFolderIcon,
} from "file-extension-icon-js";
import {
	AlertTriangleIcon,
	ArrowDownIcon,
	ArrowUpIcon,
	BoxIcon,
	ChevronRightIcon,
	CloudIcon,
	FolderGit2Icon,
	LaptopIcon,
	ListIcon,
	ListTreeIcon,
	LoaderCircleIcon,
	MinusIcon,
	Network,
	PlusIcon,
	Undo2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberTicker } from "@/components/ui/number-ticker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShinyFlash } from "@/components/ui/shiny-flash";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
	CommitButtonState,
	WorkspaceCommitButtonMode,
} from "@/features/commit/button";
import {
	type FileDiffScope,
	useFileDiffHover,
} from "@/features/inspector/sections/file-diff-hover";
import {
	type ChangeRequestInfo,
	continueWorkspaceFromTargetBranch,
	discardWorkspaceFile,
	type ForgeDetection,
	type GitActionContext,
	type GitPanelContext,
	refreshGitContextPrCache,
	stageWorkspaceFile,
	toGitActionContext,
	unstageWorkspaceFile,
} from "@/lib/api";
import { deriveCommitButtonMode } from "@/lib/commit-button-logic";
import type { DiffOpenOptions, InspectorFileItem } from "@/lib/editor-session";
import { extractError, isRecoverableByPurge } from "@/lib/errors";
import {
	helmorQueryKeys,
	workspaceForgeActionStatusQueryOptions,
	workspaceForgeQueryOptions,
} from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { showWorkspaceBrokenToast } from "@/lib/workspace-broken-toast";
import { useWorkspaceToast } from "@/lib/workspace-toast-context";
import { GitSectionHeader } from "./git-section-header";

const STATUS_COLORS: Record<InspectorFileItem["status"], string> = {
	M: "text-yellow-500",
	A: "text-green-500",
	D: "text-red-500",
};

const ROOT_CONTEXT_ID = "workspace";

type ChangesSectionProps = {
	sectionRef?: React.RefObject<HTMLElement | null>;
	bodyHeight?: number;
	workspaceId: string | null;
	workspaceRootPath: string | null;
	workspaceTargetBranch: string | null;
	changes: InspectorFileItem[];
	editorMode: boolean;
	activeEditorPath?: string | null;
	onOpenEditorFile: (path: string, options?: DiffOpenOptions) => void;
	flashingPaths: Set<string>;
	gitContexts?: GitPanelContext[];
	onCommitAction?: (
		mode: WorkspaceCommitButtonMode,
		context?: GitActionContext,
	) => Promise<void>;
	commitButtonMode?: WorkspaceCommitButtonMode;
	commitButtonState?: CommitButtonState;
	changeRequest: ChangeRequestInfo | null;
	/** Cold-fetch indicator owned by App; drives the git-header shimmer. */
	forgeIsRefreshing?: boolean;
	/** Opens the full-viewport code-graph diagram view. */
	onOpenDiagramMode?: () => void;
	selectedContextId?: string;
	onSelectedContextIdChange?: (contextId: string) => void;
};

export function ChangesSection({
	sectionRef,
	bodyHeight,
	workspaceId,
	workspaceRootPath,
	workspaceTargetBranch,
	changes,
	editorMode,
	activeEditorPath,
	onOpenEditorFile,
	flashingPaths,
	gitContexts = [],
	onCommitAction,
	commitButtonMode = "create-pr",
	commitButtonState,
	changeRequest,
	forgeIsRefreshing = false,
	onOpenDiagramMode,
	selectedContextId: controlledSelectedContextId,
	onSelectedContextIdChange,
}: ChangesSectionProps) {
	const queryClient = useQueryClient();
	const [changesTreeView, setChangesTreeView] = useState(true);
	const [branchDiffTreeView, setBranchDiffTreeView] = useState(true);
	const [changesOpen, setChangesOpen] = useState(true);
	const [stagedOpen, setStagedOpen] = useState(true);
	const [branchDiffOpen, setBranchDiffOpen] = useState(true);
	const [isContinuingWorkspace, setIsContinuingWorkspace] = useState(false);
	const forgeQuery = useQuery({
		...workspaceForgeQueryOptions(workspaceId ?? "__none__"),
		enabled: workspaceId !== null,
	});
	const forgeStatusQuery = useQuery({
		...workspaceForgeActionStatusQueryOptions(workspaceId ?? "__none__"),
		enabled: workspaceId !== null,
	});
	const cachedForgeDetection = workspaceId
		? queryClient.getQueryData<ForgeDetection>(
				helmorQueryKeys.workspaceForge(workspaceId),
			)
		: null;
	const forgeDetection = forgeQuery.data ?? cachedForgeDetection ?? null;
	const changeRequestName = forgeDetection?.labels.changeRequestName ?? "PR";
	const rootContext = useMemo<GitPanelContext>(
		() => ({
			id: ROOT_CONTEXT_ID,
			kind: "workspace",
			name: "Workspace",
			rootPath: workspaceRootPath ?? "",
			parentRelativePath: null,
			branch: null,
			remote: null,
			remoteUrl: null,
			targetBranch: workspaceTargetBranch,
			gitStatus: {
				uncommittedCount: 0,
				conflictCount: 0,
				syncTargetBranch: workspaceTargetBranch,
				syncStatus: "unknown",
				behindTargetCount: 0,
				remoteTrackingRef: null,
				aheadOfRemoteCount: 0,
				pushStatus: "unknown",
			},
			changeRequest: null,
			available: Boolean(workspaceRootPath),
			unavailableReason: null,
		}),
		[workspaceRootPath, workspaceTargetBranch],
	);
	const contexts = gitContexts.length > 0 ? gitContexts : [rootContext];
	const isControlled = controlledSelectedContextId !== undefined;
	const [localSelectedContextId, setLocalSelectedContextId] =
		useState(ROOT_CONTEXT_ID);
	const selectedContextId = isControlled
		? (controlledSelectedContextId as string)
		: localSelectedContextId;
	// Only mutate local state when the parent isn't controlling — otherwise
	// a parent that rejects the change (snaps back to its own value) leaves
	// us with stale `localSelectedContextId` that re-asserts itself the
	// moment the parent stops passing the prop. Standard controlled /
	// uncontrolled trap.
	const setSelectedContextId = useCallback(
		(contextId: string) => {
			if (!isControlled) {
				setLocalSelectedContextId(contextId);
			}
			onSelectedContextIdChange?.(contextId);
		},
		[isControlled, onSelectedContextIdChange],
	);
	useEffect(() => {
		if (contexts.some((context) => context.id === selectedContextId)) {
			return;
		}
		setSelectedContextId(contexts[0]?.id ?? ROOT_CONTEXT_ID);
	}, [contexts, selectedContextId]);
	const selectedContext =
		contexts.find((context) => context.id === selectedContextId) ??
		contexts[0] ??
		rootContext;
	const selectedContextRoot =
		selectedContext.kind === "workspace"
			? workspaceRootPath
			: selectedContext.rootPath;
	const selectedContextChanges = useMemo(
		() => changesForContext(changes, selectedContext, contexts),
		[changes, selectedContext, contexts],
	);
	const selectedFlashingPaths = useMemo(
		() => flashingPathsForContext(flashingPaths, selectedContext),
		[flashingPaths, selectedContext],
	);
	// Per-context change counts shown on the selector tabs so users can spot
	// which submodule has work pending without clicking through. We derive
	// from `changes` (not just `gitStatus.uncommittedCount`) because the
	// front-end already has the full diff list and stays consistent with the
	// rows the user sees once they switch contexts.
	const contextChangeCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const context of contexts) {
			counts.set(
				context.id,
				changesForContext(changes, context, contexts).length,
			);
		}
		return counts;
	}, [changes, contexts]);
	const effectiveChangeRequest =
		selectedContext.kind === "workspace"
			? changeRequest
			: (selectedContext.changeRequest ?? null);
	// For submodule contexts we now feed the per-context PR into the
	// commit-button derivation so the inspector header reflects the
	// actual PR state — without this a submodule with a clean tree and
	// an open PR would fall through to "Create PR" and the user would
	// create a duplicate.
	const effectiveCommitButtonMode =
		selectedContext.kind === "workspace"
			? commitButtonMode
			: deriveCommitButtonMode(
					null,
					effectiveChangeRequest,
					null,
					selectedContext.gitStatus,
				);
	const effectiveCommitButtonState =
		selectedContext.kind === "workspace" ? commitButtonState : "idle";
	const effectiveWorkspaceTargetBranch =
		selectedContext.kind === "workspace"
			? workspaceTargetBranch
			: selectedContext.targetBranch;

	// Only show loading when the user switches target branch within the
	// same workspace — not on workspace/repo navigation or routine polling.
	const [branchSwitching, setBranchSwitching] = useState(false);
	const prevTargetRef = useRef(effectiveWorkspaceTargetBranch);
	const prevWorkspaceRef = useRef(workspaceId);
	const switchChangesRef = useRef(selectedContextChanges);
	useEffect(() => {
		const sameWorkspace = prevWorkspaceRef.current === workspaceId;
		prevWorkspaceRef.current = workspaceId;
		const targetChanged =
			prevTargetRef.current !== effectiveWorkspaceTargetBranch;
		prevTargetRef.current = effectiveWorkspaceTargetBranch;
		if (targetChanged && sameWorkspace) {
			switchChangesRef.current = selectedContextChanges;
			setBranchSwitching(true);
		}
	}, [workspaceId, effectiveWorkspaceTargetBranch, selectedContextChanges]);
	useEffect(() => {
		if (!branchSwitching) return;
		// Clear once fresh data arrives (array identity changes).
		if (selectedContextChanges !== switchChangesRef.current) {
			setBranchSwitching(false);
			return;
		}
		// Safety timeout so loading never gets stuck.
		const id = window.setTimeout(() => setBranchSwitching(false), 5000);
		return () => window.clearTimeout(id);
	}, [branchSwitching, selectedContextChanges]);

	const stagedChanges = useMemo(
		() =>
			selectedContextChanges
				.filter((change) => change.stagedStatus != null)
				.map((change) => ({
					...change,
					status: change.stagedStatus ?? change.status,
				})),
		[selectedContextChanges],
	);
	const unstagedChanges = useMemo(
		() =>
			selectedContextChanges
				.filter((change) => change.unstagedStatus != null)
				.map((change) => ({
					...change,
					status: change.unstagedStatus ?? change.status,
				})),
		[selectedContextChanges],
	);
	const committedChanges = useMemo(
		() =>
			selectedContextChanges
				.filter((change) => change.committedStatus != null)
				.map((change) => ({
					...change,
					status: change.committedStatus ?? change.status,
				})),
		[selectedContextChanges],
	);
	const hasUncommittedChanges =
		stagedChanges.length > 0 || unstagedChanges.length > 0;
	const hasChanges = hasUncommittedChanges || committedChanges.length > 0;
	const invalidateChanges = useCallback(() => {
		if (!workspaceRootPath) {
			return;
		}
		queryClient.invalidateQueries({
			queryKey: helmorQueryKeys.workspaceChanges(workspaceRootPath),
		});
		queryClient.invalidateQueries({
			queryKey: helmorQueryKeys.workspaceGitPanel(workspaceRootPath),
		});
		if (workspaceId) {
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceGitActionStatus(workspaceId),
			});
		}
	}, [queryClient, workspaceId, workspaceRootPath]);

	const pushToast = useWorkspaceToast();
	// Surface backend mutation failures (which used to be silently
	// swallowed). If the workspace is broken, show a persistent toast
	// with "Permanently Delete" — never auto-deletes. Dismiss preserves
	// the chat history (the startup reconcile has archived the row so
	// the user can still find it).
	const surfaceChangeError = useCallback(
		(action: string, error: unknown) => {
			const { code, message } = extractError(error, `Failed to ${action}.`);
			if (isRecoverableByPurge(code) && workspaceId) {
				showWorkspaceBrokenToast({
					workspaceId,
					pushToast,
					queryClient,
				});
				return;
			}
			pushToast(message, `Unable to ${action}`, "destructive");
		},
		[pushToast, queryClient, workspaceId],
	);

	const stageFile = useCallback(
		async (relativePath: string) => {
			if (!selectedContextRoot) {
				return;
			}
			try {
				await stageWorkspaceFile(selectedContextRoot, relativePath);
			} catch (error) {
				surfaceChangeError("stage file", error);
			} finally {
				invalidateChanges();
			}
		},
		[invalidateChanges, selectedContextRoot, surfaceChangeError],
	);
	const unstageFile = useCallback(
		async (relativePath: string) => {
			if (!selectedContextRoot) {
				return;
			}
			try {
				await unstageWorkspaceFile(selectedContextRoot, relativePath);
			} catch (error) {
				surfaceChangeError("unstage file", error);
			} finally {
				invalidateChanges();
			}
		},
		[invalidateChanges, selectedContextRoot, surfaceChangeError],
	);
	const stageAll = useCallback(async () => {
		if (!selectedContextRoot) {
			return;
		}
		const paths = unstagedChanges.map((change) => change.path);
		try {
			for (const path of paths) {
				await stageWorkspaceFile(selectedContextRoot, path);
			}
		} catch (error) {
			surfaceChangeError("stage files", error);
		} finally {
			invalidateChanges();
		}
	}, [
		invalidateChanges,
		selectedContextRoot,
		surfaceChangeError,
		unstagedChanges,
	]);
	const unstageAll = useCallback(async () => {
		if (!selectedContextRoot) {
			return;
		}
		const paths = stagedChanges.map((change) => change.path);
		try {
			for (const path of paths) {
				await unstageWorkspaceFile(selectedContextRoot, path);
			}
		} catch (error) {
			surfaceChangeError("unstage files", error);
		} finally {
			invalidateChanges();
		}
	}, [
		invalidateChanges,
		selectedContextRoot,
		stagedChanges,
		surfaceChangeError,
	]);

	const discardFile = useCallback(
		async (relativePath: string) => {
			if (!selectedContextRoot) {
				return;
			}
			try {
				await discardWorkspaceFile(selectedContextRoot, relativePath);
			} catch (error) {
				surfaceChangeError("discard changes", error);
			} finally {
				invalidateChanges();
			}
		},
		[invalidateChanges, selectedContextRoot, surfaceChangeError],
	);

	const handleCommitButtonClick = useCallback(async () => {
		if (!onCommitAction) {
			return;
		}
		await onCommitAction(
			effectiveCommitButtonMode,
			selectedContext.kind === "workspace"
				? undefined
				: toGitActionContext(selectedContext),
		);
	}, [effectiveCommitButtonMode, onCommitAction, selectedContext]);

	const handleRefreshPrStatus = useCallback(async () => {
		if (selectedContext.kind !== "workspace") {
			// Submodule PR cache is keyed by (remoteUrl, branch) in the
			// backend and lives outside React Query. Evict that entry
			// before invalidating the git-panel query so the next poll
			// goes straight to gh instead of being served the cached
			// pre-merge state for up to 60s.
			if (selectedContext.remoteUrl && selectedContext.branch) {
				await refreshGitContextPrCache(
					selectedContext.remoteUrl,
					selectedContext.branch,
				).catch((error) => {
					console.warn("[changes] submodule PR refresh failed", error);
				});
			}
			if (workspaceRootPath) {
				await queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceGitPanel(workspaceRootPath),
				});
			}
			return;
		}
		if (!workspaceId) return;
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceChangeRequest(workspaceId),
			}),
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceForgeActionStatus(workspaceId),
			}),
		]);
	}, [queryClient, selectedContext, workspaceId, workspaceRootPath]);

	const handleContinueWorkspace = useCallback(async () => {
		if (!workspaceId || isContinuingWorkspace) return;
		setIsContinuingWorkspace(true);
		try {
			const result = await continueWorkspaceFromTargetBranch(workspaceId);
			pushToast(`Workspace moved to ${result.branch}.`, "Continued", "default");
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceGroups,
				}),
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceDetail(workspaceId),
				}),
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceGitActionStatus(workspaceId),
				}),
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceChangeRequest(workspaceId),
				}),
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceForgeActionStatus(workspaceId),
				}),
			]);
			invalidateChanges();
		} catch (error) {
			surfaceChangeError("continue workspace", error);
		} finally {
			setIsContinuingWorkspace(false);
		}
	}, [
		invalidateChanges,
		isContinuingWorkspace,
		pushToast,
		queryClient,
		surfaceChangeError,
		workspaceId,
	]);

	// Header shimmer is owned by App: it knows when the change-request and
	// forge-action-status queries are on their *first* cold fetch (vs. just a
	// background refresh or a placeholder render).
	const isForgeRefreshing = workspaceId !== null && forgeIsRefreshing;

	return (
		<section
			ref={sectionRef}
			aria-label="Inspector section Git"
			className={cn(
				"flex min-h-0 flex-col overflow-hidden border-b border-border/60 bg-sidebar",
				bodyHeight === undefined && "flex-1",
			)}
			style={
				bodyHeight !== undefined ? { height: `${bodyHeight}px` } : undefined
			}
		>
			<GitSectionHeader
				commitButtonMode={effectiveCommitButtonMode}
				commitButtonState={effectiveCommitButtonState}
				changeRequest={effectiveChangeRequest}
				changeRequestName={changeRequestName}
				forgeRemoteState={
					selectedContext.kind === "workspace"
						? (forgeStatusQuery.data?.remoteState ?? null)
						: null
				}
				forgeDetection={
					selectedContext.kind === "workspace" ? forgeDetection : null
				}
				workspaceId={workspaceId}
				hasChanges={hasChanges}
				isRefreshing={selectedContext.kind === "workspace" && isForgeRefreshing}
				isContinuingWorkspace={isContinuingWorkspace}
				onChangeRequestClick={
					effectiveChangeRequest
						? () => void openUrl(effectiveChangeRequest.url)
						: undefined
				}
				onCommit={handleCommitButtonClick}
				onContinueWorkspace={
					selectedContext.kind === "workspace"
						? handleContinueWorkspace
						: undefined
				}
				onRefreshPrStatus={
					selectedContext.kind === "workspace"
						? workspaceId
							? handleRefreshPrStatus
							: undefined
						: // Submodule contexts also expose the refresh icon so
							// the user can force a fresh gh lookup instead of
							// waiting up to 60s for the backend cache to expire.
							handleRefreshPrStatus
				}
			/>
			{contexts.length > 1 && (
				<GitContextSelector
					contexts={contexts}
					selectedContextId={selectedContext.id}
					changeCounts={contextChangeCounts}
					onSelect={setSelectedContextId}
				/>
			)}
			{onOpenDiagramMode && workspaceId && (
				<button
					type="button"
					onClick={onOpenDiagramMode}
					className="flex shrink-0 cursor-pointer items-center gap-1.5 border-b border-border/40 bg-muted/20 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
					title="Open the code-graph diagram view"
				>
					<Network className="size-3" />
					<span>View as graph</span>
				</button>
			)}

			<ScrollArea
				aria-label="Changes panel body"
				className="min-h-0 flex-1 bg-muted/20 font-mono text-[11.5px]"
			>
				{hasUncommittedChanges && (
					<>
						{stagedChanges.length > 0 && (
							<ChangesGroup
								label="Staged Changes"
								count={stagedChanges.length}
								open={stagedOpen}
								onToggle={() => setStagedOpen((current) => !current)}
								changes={stagedChanges}
								treeView={changesTreeView}
								onToggleTreeView={() => setChangesTreeView((v) => !v)}
								action="unstage"
								onStageAction={unstageFile}
								onBatchAction={unstageAll}
								editorMode={editorMode}
								activeEditorPath={activeEditorPath}
								onOpenEditorFile={onOpenEditorFile}
								flashingPaths={selectedFlashingPaths}
								workspaceRootPath={selectedContextRoot}
								diffScope={{ kind: "staged" }}
							/>
						)}
						{unstagedChanges.length > 0 && (
							<ChangesGroup
								label="Changes"
								icon={
									<LaptopIcon
										className="size-3 shrink-0 text-muted-foreground"
										strokeWidth={2}
									/>
								}
								count={unstagedChanges.length}
								open={changesOpen}
								onToggle={() => setChangesOpen((current) => !current)}
								changes={unstagedChanges}
								treeView={changesTreeView}
								onToggleTreeView={() => setChangesTreeView((v) => !v)}
								action="stage"
								onStageAction={stageFile}
								onBatchAction={stageAll}
								onDiscard={discardFile}
								editorMode={editorMode}
								activeEditorPath={activeEditorPath}
								onOpenEditorFile={onOpenEditorFile}
								flashingPaths={selectedFlashingPaths}
								workspaceRootPath={selectedContextRoot}
								diffScope={{ kind: "unstaged" }}
							/>
						)}
					</>
				)}

				{(committedChanges.length > 0 || branchSwitching) && (
					<BranchDiffSection
						targetBranch={effectiveWorkspaceTargetBranch ?? null}
						count={committedChanges.length}
						loading={branchSwitching}
						open={branchDiffOpen}
						onToggle={() => setBranchDiffOpen((current) => !current)}
						changes={committedChanges}
						treeView={branchDiffTreeView}
						onToggleTreeView={() => setBranchDiffTreeView((v) => !v)}
						editorMode={editorMode}
						activeEditorPath={activeEditorPath}
						onOpenEditorFile={onOpenEditorFile}
						flashingPaths={selectedFlashingPaths}
						workspaceRootPath={selectedContextRoot}
					/>
				)}

				{!hasChanges && (
					<ContextEmptyState
						context={selectedContext}
						hasOtherContextChanges={
							selectedContext.kind === "workspace" &&
							contexts.some(
								(other) =>
									other.id !== selectedContext.id &&
									(contextChangeCounts.get(other.id) ?? 0) > 0,
							)
						}
						onJumpToFirstChangedSubmodule={
							selectedContext.kind === "workspace"
								? () => {
										const target = contexts.find(
											(other) =>
												other.id !== selectedContext.id &&
												(contextChangeCounts.get(other.id) ?? 0) > 0,
										);
										if (target) {
											setSelectedContextId(target.id);
										}
									}
								: undefined
						}
					/>
				)}
			</ScrollArea>
		</section>
	);
}

function GitContextSelector({
	contexts,
	selectedContextId,
	changeCounts,
	onSelect,
}: {
	contexts: GitPanelContext[];
	selectedContextId: string;
	changeCounts: Map<string, number>;
	onSelect: (contextId: string) => void;
}) {
	// Visually separate the workspace root from submodules so the user can
	// tell at a glance which surface they're acting on. The root is always
	// first (the backend sorts it that way) and gets its own icon.
	const workspaceContexts = contexts.filter(
		(context) => context.kind === "workspace",
	);
	const submoduleContexts = contexts.filter(
		(context) => context.kind !== "workspace",
	);
	return (
		<div
			role="tablist"
			aria-label="Git context"
			className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/40 bg-muted/20 px-2 py-1"
		>
			{workspaceContexts.map((context) => (
				<GitContextTab
					key={context.id}
					context={context}
					selected={context.id === selectedContextId}
					changeCount={changeCounts.get(context.id) ?? 0}
					onSelect={onSelect}
				/>
			))}
			{submoduleContexts.length > 0 && workspaceContexts.length > 0 && (
				<span
					aria-hidden="true"
					className="mx-0.5 h-3.5 w-px shrink-0 bg-border/60"
				/>
			)}
			{submoduleContexts.map((context) => (
				<GitContextTab
					key={context.id}
					context={context}
					selected={context.id === selectedContextId}
					changeCount={changeCounts.get(context.id) ?? 0}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}

function GitContextTab({
	context,
	selected,
	changeCount,
	onSelect,
}: {
	context: GitPanelContext;
	selected: boolean;
	changeCount: number;
	onSelect: (contextId: string) => void;
}) {
	const isWorkspace = context.kind === "workspace";
	const Icon = isWorkspace ? FolderGit2Icon : BoxIcon;
	const displayName = isWorkspace ? "Workspace" : context.name;
	const branchLabel = context.branch ?? (isWorkspace ? null : "detached");
	const ahead = context.gitStatus.aheadOfRemoteCount;
	const behind = context.gitStatus.behindTargetCount;
	const hasSyncSignal = ahead > 0 || behind > 0;
	const hasChanges = changeCount > 0;
	const unavailable = !context.available;
	const ariaLabel = (() => {
		const parts: string[] = [displayName];
		if (branchLabel) parts.push(`on ${branchLabel}`);
		if (changeCount > 0) parts.push(`${changeCount} changes`);
		if (ahead > 0) parts.push(`${ahead} ahead`);
		if (behind > 0) parts.push(`${behind} behind`);
		if (unavailable && context.unavailableReason)
			parts.push(`(${context.unavailableReason})`);
		return parts.join(" ");
	})();
	const button = (
		<button
			type="button"
			role="tab"
			aria-selected={selected}
			aria-label={ariaLabel}
			disabled={unavailable && !selected}
			className={cn(
				"group/git-tab inline-flex max-w-[14rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				selected && "bg-muted text-foreground",
				unavailable && "opacity-50",
				unavailable && !selected && "cursor-not-allowed hover:bg-transparent",
			)}
			onClick={() => onSelect(context.id)}
		>
			{unavailable ? (
				<AlertTriangleIcon
					className="size-3 shrink-0 text-amber-500"
					strokeWidth={2}
				/>
			) : (
				<Icon className="size-3 shrink-0" strokeWidth={2} />
			)}
			<span className="truncate font-medium">{displayName}</span>
			{branchLabel && (
				<span
					className={cn(
						"min-w-0 truncate font-mono text-[10px]",
						selected ? "text-muted-foreground" : "text-muted-foreground/70",
					)}
				>
					{branchLabel}
				</span>
			)}
			{hasSyncSignal && !unavailable && (
				<span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums">
					{ahead > 0 && (
						<span
							className="inline-flex items-center gap-px text-chart-2"
							aria-label={`${ahead} ahead`}
						>
							<ArrowUpIcon className="size-2.5" strokeWidth={2.5} />
							{ahead}
						</span>
					)}
					{behind > 0 && (
						<span
							className="inline-flex items-center gap-px text-amber-500"
							aria-label={`${behind} behind`}
						>
							<ArrowDownIcon className="size-2.5" strokeWidth={2.5} />
							{behind}
						</span>
					)}
				</span>
			)}
			{hasChanges && !unavailable && (
				<Badge
					variant={selected ? "default" : "secondary"}
					className="h-3.5 min-w-[14px] justify-center rounded-full px-1 text-[9px] font-semibold leading-none"
				>
					{changeCount}
				</Badge>
			)}
		</button>
	);

	return (
		<Tooltip>
			<TooltipTrigger asChild>{button}</TooltipTrigger>
			<TooltipContent
				side="bottom"
				className="flex max-w-[280px] flex-col gap-0.5 rounded-md px-2 py-1.5 text-[11px] leading-tight"
			>
				<span className="font-medium">{displayName}</span>
				{context.parentRelativePath && (
					<span className="font-mono text-[10px] opacity-80">
						{context.parentRelativePath}
					</span>
				)}
				{branchLabel && (
					<span className="opacity-80">
						Branch: <span className="font-mono">{branchLabel}</span>
					</span>
				)}
				{context.targetBranch && (
					<span className="opacity-80">
						Target: <span className="font-mono">{context.targetBranch}</span>
					</span>
				)}
				{context.remote && (
					<span className="opacity-80">
						Remote: <span className="font-mono">{context.remote}</span>
					</span>
				)}
				{!unavailable && (changeCount > 0 || hasSyncSignal) && (
					<span className="opacity-80">
						{[
							changeCount > 0
								? `${changeCount} ${changeCount === 1 ? "change" : "changes"}`
								: null,
							ahead > 0 ? `${ahead} ahead` : null,
							behind > 0 ? `${behind} behind` : null,
						]
							.filter(Boolean)
							.join(" · ")}
					</span>
				)}
				{unavailable && context.unavailableReason && (
					<span className="text-amber-300">{context.unavailableReason}</span>
				)}
			</TooltipContent>
		</Tooltip>
	);
}

function ContextEmptyState({
	context,
	hasOtherContextChanges,
	onJumpToFirstChangedSubmodule,
}: {
	context: GitPanelContext;
	hasOtherContextChanges: boolean;
	onJumpToFirstChangedSubmodule?: () => void;
}) {
	if (!context.available) {
		return (
			<div className="flex flex-col gap-1 px-3 py-3 text-[11px] leading-5 text-muted-foreground">
				<div className="inline-flex items-center gap-1.5 font-medium text-foreground">
					<AlertTriangleIcon
						className="size-3 text-amber-500"
						strokeWidth={2}
					/>
					{context.name} unavailable
				</div>
				<span>
					{context.unavailableReason ??
						"This submodule is not initialized in the workspace."}
				</span>
				<span className="text-muted-foreground/80">
					Initialize it with{" "}
					<code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
						git submodule update --init
					</code>{" "}
					to manage it here.
				</span>
			</div>
		);
	}

	const baseMessage =
		context.kind === "workspace"
			? "No changes on this branch yet."
			: `${context.name} is clean — no changes in this submodule yet.`;

	return (
		<div className="flex flex-col gap-1 px-3 py-3 text-[11px] leading-5 text-muted-foreground">
			<span>{baseMessage}</span>
			{hasOtherContextChanges && onJumpToFirstChangedSubmodule && (
				<button
					type="button"
					onClick={onJumpToFirstChangedSubmodule}
					className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-sm text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
				>
					<BoxIcon className="size-3" strokeWidth={2} />
					Pending changes in submodules — jump to the next one
					<ChevronRightIcon className="size-3" strokeWidth={2} />
				</button>
			)}
		</div>
	);
}

function changesForContext(
	changes: InspectorFileItem[],
	context: GitPanelContext,
	contexts: GitPanelContext[],
): InspectorFileItem[] {
	const prefix = context.parentRelativePath?.replace(/^\/+|\/+$/g, "");
	if (!prefix) {
		const submodulePrefixes = contexts
			.map((candidate) =>
				candidate.parentRelativePath?.replace(/^\/+|\/+$/g, ""),
			)
			.filter((value): value is string => Boolean(value));
		return changes.filter((change) => {
			return !submodulePrefixes.some((candidate) =>
				change.path.startsWith(`${candidate}/`),
			);
		});
	}

	const prefixWithSlash = `${prefix}/`;
	return changes
		.filter((change) => change.path.startsWith(prefixWithSlash))
		.map((change) => ({
			...change,
			path: change.path.slice(prefixWithSlash.length),
		}));
}

function flashingPathsForContext(
	flashingPaths: Set<string>,
	context: GitPanelContext,
): Set<string> {
	const prefix = context.parentRelativePath?.replace(/^\/+|\/+$/g, "");
	if (!prefix) {
		return flashingPaths;
	}
	const prefixWithSlash = `${prefix}/`;
	const next = new Set<string>();
	for (const path of flashingPaths) {
		if (path.startsWith(prefixWithSlash)) {
			next.add(path.slice(prefixWithSlash.length));
		}
	}
	return next;
}

type StageActionKind = "stage" | "unstage";

function ChangesGroup({
	label,
	icon,
	count,
	open,
	onToggle,
	changes,
	treeView,
	onToggleTreeView,
	action,
	onStageAction,
	onBatchAction,
	onDiscard,
	editorMode,
	activeEditorPath,
	onOpenEditorFile,
	flashingPaths,
	workspaceRootPath,
	diffScope,
}: {
	label: string;
	icon?: React.ReactNode;
	count: number;
	open: boolean;
	onToggle: () => void;
	changes: InspectorFileItem[];
	treeView: boolean;
	onToggleTreeView: () => void;
	action: StageActionKind;
	onStageAction: (path: string) => void;
	onBatchAction?: () => void;
	onDiscard?: (path: string) => void;
	editorMode: boolean;
	activeEditorPath?: string | null;
	onOpenEditorFile: (path: string, options?: DiffOpenOptions) => void;
	flashingPaths: Set<string>;
	workspaceRootPath: string | null;
	diffScope: FileDiffScope;
}) {
	return (
		<div>
			<div className="group/header flex w-full items-center gap-1 py-1 pl-1 pr-2 text-[11.5px] font-semibold tracking-[-0.01em] text-muted-foreground">
				<Button
					type="button"
					variant="ghost"
					size="xs"
					onClick={onToggle}
					aria-expanded={open}
					className="h-auto min-w-0 flex-1 justify-start gap-1 rounded-none px-0 text-left hover:bg-transparent hover:text-foreground dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-foreground"
				>
					<ChevronRightIcon
						data-icon="inline-start"
						className={cn(
							"size-3 shrink-0 transition-transform",
							open && "rotate-90",
						)}
						strokeWidth={2}
					/>
					{icon}
					<span className="truncate">{label}</span>
				</Button>
				<ViewToggleButton treeView={treeView} onToggle={onToggleTreeView} />
				{onBatchAction && (
					<RowIconButton
						aria-label={
							action === "stage" ? "Stage all changes" : "Unstage all changes"
						}
						onClick={onBatchAction}
						className="text-transparent hover:bg-transparent group-hover/header:text-muted-foreground group-hover/header:hover:text-foreground"
					>
						{action === "stage" ? (
							<PlusIcon className="size-3.5" strokeWidth={2} />
						) : (
							<MinusIcon className="size-3.5" strokeWidth={2} />
						)}
					</RowIconButton>
				)}
				<Badge
					variant="secondary"
					className="h-4 min-w-[16px] justify-center rounded-full px-1 text-[9.5px] font-semibold"
				>
					{count}
				</Badge>
			</div>
			{open && (
				<div className="pl-3">
					{treeView ? (
						<ChangesTreeView
							changes={changes}
							editorMode={editorMode}
							activeEditorPath={activeEditorPath}
							onOpenEditorFile={onOpenEditorFile}
							flashingPaths={flashingPaths}
							action={action}
							onStageAction={onStageAction}
							onDiscard={onDiscard}
							workspaceRootPath={workspaceRootPath}
							diffScope={diffScope}
						/>
					) : (
						<ChangesFlatView
							changes={changes}
							editorMode={editorMode}
							activeEditorPath={activeEditorPath}
							onOpenEditorFile={onOpenEditorFile}
							flashingPaths={flashingPaths}
							action={action}
							onStageAction={onStageAction}
							onDiscard={onDiscard}
							workspaceRootPath={workspaceRootPath}
							diffScope={diffScope}
						/>
					)}
				</div>
			)}
		</div>
	);
}

function BranchDiffSection({
	targetBranch,
	count,
	loading,
	open,
	onToggle,
	changes,
	treeView,
	onToggleTreeView,
	editorMode,
	activeEditorPath,
	onOpenEditorFile,
	flashingPaths,
	workspaceRootPath,
}: {
	targetBranch: string | null;
	count: number;
	loading: boolean;
	open: boolean;
	onToggle: () => void;
	changes: InspectorFileItem[];
	treeView: boolean;
	onToggleTreeView: () => void;
	editorMode: boolean;
	activeEditorPath?: string | null;
	onOpenEditorFile: (path: string, options?: DiffOpenOptions) => void;
	flashingPaths: Set<string>;
	workspaceRootPath: string | null;
}) {
	const handleOpenFile = useCallback(
		(path: string, options?: DiffOpenOptions) => {
			onOpenEditorFile(path, {
				fileStatus: options?.fileStatus ?? "M",
				originalRef: targetBranch ?? undefined,
				modifiedRef: "HEAD",
				workspaceRootPath,
			});
		},
		[onOpenEditorFile, targetBranch, workspaceRootPath],
	);

	return (
		<div>
			<div className="group/header flex w-full items-center gap-1 py-1 pl-1 pr-2 text-[11.5px] font-semibold tracking-[-0.01em] text-muted-foreground">
				<Button
					type="button"
					variant="ghost"
					size="xs"
					onClick={onToggle}
					aria-expanded={open}
					className="h-auto min-w-0 flex-1 justify-start gap-1 rounded-none px-0 text-left hover:bg-transparent hover:text-foreground dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-foreground"
				>
					<ChevronRightIcon
						data-icon="inline-start"
						className={cn(
							"size-3 shrink-0 transition-transform",
							open && "rotate-90",
						)}
						strokeWidth={2}
					/>
					<CloudIcon
						className="size-3 shrink-0 text-muted-foreground"
						strokeWidth={2}
					/>
					<span className="truncate">Remote</span>
				</Button>
				<ViewToggleButton treeView={treeView} onToggle={onToggleTreeView} />
				<Badge
					variant="secondary"
					className="h-4 min-w-[16px] justify-center rounded-full px-1 text-[9.5px] leading-none"
				>
					{loading ? (
						<LoaderCircleIcon className="size-2.5 animate-spin" />
					) : (
						count
					)}
				</Badge>
			</div>
			{open && (
				<div
					className={cn(
						"pl-3 transition-opacity duration-150",
						loading && "pointer-events-none opacity-40",
					)}
				>
					{loading && changes.length === 0 ? (
						<div className="px-2 py-2 text-[10.5px] text-muted-foreground">
							Switching target branch…
						</div>
					) : treeView ? (
						<ChangesTreeView
							changes={changes}
							editorMode={editorMode}
							activeEditorPath={activeEditorPath}
							onOpenEditorFile={handleOpenFile}
							flashingPaths={flashingPaths}
							workspaceRootPath={workspaceRootPath}
							diffScope={
								targetBranch
									? { kind: "branch", fromRef: targetBranch, toRef: "HEAD" }
									: { kind: "unstaged" }
							}
						/>
					) : (
						<ChangesFlatView
							changes={changes}
							editorMode={editorMode}
							activeEditorPath={activeEditorPath}
							onOpenEditorFile={handleOpenFile}
							flashingPaths={flashingPaths}
							workspaceRootPath={workspaceRootPath}
							diffScope={
								targetBranch
									? { kind: "branch", fromRef: targetBranch, toRef: "HEAD" }
									: { kind: "unstaged" }
							}
						/>
					)}
				</div>
			)}
		</div>
	);
}

function buildTree(changes: InspectorFileItem[]) {
	type TreeNode = {
		name: string;
		path: string;
		children: Map<string, TreeNode>;
		file?: InspectorFileItem;
	};

	const root: TreeNode = { name: "", path: "", children: new Map() };

	for (const change of changes) {
		const parts = change.path.split("/");
		let current = root;
		for (let index = 0; index < parts.length - 1; index += 1) {
			const part = parts[index];
			if (!current.children.has(part)) {
				current.children.set(part, {
					name: part,
					path: parts.slice(0, index + 1).join("/"),
					children: new Map(),
				});
			}
			current = current.children.get(part)!;
		}
		current.children.set(change.name, {
			name: change.name,
			path: change.path,
			children: new Map(),
			file: change,
		});
	}

	return root;
}

function ChangesTreeView({
	changes,
	editorMode,
	activeEditorPath,
	onOpenEditorFile,
	flashingPaths,
	action,
	onStageAction,
	onDiscard,
	workspaceRootPath,
	diffScope,
}: {
	changes: InspectorFileItem[];
	editorMode: boolean;
	activeEditorPath?: string | null;
	onOpenEditorFile: (path: string, options?: DiffOpenOptions) => void;
	flashingPaths: Set<string>;
	action?: StageActionKind;
	onStageAction?: (path: string) => void;
	onDiscard?: (path: string) => void;
	workspaceRootPath?: string | null;
	diffScope?: FileDiffScope;
}) {
	const tree = buildTree(changes);
	const [expanded, setExpanded] = useState<Set<string>>(
		() => new Set(collectFolderPaths(tree)),
	);

	const toggle = (path: string) => {
		setExpanded((previous) => {
			const next = new Set(previous);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	return (
		<div className="py-0.5">
			<TreeNodeList
				nodes={tree.children}
				expanded={expanded}
				onToggle={toggle}
				depth={0}
				editorMode={editorMode}
				activeEditorPath={activeEditorPath}
				onOpenEditorFile={onOpenEditorFile}
				flashingPaths={flashingPaths}
				action={action}
				onStageAction={onStageAction}
				onDiscard={onDiscard}
				workspaceRootPath={workspaceRootPath}
				diffScope={diffScope}
			/>
		</div>
	);
}

function collectFolderPaths(node: ReturnType<typeof buildTree>): string[] {
	const paths: string[] = [];
	for (const child of node.children.values()) {
		if (child.children.size > 0 && !child.file) {
			paths.push(child.path);
			paths.push(...collectFolderPaths(child));
		}
	}
	return paths;
}

function TreeNodeList({
	nodes,
	expanded,
	onToggle,
	depth,
	editorMode,
	activeEditorPath,
	onOpenEditorFile,
	flashingPaths,
	action,
	onStageAction,
	onDiscard,
	workspaceRootPath,
	diffScope,
}: {
	nodes: Map<string, ReturnType<typeof buildTree>>;
	expanded: Set<string>;
	onToggle: (path: string) => void;
	depth: number;
	editorMode: boolean;
	activeEditorPath?: string | null;
	onOpenEditorFile: (path: string, options?: DiffOpenOptions) => void;
	flashingPaths: Set<string>;
	action?: StageActionKind;
	onStageAction?: (path: string) => void;
	onDiscard?: (path: string) => void;
	workspaceRootPath?: string | null;
	diffScope?: FileDiffScope;
}) {
	const sorted = [...nodes.values()].sort((left, right) => {
		const leftIsFolder = left.children.size > 0 && !left.file;
		const rightIsFolder = right.children.size > 0 && !right.file;
		if (leftIsFolder !== rightIsFolder) {
			return leftIsFolder ? -1 : 1;
		}
		return left.name.localeCompare(right.name);
	});

	return (
		<>
			{sorted.map((node) => {
				const isFolder = node.children.size > 0 && !node.file;

				if (isFolder) {
					const isOpen = expanded.has(node.path);
					return (
						<div key={node.path}>
							<div
								className="flex cursor-pointer items-center gap-1 py-[1.5px] pr-2 text-muted-foreground transition-colors hover:bg-accent/60"
								style={{ paddingLeft: `${depth * 12 + 8}px` }}
								onClick={() => onToggle(node.path)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										onToggle(node.path);
									}
								}}
								tabIndex={0}
								role="treeitem"
								aria-expanded={isOpen}
							>
								<ChevronRightIcon
									className={cn(
										"size-3 shrink-0 transition-transform",
										isOpen && "rotate-90",
									)}
									strokeWidth={1.8}
								/>
								<img
									src={getMaterialFolderIcon(node.name, isOpen || undefined)}
									alt=""
									className="size-4 shrink-0"
								/>
								<span className="truncate">{node.name}</span>
							</div>
							{isOpen && (
								<TreeNodeList
									nodes={node.children}
									expanded={expanded}
									onToggle={onToggle}
									depth={depth + 1}
									editorMode={editorMode}
									activeEditorPath={activeEditorPath}
									onOpenEditorFile={onOpenEditorFile}
									flashingPaths={flashingPaths}
									action={action}
									onStageAction={onStageAction}
									onDiscard={onDiscard}
									workspaceRootPath={workspaceRootPath}
									diffScope={diffScope}
								/>
							)}
						</div>
					);
				}

				const file = node.file;
				if (!file) return null;

				return (
					<TreeFileRow
						key={node.path}
						file={file}
						nodeName={node.name}
						depth={depth}
						editorMode={editorMode}
						activeEditorPath={activeEditorPath}
						onOpenEditorFile={onOpenEditorFile}
						isFlashing={flashingPaths.has(file.path)}
						action={action}
						onStageAction={onStageAction}
						onDiscard={onDiscard}
						workspaceRootPath={workspaceRootPath}
						diffScope={diffScope}
					/>
				);
			})}
		</>
	);
}

function TreeFileRow({
	file,
	nodeName,
	depth,
	editorMode,
	activeEditorPath,
	onOpenEditorFile,
	isFlashing,
	action,
	onStageAction,
	onDiscard,
	workspaceRootPath,
	diffScope,
}: {
	file: InspectorFileItem;
	nodeName: string;
	depth: number;
	editorMode: boolean;
	activeEditorPath?: string | null;
	onOpenEditorFile: (path: string, options?: DiffOpenOptions) => void;
	isFlashing: boolean;
	action?: StageActionKind;
	onStageAction?: (path: string) => void;
	onDiscard?: (path: string) => void;
	workspaceRootPath?: string | null;
	diffScope?: FileDiffScope;
}) {
	const rowRef = useRef<HTMLDivElement>(null);
	const { onMouseEnter, onMouseLeave, popover } = useFileDiffHover(
		rowRef,
		workspaceRootPath,
		file.path,
		diffScope ?? { kind: "unstaged" },
	);
	const selected = file.absolutePath === activeEditorPath;

	return (
		<div
			ref={rowRef}
			className={cn(
				"group/row flex cursor-pointer items-center gap-1 py-[1.5px] pr-2 text-muted-foreground transition-colors hover:bg-accent/60",
				selected &&
					(editorMode
						? "bg-accent text-foreground"
						: "bg-muted/60 text-foreground"),
			)}
			style={{ paddingLeft: `${depth * 12 + 22}px` }}
			role="treeitem"
			tabIndex={0}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
			onClick={() =>
				onOpenEditorFile(file.absolutePath, {
					fileStatus: file.status,
					workspaceRootPath,
				})
			}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpenEditorFile(file.absolutePath, {
						fileStatus: file.status,
						workspaceRootPath,
					});
				}
			}}
		>
			<img
				src={getMaterialFileIcon(nodeName)}
				alt=""
				className="size-4 shrink-0"
			/>
			<ShinyFlash active={isFlashing}>{nodeName}</ShinyFlash>
			<StageActionSlot
				file={file}
				action={action}
				onStageAction={onStageAction}
				onDiscard={onDiscard}
			/>
			{popover}
		</div>
	);
}

function ChangesFlatView({
	changes,
	editorMode,
	activeEditorPath,
	onOpenEditorFile,
	flashingPaths,
	action,
	onStageAction,
	onDiscard,
	workspaceRootPath,
	diffScope,
}: {
	changes: InspectorFileItem[];
	editorMode: boolean;
	activeEditorPath?: string | null;
	onOpenEditorFile: (path: string, options?: DiffOpenOptions) => void;
	flashingPaths: Set<string>;
	action?: StageActionKind;
	onStageAction?: (path: string) => void;
	onDiscard?: (path: string) => void;
	workspaceRootPath?: string | null;
	diffScope?: FileDiffScope;
}) {
	return (
		<div className="py-0.5">
			{changes.map((change) => (
				<FlatFileRow
					key={change.path}
					change={change}
					editorMode={editorMode}
					activeEditorPath={activeEditorPath}
					onOpenEditorFile={onOpenEditorFile}
					isFlashing={flashingPaths.has(change.path)}
					action={action}
					onStageAction={onStageAction}
					onDiscard={onDiscard}
					workspaceRootPath={workspaceRootPath}
					diffScope={diffScope}
				/>
			))}
		</div>
	);
}

function FlatFileRow({
	change,
	editorMode,
	activeEditorPath,
	onOpenEditorFile,
	isFlashing,
	action,
	onStageAction,
	onDiscard,
	workspaceRootPath,
	diffScope,
}: {
	change: InspectorFileItem;
	editorMode: boolean;
	activeEditorPath?: string | null;
	onOpenEditorFile: (path: string, options?: DiffOpenOptions) => void;
	isFlashing: boolean;
	action?: StageActionKind;
	onStageAction?: (path: string) => void;
	onDiscard?: (path: string) => void;
	workspaceRootPath?: string | null;
	diffScope?: FileDiffScope;
}) {
	const hasStage = !!action && !!onStageAction;
	const hasDiscard = !!onDiscard;
	const hasAction = hasStage || hasDiscard;

	const rowRef = useRef<HTMLDivElement>(null);
	const { onMouseEnter, onMouseLeave, popover } = useFileDiffHover(
		rowRef,
		workspaceRootPath,
		change.path,
		diffScope ?? { kind: "unstaged" },
	);

	return (
		<div
			ref={rowRef}
			className={cn(
				"group/row flex cursor-pointer items-center gap-1.5 py-[1.5px] pl-2 pr-2 text-muted-foreground transition-colors hover:bg-accent/60",
				change.absolutePath === activeEditorPath &&
					(editorMode
						? "bg-accent text-foreground"
						: "bg-muted/60 text-foreground"),
			)}
			role="button"
			tabIndex={0}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
			onClick={() =>
				onOpenEditorFile(change.absolutePath, {
					fileStatus: change.status,
					workspaceRootPath,
				})
			}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpenEditorFile(change.absolutePath, {
						fileStatus: change.status,
						workspaceRootPath,
					});
				}
			}}
		>
			<img
				src={getMaterialFileIcon(change.name)}
				alt=""
				className="size-4 shrink-0"
			/>
			<span className="min-w-0 max-w-[60%] truncate">
				<ShinyFlash active={isFlashing}>{change.name}</ShinyFlash>
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground",
					hasAction && "group-hover/row:hidden",
				)}
			>
				{change.path.includes("/")
					? change.path.slice(0, change.path.lastIndexOf("/"))
					: ""}
			</span>
			<span
				className={cn(
					"flex shrink-0 items-center gap-1 tabular-nums",
					hasAction && "group-hover/row:hidden",
				)}
			>
				<LineStats
					insertions={change.insertions}
					deletions={change.deletions}
				/>
				<span
					className={cn(
						"inline-flex h-4 w-4 items-center justify-center text-[10px] font-semibold",
						STATUS_COLORS[change.status],
					)}
				>
					{change.status}
				</span>
			</span>
			{hasAction && (
				<RowHoverActions
					path={change.path}
					action={action}
					onStageAction={onStageAction}
					onDiscard={onDiscard}
				/>
			)}
			{popover}
		</div>
	);
}

function StageActionSlot({
	file,
	action,
	onStageAction,
	onDiscard,
}: {
	file: InspectorFileItem;
	action?: StageActionKind;
	onStageAction?: (path: string) => void;
	onDiscard?: (path: string) => void;
}) {
	const hasStage = !!action && !!onStageAction;
	const hasDiscard = !!onDiscard;
	const hasAction = hasStage || hasDiscard;

	return (
		<>
			<span
				className={cn(
					"ml-auto flex shrink-0 items-center gap-1.5",
					hasAction && "group-hover/row:hidden",
				)}
			>
				<LineStats insertions={file.insertions} deletions={file.deletions} />
				<span
					className={cn(
						"inline-flex h-4 w-4 items-center justify-center text-[10px] font-semibold",
						STATUS_COLORS[file.status],
					)}
				>
					{file.status}
				</span>
			</span>
			{hasAction && (
				<RowHoverActions
					path={file.path}
					action={action}
					onStageAction={onStageAction}
					onDiscard={onDiscard}
				/>
			)}
		</>
	);
}

function RowHoverActions({
	path,
	action,
	onStageAction,
	onDiscard,
}: {
	path: string;
	action?: StageActionKind;
	onStageAction?: (path: string) => void;
	onDiscard?: (path: string) => void;
}) {
	return (
		<span className="ml-auto hidden items-center gap-0.5 group-hover/row:inline-flex">
			{onDiscard && (
				<RowIconButton
					aria-label="Discard file changes"
					onClick={() => onDiscard(path)}
					className="text-muted-foreground hover:bg-accent/60 hover:text-foreground"
				>
					<Undo2Icon className="size-3.5" strokeWidth={2} />
				</RowIconButton>
			)}
			{action && onStageAction && (
				<RowIconButton
					aria-label={action === "stage" ? "Stage file" : "Unstage file"}
					onClick={() => onStageAction(path)}
					className="text-muted-foreground hover:bg-accent/60 hover:text-foreground"
				>
					{action === "stage" ? (
						<PlusIcon className="size-3.5" strokeWidth={2} />
					) : (
						<MinusIcon className="size-3.5" strokeWidth={2} />
					)}
				</RowIconButton>
			)}
		</span>
	);
}

function RowIconButton({
	onClick,
	disabled = false,
	children,
	className,
	"aria-label": ariaLabel,
}: {
	onClick: () => void;
	disabled?: boolean;
	children: React.ReactNode;
	className?: string;
	"aria-label": string;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			aria-label={ariaLabel}
			disabled={disabled}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			onKeyDown={(event) => event.stopPropagation()}
			className={cn(
				"size-4 rounded-sm transition-colors disabled:pointer-events-none disabled:opacity-60",
				className,
			)}
		>
			{children}
		</Button>
	);
}

function ViewToggleButton({
	treeView,
	onToggle,
}: {
	treeView: boolean;
	onToggle: () => void;
}) {
	return (
		<RowIconButton
			aria-label={treeView ? "Switch to list view" : "Switch to tree view"}
			onClick={onToggle}
			className="text-transparent hover:bg-transparent group-hover/header:text-muted-foreground group-hover/header:hover:text-foreground"
		>
			{treeView ? (
				<ListIcon className="size-3.5" strokeWidth={1.8} />
			) : (
				<ListTreeIcon className="size-3.5" strokeWidth={1.8} />
			)}
		</RowIconButton>
	);
}

function LineStats({
	insertions,
	deletions,
}: {
	insertions: number;
	deletions: number;
}) {
	if (insertions === 0 && deletions === 0) {
		return null;
	}

	return (
		<span className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums">
			{insertions > 0 && (
				<span className="text-chart-2">
					+<NumberTicker value={insertions} className="text-chart-2" />
				</span>
			)}
			{deletions > 0 && (
				<span className="text-destructive">
					−<NumberTicker value={deletions} className="text-destructive" />
				</span>
			)}
		</span>
	);
}

// ShinyFlash is re-exported from @/components/ui/shiny-flash — imported above.
