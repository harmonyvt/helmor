import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	CommitButtonState,
	WorkspaceCommitButtonMode,
} from "@/features/commit/button";
import { AgentToolsSection } from "@/features/inspector/sections/agent-tools";
import { ArchiveTab } from "@/features/inspector/sections/archive";
import { CommentsTab } from "@/features/inspector/sections/comments";
import { GitTimelineSection } from "@/features/inspector/sections/git-timeline";
import { KnowledgeSection } from "@/features/inspector/sections/knowledge";
import { seedNewSessionInCache } from "@/features/panel/session-cache";
import {
	type ShortcutHandler,
	useAppShortcuts,
} from "@/features/shortcuts/use-app-shortcuts";
import {
	type ChangeRequestInfo,
	createSession,
	type DebugIngestStatus,
	type GitActionContext,
	type GitPanelContext,
	type PrComment,
	type PrCommentData,
	type WorkspaceDetail,
	type WorkspaceSessionSummary,
} from "@/lib/api";
import type { DiffOpenOptions } from "@/lib/editor-session";
import {
	helmorQueryKeys,
	workspacePrCommentsQueryOptions,
} from "@/lib/query-client";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { useWorkspaceInspectorSidebar } from "./hooks/use-inspector";
import { useScriptStatus } from "./hooks/use-script-status";
import { useSetupAutoRun } from "./hooks/use-setup-auto-run";
import { HorizontalResizeHandle, InspectorTabsSection } from "./layout";
import { buildReviewAllPrompt } from "./pr-comments";
import type { ScriptStatus } from "./script-store";
import { ActionsSection } from "./sections/actions";
import { ChangesSection } from "./sections/changes";
import { IngestTab } from "./sections/ingest";
import { OpenDevServerButton, RunTab } from "./sections/run";
import { SetupTab } from "./sections/setup";
import { TerminalInstancePanel } from "./sections/terminal";
import {
	closeTerminal,
	createTerminal,
	getTerminals,
	subscribeToWorkspaceList,
	TERMINAL_INSTANCE_LIMIT,
	type TerminalInstance,
} from "./terminal-store";

type WorkspaceInspectorSidebarProps = {
	workspaceId?: string | null;
	repoId?: string | null;
	workspaceRootPath?: string | null;
	workspaceBranch?: string | null;
	workspaceTargetBranch?: string | null;
	workspaceRemote?: string | null;
	workspaceState?: string | null;
	editorMode: boolean;
	activeEditorPath?: string | null;
	onOpenEditorFile(path: string, options?: DiffOpenOptions): void;
	onOpenMockReview?: (path: string) => void;
	onCommitAction?: (
		mode: WorkspaceCommitButtonMode,
		context?: GitActionContext,
	) => Promise<void>;
	currentSessionId?: string | null;
	onQueuePendingPromptForSession?: (request: {
		sessionId: string;
		prompt: string;
		modelId?: string | null;
		permissionMode?: string | null;
		forceQueue?: boolean;
	}) => void;
	commitButtonMode?: WorkspaceCommitButtonMode;
	commitButtonState?: CommitButtonState;
	changeRequest?: ChangeRequestInfo | null;
	/**
	 * True only on the first cold fetch of either the PR change request or
	 * the forge action status — drives the git-header shimmer. Owned by App.
	 */
	forgeIsRefreshing?: boolean;
	onOpenSettings?: () => void;
	/** Called after a new session is created (e.g. "Review all") so the app
	 * can navigate to it and the queued prompt actually fires. */
	onSelectSession?: (sessionId: string) => void;
	/** Opens the full-viewport browser surface. */
	onOpenBrowserMode?: () => void;
	/** Opens the full-viewport code-graph diagram view. */
	onOpenDiagramMode?: () => void;
	debugIngestState?: {
		active: boolean;
		starting: boolean;
		status: DebugIngestStatus | null;
		error: string | null;
	} | null;
	/** Opens a URL in a full-viewport Helmor browser tab. */
	onOpenBrowserUrl?: (url: string) => Promise<void> | void;
};

