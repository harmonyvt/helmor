import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserTabPanel } from "@/features/browser-tabs";
import {
	browserIdFromToolTabId,
	browserToolTabId,
} from "@/features/browser-tabs/ids";
import { closeBrowserWebviewForTab } from "@/features/browser-tabs/runtime";
import type {
	CommitButtonState,
	WorkspaceCommitButtonMode,
} from "@/features/commit/button";
import {
	type ShortcutHandler,
	useAppShortcuts,
} from "@/features/shortcuts/use-app-shortcuts";
import {
	type ChangeRequestInfo,
	closeBrowserTab,
	createBrowserTab,
	createSession,
	type PrComment,
	selectBrowserTab,
} from "@/lib/api";
import type { DiffOpenOptions } from "@/lib/editor-session";
import { workspaceBrowserTabsQueryOptions } from "@/lib/query-client";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { useWorkspaceInspectorSidebar } from "./hooks/use-inspector";
import { useScriptStatus } from "./hooks/use-script-status";
import { useSetupAutoRun } from "./hooks/use-setup-auto-run";
import { HorizontalResizeHandle, InspectorTabsSection } from "./layout";
import type { ScriptStatus } from "./script-store";
import { ActionsSection } from "./sections/actions";
import { ChangesSection } from "./sections/changes";
import { OpenDevServerButton, RunTab } from "./sections/run";
import { SetupTab } from "./sections/setup";
import { TerminalInstancePanel } from "./sections/terminal";
import {
	closeTerminal,
	createTerminal,
	subscribeToWorkspaceList,
	TERMINAL_INSTANCE_LIMIT,
	type TerminalInstance,
} from "./terminal-store";

// ── Review-all prompt builder ─────────────────────────────────────────────────

