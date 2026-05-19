import {
	CircleAlert,
	GitPullRequestDraft,
	LoaderCircle,
	Pencil,
} from "lucide-react";
import type React from "react";
import type {
	CommitButtonState,
	WorkspaceCommitButtonMode,
} from "@/features/commit/button";
import { GitSectionHeader } from "@/features/inspector/sections/git-section-header";
import type {
	ChangeRequestInfo,
	ForgeActionStatus,
	ForgeDetection,
	PrSyncState,
	WorkspaceState,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type GoalSetupStatus = {
	label: string;
	tone: "progress" | "warning" | "failure" | "muted";
	busy?: boolean;
};

type GoalHeaderProps = {
	headerLeading?: React.ReactNode;
	goalTitle: string;
	goalDescription: string | null;
	prSyncState?: PrSyncState | null;
	workspaceState?: WorkspaceState | null;
	hasSetupScript?: boolean;
	setupScriptsLoaded?: boolean;
	setupScriptState?: "no-script" | "idle" | "running" | "success" | "failure";
	hasBranch?: boolean;
	hasTargetBranch?: boolean;
	commitButtonMode?: WorkspaceCommitButtonMode;
	commitButtonState?: CommitButtonState;
	changeRequest?: ChangeRequestInfo | null;
	changeRequestName?: string;
	forgeDetection?: ForgeDetection | null;
	forgeRemoteState?: ForgeActionStatus["remoteState"] | null;
	workspaceId?: string | null;
	hasGitChanges?: boolean;
	forgeIsRefreshing?: boolean;
	onCommitAction?: (mode: WorkspaceCommitButtonMode) => Promise<void>;
	onOpenChangeRequest?: () => void;
	onRefreshPrStatus?: () => Promise<void>;
	kbBadge?: React.ReactNode;
	onEditGoal: () => void;
};

function setupStatus({
	canCreateCards,
	workspaceState,
	prSyncState,
	hasBranch,
	hasTargetBranch,
	hasSetupScript,
	setupScriptsLoaded,
	setupScriptState,
}: {
	canCreateCards: boolean;
	workspaceState?: WorkspaceState | null;
	prSyncState?: PrSyncState | null;
	hasBranch?: boolean;
	hasTargetBranch?: boolean;
	hasSetupScript?: boolean;
	setupScriptsLoaded?: boolean;
	setupScriptState?: GoalHeaderProps["setupScriptState"];
}): GoalSetupStatus | null {
	if (canCreateCards) return null;

	if (!workspaceState) {
		return { label: "Loading goal", tone: "muted", busy: true };
	}

	if (workspaceState === "initializing") {
		return { label: "Preparing goal", tone: "progress", busy: true };
	}

	if (!hasBranch) {
		return { label: "Creating branch", tone: "progress", busy: true };
	}

	if (!hasTargetBranch) {
		return { label: "Resolving target", tone: "progress", busy: true };
	}

	if (prSyncState !== "open") {
		return { label: "Opening PR", tone: "warning", busy: true };
	}

	if (workspaceState === "setup_pending") {
		if (!setupScriptsLoaded) {
			return { label: "Checking setup", tone: "progress", busy: true };
		}
		if (setupScriptState === "failure") {
			return { label: "Setup failed", tone: "failure" };
		}
		if (setupScriptState === "running") {
			return { label: "Running setup", tone: "progress", busy: true };
		}
		if (setupScriptState === "success") {
			return { label: "Finishing setup", tone: "progress", busy: true };
		}
		if (hasSetupScript) {
			return { label: "Setup queued", tone: "warning", busy: true };
		}
		return { label: "Completing setup", tone: "progress", busy: true };
	}

	return { label: "Goal not ready", tone: "muted" };
}

function GoalSetupBadge({ status }: { status: GoalSetupStatus }) {
	return (
		<div
			role="status"
			className={cn(
				"inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[min(var(--radius-md),12px)] border px-2 text-[12px] font-medium leading-none",
				status.tone === "progress" &&
					"border-[color-mix(in_srgb,var(--workspace-pr-open-accent)_35%,var(--border))] bg-[color-mix(in_srgb,var(--workspace-pr-open-accent)_8%,transparent)] text-[var(--workspace-pr-open-accent)]",
				status.tone === "warning" &&
					"border-[color-mix(in_srgb,var(--workspace-pr-conflicts-accent)_45%,var(--border))] bg-[color-mix(in_srgb,var(--workspace-pr-conflicts-accent)_10%,transparent)] text-[var(--workspace-pr-conflicts-accent)]",
				status.tone === "failure" &&
					"border-[color-mix(in_srgb,var(--workspace-pr-closed-accent)_45%,var(--border))] bg-[color-mix(in_srgb,var(--workspace-pr-closed-accent)_10%,transparent)] text-[var(--workspace-pr-closed-accent)]",
				status.tone === "muted" &&
					"border-border/70 bg-muted/30 text-muted-foreground",
			)}
		>
			{status.busy ? (
				<LoaderCircle className="size-3 animate-spin" strokeWidth={2} />
			) : status.tone === "failure" ? (
				<CircleAlert className="size-3" strokeWidth={2} />
			) : (
				<span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
			)}
			<span>{status.label}</span>
		</div>
	);
}

export function GoalHeader({
	headerLeading,
	goalTitle,
	goalDescription,
	prSyncState,
	workspaceState,
	hasSetupScript = false,
	setupScriptsLoaded = false,
	setupScriptState = "no-script",
	hasBranch = false,
	hasTargetBranch = false,
	commitButtonMode = "create-pr",
	commitButtonState,
	changeRequest = null,
	changeRequestName = "PR",
	forgeDetection = null,
	forgeRemoteState = null,
	workspaceId = null,
	hasGitChanges = false,
	forgeIsRefreshing = false,
	kbBadge,
	onCommitAction,
	onOpenChangeRequest,
	onRefreshPrStatus,
	onEditGoal,
}: GoalHeaderProps) {
	const setup = setupStatus({
		// Pass false — we never want to suppress the badge here based on
		// card-creation readiness. The tab bar owns the Add card gating.
		canCreateCards: false,
		workspaceState,
		prSyncState,
		hasBranch,
		hasTargetBranch,
		hasSetupScript,
		setupScriptsLoaded,
		setupScriptState,
	});

	return (
		<>
			<header
				className="flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-3"
				data-tauri-drag-region
			>
				<div className="flex min-w-0 items-center gap-2">
					{headerLeading}
					<div className="min-w-0">
						<div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
							<GitPullRequestDraft className="size-3.5" strokeWidth={1.8} />
							Goal Workspace
						</div>
						<h1 className="mt-0.5 truncate text-lg font-semibold tracking-[-0.02em]">
							{goalTitle}
						</h1>
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-2">
					{kbBadge ? (
						<div className="flex shrink-0 items-center">{kbBadge}</div>
					) : null}
					{setup ? <GoalSetupBadge status={setup} /> : null}
				</div>
			</header>

			{/* Git status banner — full-width action strip below the title row */}
			<GitSectionHeader
				commitButtonMode={commitButtonMode}
				commitButtonState={commitButtonState}
				changeRequest={changeRequest}
				changeRequestName={changeRequestName}
				forgeDetection={forgeDetection}
				forgeRemoteState={forgeRemoteState}
				workspaceId={workspaceId}
				hasChanges={hasGitChanges}
				isRefreshing={forgeIsRefreshing}
				onChangeRequestClick={onOpenChangeRequest}
				onCommit={
					onCommitAction ? () => onCommitAction(commitButtonMode) : undefined
				}
				onRefreshPrStatus={onRefreshPrStatus}
				className="px-5"
			/>

			{/* Description row — click to edit */}
			<button
				type="button"
				className="group flex shrink-0 cursor-pointer items-start gap-2 border-b border-border/50 bg-muted/20 px-5 py-2 text-left transition-colors hover:bg-muted/40"
				onClick={onEditGoal}
				title="Edit goal title and description"
			>
				<div className="min-w-0 flex-1">
					{goalDescription ? (
						<p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
							{goalDescription}
						</p>
					) : (
						<p className="text-[12px] italic text-muted-foreground/50">
							Add a description for this goal…
						</p>
					)}
				</div>
				<Pencil className="mt-0.5 size-3 shrink-0 text-muted-foreground/30 transition-opacity group-hover:text-muted-foreground/60" />
			</button>
		</>
	);
}
