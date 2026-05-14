import {
	CircleAlert,
	GitPullRequestDraft,
	LoaderCircle,
	Pencil,
	Plus,
} from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import type { PrSyncState, WorkspaceState } from "@/lib/api";
import { parsePrUrl } from "@/lib/pr-url";
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
	prUrl?: string | null;
	prSyncState?: PrSyncState | null;
	workspaceState?: WorkspaceState | null;
	hasSetupScript?: boolean;
	setupScriptsLoaded?: boolean;
	setupScriptState?: "no-script" | "idle" | "running" | "success" | "failure";
	hasBranch?: boolean;
	hasTargetBranch?: boolean;
	onEditGoal: () => void;
	onShowAddCard: () => void;
	canCreateCards?: boolean;
	/** Rendered in the right action area — use this to pass the Pi chip. */
	headerActions?: React.ReactNode;
};

function prAccentClass(prSyncState?: PrSyncState | null) {
	switch (prSyncState) {
		case "open":
			return "border-[var(--workspace-pr-open-accent)] bg-[color-mix(in_srgb,var(--workspace-pr-open-accent)_10%,transparent)] text-[var(--workspace-pr-open-accent)] hover:bg-[color-mix(in_srgb,var(--workspace-pr-open-accent)_16%,transparent)] hover:text-[var(--workspace-pr-open-accent)]";
		case "merged":
			return "border-[var(--workspace-pr-merged-accent)] bg-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_10%,transparent)] text-[var(--workspace-pr-merged-accent)] hover:bg-[color-mix(in_srgb,var(--workspace-pr-merged-accent)_16%,transparent)] hover:text-[var(--workspace-pr-merged-accent)]";
		case "closed":
			return "border-[var(--workspace-pr-closed-accent)] bg-[color-mix(in_srgb,var(--workspace-pr-closed-accent)_10%,transparent)] text-[var(--workspace-pr-closed-accent)] hover:bg-[color-mix(in_srgb,var(--workspace-pr-closed-accent)_16%,transparent)] hover:text-[var(--workspace-pr-closed-accent)]";
		default:
			return null;
	}
}

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
	prUrl,
	prSyncState,
	workspaceState,
	hasSetupScript = false,
	setupScriptsLoaded = false,
	setupScriptState = "no-script",
	hasBranch = false,
	hasTargetBranch = false,
	onEditGoal,
	onShowAddCard,
	canCreateCards = true,
	headerActions,
}: GoalHeaderProps) {
	const parsedPr = parsePrUrl(prUrl);
	const setup = setupStatus({
		canCreateCards,
		workspaceState,
		prSyncState,
		hasBranch,
		hasTargetBranch,
		hasSetupScript,
		setupScriptsLoaded,
		setupScriptState,
	});
	const prClassName = prAccentClass(prSyncState);

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
					{setup ? <GoalSetupBadge status={setup} /> : null}
					{prUrl ? (
						<Button
							asChild
							variant="outline"
							size="sm"
							className={cn("cursor-pointer", prClassName)}
						>
							<a href={prUrl} target="_blank" rel="noreferrer">
								{parsedPr ? `Open PR #${parsedPr.number}` : "Open PR"}
							</a>
						</Button>
					) : null}
					{headerActions}
					<Button
						variant="outline"
						size="sm"
						className="cursor-pointer"
						onClick={onShowAddCard}
						disabled={!canCreateCards}
						title={
							canCreateCards
								? "Add card"
								: "Goal setup must finish before adding cards"
						}
					>
						<Plus className="size-3.5" />
						Add card
					</Button>
				</div>
			</header>

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
						<p className="text-[12px] text-muted-foreground/50 italic">
							Add a description for this goal…
						</p>
					)}
				</div>
				<Pencil className="mt-0.5 size-3 shrink-0 text-muted-foreground/30 transition-opacity group-hover:text-muted-foreground/60" />
			</button>
		</>
	);
}
