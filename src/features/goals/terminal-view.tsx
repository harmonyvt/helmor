import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScriptStatus } from "@/features/inspector/hooks/use-script-status";
import { InspectorTabsSection } from "@/features/inspector/layout";
import type { ScriptStatus } from "@/features/inspector/script-store";
import { ArchiveTab } from "@/features/inspector/sections/archive";
import { OpenDevServerButton, RunTab } from "@/features/inspector/sections/run";
import { SetupTab } from "@/features/inspector/sections/setup";
import { TerminalInstancePanel } from "@/features/inspector/sections/terminal";
import {
	closeTerminal,
	createTerminal,
	subscribeToWorkspaceList,
	TERMINAL_INSTANCE_LIMIT,
	type TerminalInstance,
} from "@/features/inspector/terminal-store";
import { loadRepoScripts } from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";

type GoalTerminalViewProps = {
	workspaceId: string;
	repoId: string | null;
	onOpenSettings: () => void;
};

/**
 * Full-screen terminal panel for goal workspaces. Renders the Setup / Run /
 * Archive script tabs plus any live terminal instances, filling the entire
 * available panel area below the goal header and tab bar.
 *
 * Reuses the same InspectorTabsSection, terminal-store, and script-section
 * components as the regular workspace inspector so behaviour is identical —
 * scripts persist across goal-tab switches, terminals stay mounted, etc.
 */
export function GoalTerminalView({
	workspaceId,
	repoId,
	onOpenSettings,
}: GoalTerminalViewProps) {
	const [activeTab, setActiveTab] = useState("setup");
	const [terminalInstances, setTerminalInstances] = useState<
		TerminalInstance[]
	>([]);
	const [runStatus, setRunStatus] = useState<ScriptStatus>("idle");
	const [runUrls, setRunUrls] = useState<string[]>([]);
	// wrapperRef is passed to InspectorTabsSection for zoom-clamp calculations.
	// Hover-zoom is disabled in full-screen mode (canHoverExpand=false) so the
	// ref is only used as a safe fallback — no actual zoom fires.
	const wrapperRef = useRef<HTMLDivElement>(null);

	const repoScriptsQuery = useQuery({
		queryKey: helmorQueryKeys.repoScripts(repoId ?? "__none__", workspaceId),
		queryFn: () => loadRepoScripts(repoId!, workspaceId),
		enabled: Boolean(repoId),
		staleTime: 0,
	});
	const repoScripts = repoScriptsQuery.data ?? null;

	useEffect(() => {
		setRunStatus("idle");
		setRunUrls([]);
	}, [workspaceId, repoId]);

	// Subscribe to the workspace's terminal instance list.
	useEffect(() => {
		return subscribeToWorkspaceList(workspaceId, setTerminalInstances);
	}, [workspaceId]);

	// Per-tab script-status icons (live even when a tab body isn't mounted).
	const setupScriptState = useScriptStatus(
		workspaceId,
		"setup",
		Boolean(repoScripts?.setupScript?.trim()),
	);
	const runScriptState = useScriptStatus(
		workspaceId,
		"run",
		Boolean(repoScripts?.runScript?.trim()),
	);
	const archiveScriptState = useScriptStatus(
		workspaceId,
		"archive",
		Boolean(repoScripts?.archiveScript?.trim()),
	);

	const canSpawnTerminal =
		Boolean(repoId) && terminalInstances.length < TERMINAL_INSTANCE_LIMIT;

	const handleAddTerminal = useCallback(() => {
		if (!repoId) return;
		const next = createTerminal(repoId, workspaceId);
		if (next) setActiveTab(next.id);
	}, [repoId, workspaceId]);

	const handleCloseTerminal = useCallback(
		(instanceId: string) => {
			if (!repoId) return;
			if (activeTab === instanceId) {
				const idx = terminalInstances.findIndex((t) => t.id === instanceId);
				const fallback =
					terminalInstances[idx + 1] ?? terminalInstances[idx - 1];
				setActiveTab(fallback ? fallback.id : "setup");
			}
			closeTerminal(repoId, workspaceId, instanceId);
		},
		[repoId, workspaceId, activeTab, terminalInstances],
	);

	// Guard: if the active tab is a terminal id that was closed, fall back.
	useEffect(() => {
		if (activeTab === "setup" || activeTab === "run" || activeTab === "archive")
			return;
		if (terminalInstances.some((t) => t.id === activeTab)) return;
		setActiveTab("setup");
	}, [activeTab, terminalInstances]);

	const runTabActions =
		runStatus === "running" ? <OpenDevServerButton urls={runUrls} /> : null;

	// In full-screen mode the panel is already filling all available height —
	// hover-zoom would grow into the goal header area which is undesirable.
	// Disable it entirely so the familiar inspector UX doesn't leak into the
	// goals layout.
	const canHoverExpand = false;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<InspectorTabsSection
				wrapperRef={wrapperRef}
				open={true}
				onToggle={() => {
					/* always open in full-screen view */
				}}
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
				showCommentsTab={false}
				showIngestTab={false}
				hasUnresolvedComments={false}
			>
				<SetupTab
					repoId={repoId}
					workspaceId={workspaceId}
					setupScript={repoScripts?.setupScript ?? null}
					isActive={activeTab === "setup"}
					onOpenSettings={onOpenSettings}
				/>
				<RunTab
					repoId={repoId}
					workspaceId={workspaceId}
					runScript={repoScripts?.runScript ?? null}
					isActive={activeTab === "run"}
					onOpenSettings={onOpenSettings}
					onStatusChange={setRunStatus}
					onUrlsChange={setRunUrls}
				/>
				<ArchiveTab
					repoId={repoId}
					workspaceId={workspaceId}
					archiveScript={repoScripts?.archiveScript ?? null}
					isActive={activeTab === "archive"}
					onOpenSettings={onOpenSettings}
				/>
				{terminalInstances.map((instance) => (
					<TerminalInstancePanel
						key={instance.id}
						repoId={repoId}
						workspaceId={workspaceId}
						instance={instance}
						isActive={activeTab === instance.id}
					/>
				))}
			</InspectorTabsSection>
		</div>
	);
}