function buildReviewAllPrompt(comments: PrComment[]): string {
	const inlineUnresolved = comments.filter(
		(c) => c.filePath != null && !c.isThreadResolved,
	);
	const generalComments = comments.filter((c) => c.filePath == null);

	const sections: string[] = [
		"Please review and address all outstanding PR review comments.",
	];

	if (inlineUnresolved.length > 0) {
		sections.push("\n## Inline Code Review Comments");
		// Group by file path.
		const byFile = new Map<string, PrComment[]>();
		for (const comment of inlineUnresolved) {
			const key = comment.filePath!;
			const group = byFile.get(key);
			if (group) {
				group.push(comment);
			} else {
				byFile.set(key, [comment]);
			}
		}
		for (const [filePath, fileComments] of byFile) {
			sections.push(`\n### ${filePath}`);
			for (const comment of fileComments) {
				sections.push(`**@${comment.author}**: ${comment.body}`);
			}
		}
	}

	if (generalComments.length > 0) {
		sections.push("\n## General PR Comments");
		for (const comment of generalComments) {
			sections.push(`\n### @${comment.author}`);
			sections.push(comment.body);
		}
	}

	sections.push(
		"\n---\nFor each comment, understand the requested change and implement it. Run the relevant tests to confirm nothing is broken.",
	);

	return sections.join("\n");
}

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
	onCommitAction?: (mode: WorkspaceCommitButtonMode) => Promise<void>;
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
	commitButtonMode,
	commitButtonState,
	changeRequest,
	forgeIsRefreshing = false,
	onOpenSettings,
}: WorkspaceInspectorSidebarProps) {
	const {
		actionsHeight,
		actionsRef,
		activeTab,
		changes,
		changesHeight,
		containerRef,
		flashingPaths,
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
		workspaceId ?? null,
		"setup",
		!!repoScripts?.setupScript?.trim(),
	);
	const runScriptState = useScriptStatus(
		workspaceId ?? null,
		"run",
		!!repoScripts?.runScript?.trim(),
	);

	const handleReviewAllComments = useCallback(
		async (comments: PrComment[]) => {
			if (!workspaceId || !onQueuePendingPromptForSession) return;
			const { sessionId } = await createSession(workspaceId);
			onQueuePendingPromptForSession({
				sessionId,
				prompt: buildReviewAllPrompt(comments),
				forceQueue: false,
			});
		},
		[workspaceId, onQueuePendingPromptForSession],
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

	const browserTabsQuery = useQuery({
		...workspaceBrowserTabsQueryOptions(workspaceId ?? ""),
		enabled: !!workspaceId,
	});
	const browserTabs = browserTabsQuery.data ?? [];
	const restoredBrowserWorkspaceRef = useRef<string | null>(null);
	useEffect(() => {
		if (!workspaceId || !browserTabsQuery.isFetched) return;
		if (restoredBrowserWorkspaceRef.current === workspaceId) return;
		restoredBrowserWorkspaceRef.current = workspaceId;
		const activeBrowserTab = browserTabs.find((tab) => tab.active);
		if (activeBrowserTab) setActiveTab(browserToolTabId(activeBrowserTab.id));
	}, [workspaceId, browserTabsQuery.isFetched, browserTabs, setActiveTab]);

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

	const handleToolTabChange = useCallback(
		(tabId: string) => {
			setActiveTab(tabId);
			const browserTabId = browserIdFromToolTabId(tabId);
			if (browserTabId)
				void selectBrowserTab(browserTabId).catch(() => undefined);
		},
		[setActiveTab],
	);

	const handleAddBrowserTab = useCallback(() => {
		if (!workspaceId) return;
		void createBrowserTab(workspaceId).then((tab) => {
			setActiveTab(browserToolTabId(tab.id));
		});
	}, [workspaceId, setActiveTab]);

	const handleCloseBrowserTab = useCallback(
		(tabId: string) => {
			if (!workspaceId) return;
			void closeBrowserWebviewForTab(tabId);
			if (activeTab === browserToolTabId(tabId)) {
				const idx = browserTabs.findIndex((tab) => tab.id === tabId);
				const fallback = browserTabs[idx + 1] ?? browserTabs[idx - 1];
				if (fallback) {
					setActiveTab(browserToolTabId(fallback.id));
				} else if (terminalInstances.length > 0) {
					setActiveTab(terminalInstances[terminalInstances.length - 1].id);
				} else {
					setActiveTab("setup");
				}
			}
			void closeBrowserTab(tabId);
		},
		[activeTab, browserTabs, terminalInstances, workspaceId, setActiveTab],
	);

	const isTerminalTabActive = terminalInstances.some((t) => t.id === activeTab);
	const isBrowserTabActive = !!browserIdFromToolTabId(activeTab);

	// Pinned-expand state: when true the InspectorTabsSection fills the full
	// inspector column by hiding the Changes and Actions sections above it.
	// Tracked as two independent sources so a hover-collapse doesn't clobber
	// a button-pinned expansion, and vice-versa.
	const [tabsExpandedByButton, setTabsExpandedByButton] = useState(false);
	const [tabsExpandedByHover, setTabsExpandedByHover] = useState(false);
	const tabsExpanded = tabsExpandedByButton || tabsExpandedByHover;

	// Reset expand when workspace changes or when the active tab is no longer
	// a terminal or browser (e.g. user switches to Setup while expanded).
	useEffect(() => {
		setTabsExpandedByButton(false);
		setTabsExpandedByHover(false);
	}, [workspaceId]);
	useEffect(() => {
		if (!isTerminalTabActive && !isBrowserTabActive) {
			setTabsExpandedByButton(false);
			setTabsExpandedByHover(false);
		}
	}, [isTerminalTabActive, isBrowserTabActive]);
	// Hover-triggered fill expand only applies to the terminal tab. Reset it
	// immediately when the user switches away so the sections reappear.
	useEffect(() => {
		if (!isTerminalTabActive) {
			setTabsExpandedByHover(false);
		}
	}, [isTerminalTabActive]);

	const canExpand = tabsOpen && (isTerminalTabActive || isBrowserTabActive);

	const handleToggleTabsWithReset = useCallback(() => {
		// Collapsing the panel always exits expand mode too.
		if (tabsOpen) {
			setTabsExpandedByButton(false);
			setTabsExpandedByHover(false);
		}
		handleToggleTabs();
	}, [tabsOpen, handleToggleTabs]);

	const handleExpandToggle = useCallback(() => {
		setTabsExpandedByButton((prev) => !prev);
	}, []);

	// Called by layout.tsx when fill-mode hover activates or deactivates.
	const handleHoverFill = useCallback((active: boolean) => {
		setTabsExpandedByHover(active);
	}, []);

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
	const { settings: appSettings } = useSettings();
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
			if (!tabsOpen) handleToggleTabsWithReset();
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
			handleToggleTabsWithReset();
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
			handleToggleTabsWithReset();
		} else {
			// 4. Pull focus into the existing, already-mounted xterm.
			window.dispatchEvent(new Event("helmor:focus-active-terminal"));
		}
	}, [
		terminalInstances,
		canSpawnTerminal,
		tabsOpen,
		handleToggleTabsWithReset,
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
				callback: handleToggleTabsWithReset,
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
			handleToggleTabsWithReset,
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
	// matches any current instance — happens when switching workspaces while
	// a terminal tab was active in the previous one.
	useEffect(() => {
		if (activeTab === "setup" || activeTab === "run") return;
		const browserTabId = browserIdFromToolTabId(activeTab);
		if (browserTabId) {
			if (browserTabs.some((tab) => tab.id === browserTabId)) return;
			setActiveTab("setup");
			return;
		}
		if (terminalInstances.some((t) => t.id === activeTab)) return;
		setActiveTab("setup");
	}, [activeTab, browserTabs, terminalInstances, setActiveTab]);

	// Only allow hover-to-zoom when the active tab has real terminal output.
	// "idle" = script configured but never run; "no-script" = nothing to run.
	// In both cases the body is a placeholder (Run / Open-settings button)
	// that doesn't benefit from — and shouldn't trigger — the enlargement.
	const scriptTabState =
		activeTab === "setup" ? setupScriptState : runScriptState;
	// Disable hover-expand when the panel is already pinned-expanded.
	const canHoverExpand =
		!tabsExpanded &&
		(isTerminalTabActive
			? true
			: isBrowserTabActive
				? true // Browser uses the 2× zoom mode (hoverExpandMode="zoom")
				: scriptTabState === "running" ||
					scriptTabState === "success" ||
					scriptTabState === "failure");

	// Terminal hover triggers the full-screen pinned expand (fill mode);
	// browser and script tabs use the 2× CSS zoom (zoom mode).
	const hoverExpandMode: "zoom" | "fill" = isTerminalTabActive
		? "fill"
		: "zoom";

	const handleOpenSettings = onOpenSettings ?? (() => {});

	// When pinned-expanded we keep Changes/Actions mounted but hidden via a
	// `hidden` wrapper so layout is stable and their state is preserved. The
	// InspectorTabsSection is the only visible flex child and takes flex-1.
	const sectionsHidden = tabsExpanded && canExpand;

	return (
		<div
			ref={containerRef}
			className={cn(
				"flex h-full min-h-0 flex-col bg-sidebar",
				isResizing && "select-none",
			)}
		>
			<div className={cn(sectionsHidden && "hidden")}>
				<ChangesSection
					bodyHeight={changesHeight}
					workspaceId={workspaceId ?? null}
					workspaceRootPath={workspaceRootPath ?? null}
					workspaceTargetBranch={workspaceTargetBranch ?? null}
					changes={changes}
					editorMode={editorMode}
					activeEditorPath={activeEditorPath}
					onOpenEditorFile={onOpenEditorFile}
					flashingPaths={flashingPaths}
					onCommitAction={onCommitAction}
					commitButtonMode={commitButtonMode}
					commitButtonState={commitButtonState}
					changeRequest={changeRequest ?? null}
					forgeIsRefreshing={forgeIsRefreshing}
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
					sectionRef={actionsRef}
					bodyHeight={actionsHeight}
					expanded={!tabsOpen}
					onCommitAction={onCommitAction}
					currentSessionId={currentSessionId ?? null}
					onQueuePendingPromptForSession={onQueuePendingPromptForSession}
					commitButtonMode={commitButtonMode}
					commitButtonState={commitButtonState}
					changeRequest={changeRequest ?? null}
					onReviewAllComments={handleReviewAllComments}
				/>

				{tabsOpen && (
					<HorizontalResizeHandle
						onMouseDown={handleResizeStart("tabs")}
						isActive={isTabsResizing}
					/>
				)}
			</div>

			<InspectorTabsSection
				wrapperRef={tabsWrapperRef}
				open={tabsOpen}
				onToggle={handleToggleTabsWithReset}
				activeTab={activeTab}
				onTabChange={handleToolTabChange}
				tabActions={runTabActions}
				setupScriptState={setupScriptState}
				runScriptState={runScriptState}
				terminalInstances={terminalInstances}
				browserTabs={browserTabs}
				onAddTerminal={handleAddTerminal}
				onCloseTerminal={handleCloseTerminal}
				onAddBrowserTab={handleAddBrowserTab}
				onCloseBrowserTab={handleCloseBrowserTab}
				canSpawnTerminal={canSpawnTerminal}
				canHoverExpand={canHoverExpand}
				hoverExpandMode={hoverExpandMode}
				onHoverFill={handleHoverFill}
				canExpand={canExpand}
				isExpanded={sectionsHidden}
				onExpandToggle={handleExpandToggle}
			>
				<SetupTab
					repoId={repoId ?? null}
					workspaceId={workspaceId ?? null}
					setupScript={repoScripts?.setupScript ?? null}
					isActive={activeTab === "setup"}
					onOpenSettings={handleOpenSettings}
				/>
				<RunTab
					repoId={repoId ?? null}
					workspaceId={workspaceId ?? null}
					runScript={repoScripts?.runScript ?? null}
					isActive={activeTab === "run"}
					onOpenSettings={handleOpenSettings}
					onStatusChange={setRunStatus}
					onUrlsChange={setRunUrls}
				/>
				{terminalInstances.map((instance) => (
					<TerminalInstancePanel
						key={instance.id}
						repoId={repoId ?? null}
						workspaceId={workspaceId ?? null}
						instance={instance}
						isActive={activeTab === instance.id}
					/>
				))}
				{browserTabs.map((tab) => (
					<BrowserTabPanel
						key={tab.id}
						tab={tab}
						isActive={activeTab === browserToolTabId(tab.id)}
					/>
				))}
			</InspectorTabsSection>
		</div>
	);
}