export function WorkspaceInspectorSidebar({
	workspaceId,
	workspaceRootPath,
	workspaceTargetBranch,
	workspaceRemote,
	workspaceState,
	repoId,
	editorMode,
	activeEditorPath,
	onOpenEditorFile,
	onCommitAction,
	currentSessionId,
	onQueuePendingPromptForSession,
	onSelectSession,
	commitButtonMode,
	commitButtonState,
	changeRequest,
	forgeIsRefreshing = false,
	onOpenSettings,
	onOpenBrowserMode,
	onOpenDiagramMode,
	debugIngestState = null,
	onOpenBrowserUrl,
}: WorkspaceInspectorSidebarProps) {
	const {
		actionsHeight,
		actionsRef,
		activeTab,
		changes,
		changesHeight,
		changesRef,
		containerRef,
		flashingPaths,
		gitContexts,
		handleResizeStart,
		handleToggleTabs,
		isActionsResizing,
		isResizing,
		isTabsResizing,
		repoScripts,
		scriptsLoaded,
		setActiveTab,
		tabsOpen,
		tabsWrapperRef,
	} = useWorkspaceInspectorSidebar({
		workspaceRootPath,
		workspaceId: workspaceId ?? null,
		repoId: repoId ?? null,
	});
	const queryClient = useQueryClient();
	const { settings: appSettings } = useSettings();
	const [selectedGitContextId, setSelectedGitContextId] = useState("workspace");
	useEffect(() => {
		setSelectedGitContextId("workspace");
	}, [workspaceRootPath]);
	const selectedGitContext: GitPanelContext | null =
		gitContexts.find((context) => context.id === selectedGitContextId) ?? null;
	const activeGitContext =
		selectedGitContext && selectedGitContext.kind !== "workspace"
			? selectedGitContext
			: null;
	// Script scope is intentionally workspace-scoped (not context-scoped).
	// Earlier iteration scoped by `${workspaceId}:${contextId}` so each
	// submodule had its own running script — but switching contexts then
	// hid in-flight scripts from the UI (the user couldn't stop a setup
	// they had started, and clicking "Run" again spawned a second one).
	// We use the context only for the working-directory override; the
	// script identity stays attached to the workspace so the icons /
	// terminal stay consistent across context switches.
	const activeScriptScopeId = workspaceId ?? null;
	const activeScriptWorkingDirectory = activeGitContext?.rootPath ?? null;

	// PR comments — fetched at sidebar level so the Comments tab badge and
	// the CommentsTab body both share the same query instance.
	const isArchived = workspaceState === "archived";
	const prCommentsQuery = useQuery({
		...workspacePrCommentsQueryOptions(workspaceId ?? "__none__"),
		enabled: workspaceId !== null && !isArchived,
	});
	const EMPTY_PR_COMMENT_DATA: PrCommentData = {
		comments: [],
		prNumber: null,
		prUrl: null,
	};
	const prCommentData = prCommentsQuery.data ?? EMPTY_PR_COMMENT_DATA;
	const showCommentsTab =
		prCommentData.comments.length > 0 || prCommentsQuery.isFetching;
	const showIngestTab = Boolean(
		debugIngestState?.active || debugIngestState?.error,
	);
	const hasUnresolvedComments = prCommentData.comments.some(
		(c: { isThreadResolved: boolean }) => !c.isThreadResolved,
	);

	// Fire setup auto-run / auto-complete at the sidebar level so it runs even
	// when the Setup tab isn't mounted (tabsOpen=false).
	useSetupAutoRun({
		repoId: repoId ?? null,
		workspaceId: workspaceId ?? null,
		workspaceState: workspaceState ?? null,
		setupScript: repoScripts?.setupScript ?? null,
		scriptsLoaded,
	});

	// Run-script state lifted to the sidebar so the tab header can render
	// the "Open dev server" shortcut. The button only appears while the
	// run script is actually running (a "resident" dev server). Once it's
	// visible it self-tunes: disabled "Open" until a URL is detected in
	// stdout, "Open:PORT" for a single URL, or a hover picker for 2+.
	const [runStatus, setRunStatus] = useState<ScriptStatus>("idle");
	const [runUrls, setRunUrls] = useState<string[]>([]);

	const runTabActions =
		runStatus === "running" ? <OpenDevServerButton urls={runUrls} /> : null;

	// Per-tab status for the small indicator rendered next to each tab label.
	// Subscribes at the sidebar level so the icons stay live even when the
	// tab body itself is collapsed / not mounted.
	const setupScriptState = useScriptStatus(
		activeScriptScopeId,
		"setup",
		!!repoScripts?.setupScript?.trim(),
	);
	const runScriptState = useScriptStatus(
		activeScriptScopeId,
		"run",
		!!repoScripts?.runScript?.trim(),
	);
	const archiveScriptState = useScriptStatus(
		activeScriptScopeId,
		"archive",
		!!repoScripts?.archiveScript?.trim(),
	);

	const handleReviewAllComments = useCallback(
		async (comments: PrComment[]) => {
			if (!workspaceId || !onQueuePendingPromptForSession) return;
			const { sessionId } = await createSession(workspaceId);
			seedNewSessionInCache({
				queryClient,
				workspaceId,
				sessionId,
				workspace:
					queryClient.getQueryData<WorkspaceDetail | null>(
						helmorQueryKeys.workspaceDetail(workspaceId),
					) ?? null,
				existingSessions:
					queryClient.getQueryData<WorkspaceSessionSummary[]>(
						helmorQueryKeys.workspaceSessions(workspaceId),
					) ?? [],
			});
			onQueuePendingPromptForSession({
				sessionId,
				prompt: buildReviewAllPrompt(comments, prCommentData),
				modelId: appSettings.prCommentReviewModelId,
				// Force-queue so the prompt fires even if a turn is currently streaming.
				forceQueue: true,
			});
			// Navigate to the new session so the pending prompt is consumed.
			onSelectSession?.(sessionId);
		},
		[
			appSettings.prCommentReviewModelId,
			onQueuePendingPromptForSession,
			onSelectSession,
			prCommentData,
			queryClient,
			workspaceId,
		],
	);

	// Live list of Terminal sub-tabs for the current workspace, observed at
	// the sidebar level so each terminal can be rendered as its own tab in
	// the unified Setup / Run / Terminals row.
	const [terminalInstances, setTerminalInstances] = useState<
		TerminalInstance[]
	>([]);
	useEffect(() => {
		if (!workspaceId) {
			setTerminalInstances([]);
			return;
		}
		return subscribeToWorkspaceList(workspaceId, (list) => {
			setTerminalInstances(list);
		});
	}, [workspaceId]);

	const canSpawnTerminal =
		!!repoId &&
		!!workspaceId &&
		terminalInstances.length < TERMINAL_INSTANCE_LIMIT;

	const handleAddTerminal = useCallback(() => {
		if (!repoId || !workspaceId) return;
		const next = createTerminal(repoId, workspaceId);
		if (next) setActiveTab(next.id);
	}, [repoId, workspaceId, setActiveTab]);

	const handleCloseTerminal = useCallback(
		(instanceId: string) => {
			if (!repoId || !workspaceId) return;
			// If the closing tab is active, fall back to the neighbour terminal
			// (right preferred, else left). Else fall back to "setup".
			if (activeTab === instanceId) {
				const idx = terminalInstances.findIndex((t) => t.id === instanceId);
				const fallback =
					terminalInstances[idx + 1] ?? terminalInstances[idx - 1];
				setActiveTab(fallback ? fallback.id : "setup");
			}
			closeTerminal(repoId, workspaceId, instanceId);
		},
		[repoId, workspaceId, activeTab, terminalInstances, setActiveTab],
	);

	const isTerminalTabActive = terminalInstances.some((t) => t.id === activeTab);

	// Terminal-scope shortcuts. Fire while focus is anywhere in the inspector
	// tabs section (Setup / Run / Terminal) — the `data-focus-scope="terminal"`
	// tag on the section root resolves to "terminal" via getActiveScopes — so
	// they don't compete with chat's Mod+T / Mod+W.
	const navigateTerminal = useCallback(
		(offset: -1 | 1) => {
			if (terminalInstances.length === 0) return;
			const idx = terminalInstances.findIndex((t) => t.id === activeTab);
			if (idx === -1) return;
			const nextIdx =
				(idx + offset + terminalInstances.length) % terminalInstances.length;
			const next = terminalInstances[nextIdx];
			if (next) setActiveTab(next.id);
		},
		[terminalInstances, activeTab, setActiveTab],
	);
	// App-scoped smart toggle for the terminal panel.
	//
	// Target selection: if the user is already on a terminal tab (either
	// just viewing it or actively typing in it), stay on that one — don't
	// hop to the rightmost. Only fall back to the rightmost terminal when
	// the panel is collapsed (so we don't know which terminal the user
	// "meant") or when the active tab is Setup/Run (the user wasn't on a
	// terminal at all). This preserves the current working terminal across
	// repeated presses.
	//
	// Behaviour ladder:
	//   1. No terminals yet → spawn one, expand the panel, focus it.
	//   2. Panel collapsed → expand + ensure target is active. Mount path
	//      will auto-focus the xterm.
	//   3. Panel open + Setup/Run active → switch to rightmost terminal +
	//      focus (mount path auto-focuses on isActive flip).
	//   4. Panel open + a terminal active but focus is elsewhere → pull
	//      focus into that already-mounted xterm.
	//   5. Panel open + a terminal active + focus already inside the
	//      xterm → collapse the panel (acts like the toggle-scripts
	//      shortcut). Second press of Mod+Shift+J hides the panel.
	const handleFocusTerminal = useCallback(() => {
		// 1. Empty state — bootstrap a new terminal.
		if (terminalInstances.length === 0) {
			if (!canSpawnTerminal) return;
			if (!tabsOpen) handleToggleTabs();
			handleAddTerminal();
			return;
		}

		const currentTerminal = terminalInstances.find((t) => t.id === activeTab);
		const target =
			currentTerminal ?? terminalInstances[terminalInstances.length - 1];

		// 2. Collapsed → expand. If activeTab already matches target (user
		//    was on this terminal before collapsing) setActiveTab is a
		//    no-op; either way the mount path auto-focuses.
		if (!tabsOpen) {
			handleToggleTabs();
			if (activeTab !== target.id) setActiveTab(target.id);
			return;
		}

		// 3. Open but Setup/Run active → switch to rightmost.
		if (activeTab !== target.id) {
			setActiveTab(target.id);
			return;
		}

		// 4 & 5. Open + a terminal already active. Distinguish by where
		// keyboard focus is right now.
		const targetPanel = document.getElementById(
			`inspector-panel-terminal-${target.id}`,
		);
		const focusInsideTarget =
			targetPanel?.contains(document.activeElement) ?? false;

		if (focusInsideTarget) {
			// 5. Already focused in this terminal — second press collapses.
			handleToggleTabs();
		} else {
			// 4. Pull focus into the existing, already-mounted xterm.
			window.dispatchEvent(new Event("helmor:focus-active-terminal"));
		}
	}, [
		terminalInstances,
		canSpawnTerminal,
		tabsOpen,
		handleToggleTabs,
		handleAddTerminal,
		activeTab,
		setActiveTab,
	]);

	const terminalShortcutHandlers = useMemo<ShortcutHandler[]>(
		() => [
			{
				id: "terminal.new",
				callback: handleAddTerminal,
				enabled: canSpawnTerminal,
			},
			{
				id: "terminal.close",
				callback: () => {
					if (!isTerminalTabActive) return;
					handleCloseTerminal(activeTab);
				},
				enabled: isTerminalTabActive,
			},
			{
				id: "terminal.previous",
				callback: () => navigateTerminal(-1),
				enabled: terminalInstances.length > 1,
			},
			{
				id: "terminal.next",
				callback: () => navigateTerminal(1),
				enabled: terminalInstances.length > 1,
			},
			{
				id: "inspector.toggleScripts",
				callback: handleToggleTabs,
			},
			{
				id: "inspector.focusTerminal",
				callback: handleFocusTerminal,
				// Always enabled — handler bootstraps a terminal if none
				// exist, expands when collapsed, focuses when not focused,
				// and collapses when focus is already in the active xterm.
				enabled: canSpawnTerminal || terminalInstances.length > 0,
			},
		],
		[
			activeTab,
			canSpawnTerminal,
			handleAddTerminal,
			handleCloseTerminal,
			handleFocusTerminal,
			handleToggleTabs,
			isTerminalTabActive,
			navigateTerminal,
			terminalInstances.length,
		],
	);
	useAppShortcuts({
		overrides: appSettings.shortcuts,
		handlers: terminalShortcutHandlers,
	});

	// Reset to "setup" when the active tab is a terminal id that no longer
	// matches any current instance, or when the Comments tab disappears
	// (e.g. PR was merged / comments cleared). Read the terminal store
	// synchronously too: on workspace switches the persisted tab id may
	// restore before this component's subscribed terminal list has received
	// its first snapshot.
	useEffect(() => {
		if (activeTab === "setup" || activeTab === "run" || activeTab === "archive")
			return;
		// Permanent tabs — never reset.
		if (
			activeTab === "knowledge" ||
			activeTab === "tools" ||
			activeTab === "git-timeline"
		)
			return;
		if (activeTab === "ingest") {
			if (showIngestTab) return;
			setActiveTab("setup");
			return;
		}
		if (activeTab === "comments") {
			if (showCommentsTab) return;
			setActiveTab("setup");
			return;
		}
		if (terminalInstances.some((t) => t.id === activeTab)) return;
		if (
			workspaceId &&
			getTerminals(workspaceId).some((t) => t.id === activeTab)
		) {
			return;
		}
		setActiveTab("setup");
	}, [
		activeTab,
		terminalInstances,
		workspaceId,
		setActiveTab,
		showCommentsTab,
		showIngestTab,
	]);

	// Only allow hover-to-zoom when the active tab has substantial scrollable
	// content. Comments can hold long review threads; script placeholders do not
	// benefit from enlargement.
	// "idle" = script configured but never run; "no-script" = nothing to run.
	// In both cases the body is a placeholder (Run / Open-settings button)
	// that doesn't benefit from — and shouldn't trigger — the enlargement.
	const scriptTabState =
		activeTab === "setup"
			? setupScriptState
			: activeTab === "archive"
				? archiveScriptState
				: runScriptState;
	const canHoverExpand =
		activeTab === "comments"
			? showCommentsTab
			: activeTab === "ingest"
				? false
				: activeTab === "knowledge" ||
						activeTab === "tools" ||
						activeTab === "git-timeline"
					? false
					: isTerminalTabActive
						? true
						: scriptTabState === "running" ||
							scriptTabState === "success" ||
							scriptTabState === "failure";

	const handleOpenSettings = onOpenSettings ?? (() => {});

	return (
		<div
			ref={containerRef}
			className={cn(
				"flex h-full min-h-0 flex-col bg-sidebar",
				isResizing && "select-none",
			)}
		>
			<ChangesSection
				sectionRef={changesRef}
				bodyHeight={changesHeight}
				workspaceId={workspaceId ?? null}
				workspaceRootPath={workspaceRootPath ?? null}
				workspaceTargetBranch={workspaceTargetBranch ?? null}
				changes={changes}
				gitContexts={gitContexts}
				editorMode={editorMode}
				activeEditorPath={activeEditorPath}
				onOpenEditorFile={onOpenEditorFile}
				flashingPaths={flashingPaths}
				onCommitAction={onCommitAction}
				commitButtonMode={commitButtonMode}
				commitButtonState={commitButtonState}
				changeRequest={changeRequest ?? null}
				forgeIsRefreshing={forgeIsRefreshing}
				onOpenDiagramMode={onOpenDiagramMode}
				selectedContextId={selectedGitContextId}
				onSelectedContextIdChange={setSelectedGitContextId}
			/>

			<HorizontalResizeHandle
				onMouseDown={handleResizeStart("actions")}
				isActive={isActionsResizing}
			/>

			<ActionsSection
				workspaceId={workspaceId ?? null}
				workspaceState={workspaceState ?? null}
				repoId={repoId ?? null}
				workspaceRemote={workspaceRemote ?? null}
				activeGitContext={activeGitContext}
				sectionRef={actionsRef}
				bodyHeight={actionsHeight}
				expanded={!tabsOpen}
				onCommitAction={onCommitAction}
				currentSessionId={currentSessionId ?? null}
				onQueuePendingPromptForSession={onQueuePendingPromptForSession}
				commitButtonMode={commitButtonMode}
				commitButtonState={commitButtonState}
				changeRequest={changeRequest ?? null}
				onOpenBrowserMode={onOpenBrowserMode}
				onOpenBrowserUrl={onOpenBrowserUrl}
			/>

			{tabsOpen && (
				<HorizontalResizeHandle
					onMouseDown={handleResizeStart("tabs")}
					isActive={isTabsResizing}
				/>
			)}

			<InspectorTabsSection
				wrapperRef={tabsWrapperRef}
				open={tabsOpen}
				onToggle={handleToggleTabs}
				activeTab={activeTab}
				onTabChange={setActiveTab}
				tabActions={runTabActions}
				setupScriptState={setupScriptState}
				runScriptState={runScriptState}
				archiveScriptState={archiveScriptState}
				terminalInstances={terminalInstances}
				onAddTerminal={handleAddTerminal}
				onCloseTerminal={handleCloseTerminal}
				canSpawnTerminal={canSpawnTerminal}
				canHoverExpand={canHoverExpand}
				showCommentsTab={showCommentsTab}
				showIngestTab={showIngestTab}
				hasUnresolvedComments={hasUnresolvedComments}
			>
				<SetupTab
					repoId={repoId ?? null}
					workspaceId={workspaceId ?? null}
					scriptScopeId={activeScriptScopeId}
					workingDirectoryOverride={activeScriptWorkingDirectory}
					setupScript={repoScripts?.setupScript ?? null}
					isActive={activeTab === "setup"}
					onOpenSettings={handleOpenSettings}
				/>
				<RunTab
					repoId={repoId ?? null}
					workspaceId={workspaceId ?? null}
					scriptScopeId={activeScriptScopeId}
					workingDirectoryOverride={activeScriptWorkingDirectory}
					runScript={repoScripts?.runScript ?? null}
					isActive={activeTab === "run"}
					onOpenSettings={handleOpenSettings}
					onStatusChange={setRunStatus}
					onUrlsChange={setRunUrls}
				/>
				<ArchiveTab
					repoId={repoId ?? null}
					workspaceId={workspaceId ?? null}
					scriptScopeId={activeScriptScopeId}
					workingDirectoryOverride={activeScriptWorkingDirectory}
					archiveScript={repoScripts?.archiveScript ?? null}
					isActive={activeTab === "archive"}
					onOpenSettings={handleOpenSettings}
				/>
				<IngestTab
					workspaceId={workspaceId ?? null}
					state={debugIngestState}
					isActive={activeTab === "ingest"}
				/>
				<CommentsTab
					workspaceId={workspaceId ?? null}
					prCommentData={prCommentData}
					isFetching={prCommentsQuery.isFetching}
					isActive={activeTab === "comments"}
					onReviewAllComments={handleReviewAllComments}
				/>
				<KnowledgeSection
					workspaceId={workspaceId ?? null}
					repoId={repoId ?? null}
					isActive={activeTab === "knowledge"}
				/>
				<GitTimelineSection
					workspaceRootPath={workspaceRootPath ?? null}
					isActive={activeTab === "git-timeline"}
				/>
				<AgentToolsSection isActive={activeTab === "tools"} />
				{terminalInstances.map((instance) => (
					<TerminalInstancePanel
						key={instance.id}
						repoId={repoId ?? null}
						workspaceId={workspaceId ?? null}
						instance={instance}
						isActive={activeTab === instance.id}
					/>
				))}
			</InspectorTabsSection>
		</div>
	);
}
