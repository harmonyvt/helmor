import {
	Check,
	ChevronDown,
	ChevronRight,
	Download,
	Loader2,
	X,
} from "lucide-react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkspaceToast } from "@/lib/workspace-toast-context";
import { SettingsNotice, SettingsRow } from "../components/settings-row";
import {
	cancelLocalAppInstall,
	getLocalAppInstallSnapshot,
	type InstallUiState,
	startLocalAppInstall,
	subscribeLocalAppInstall,
	type UiStepStatus,
} from "./local-app-update-store";

function stepStatusClass(status: UiStepStatus) {
	switch (status) {
		case "ok":
			return "border-app-success/30 bg-app-success/10 text-app-success";
		case "warning":
			return "border-app-warning/30 bg-app-warning/10 text-app-warning";
		case "skipped":
			return "border-app-muted/20 bg-app-muted/40 text-app-muted";
		case "error":
			return "border-app-destructive/35 bg-app-destructive/10 text-app-destructive";
		case "running":
			return "border-app-info/30 bg-app-info/10 text-app-info";
		default:
			return "border-app-border/50 bg-app-base/20 text-app-foreground";
	}
}

function currentStepLabel(state: InstallUiState) {
	if (!state.currentStepId) return "Preparing update…";
	return (
		state.steps.find((step) => step.id === state.currentStepId)?.label ??
		"Running update…"
	);
}

export function LocalAppUpdatePanel() {
	const installState = useSyncExternalStore(
		subscribeLocalAppInstall,
		getLocalAppInstallSnapshot,
		getLocalAppInstallSnapshot,
	);
	const [logsExpanded, setLogsExpanded] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const pushToast = useWorkspaceToast();

	const installingApp = installState.phase === "running";
	const appInstallError = installState.error;

	const completedCount = useMemo(
		() =>
			installState.steps.filter((step) =>
				["ok", "warning", "skipped"].includes(step.status),
			).length,
		[installState.steps],
	);

	const handleInstallApp = useCallback(async () => {
		setLogsExpanded(false);
		try {
			await startLocalAppInstall();
		} catch {}
	}, []);

	const handleCancel = useCallback(async () => {
		setCancelling(true);
		try {
			await cancelLocalAppInstall();
		} catch (error) {
			pushToast(
				error instanceof Error ? error.message : String(error),
				"Unable to cancel update",
				"destructive",
			);
		} finally {
			setCancelling(false);
		}
	}, [pushToast]);

	return (
		<SettingsRow
			align="start"
			title={
				<span className="flex items-center gap-1.5">
					<Download
						className="size-3.5 text-muted-foreground"
						strokeWidth={1.8}
					/>
					<span>App Updates</span>
				</span>
			}
			description={
				<>
					Pull the latest changes into
					<code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">
						~/helmor
					</code>
					then build, sign, verify, and install the macOS app to
					<code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">
						/Applications/Helmor.app
					</code>
					.
					{appInstallError ? (
						<SettingsNotice tone="error">{appInstallError}</SettingsNotice>
					) : null}
					{installState.phase !== "idle" ? (
						<AppInstallProgressCard
							state={installState}
							completedCount={completedCount}
							logsExpanded={logsExpanded}
							onToggleLogs={() => setLogsExpanded((expanded) => !expanded)}
						/>
					) : null}
					{installState.result?.restartRequired ? (
						<SettingsNotice tone="warn">
							Restart Helmor to start using the installed update.
						</SettingsNotice>
					) : null}
				</>
			}
		>
			<div className="flex items-center gap-2">
				{installingApp ? (
					<Button
						variant="ghost"
						size="sm"
						onClick={handleCancel}
						disabled={cancelling}
					>
						{cancelling ? "Cancelling…" : "Cancel"}
					</Button>
				) : null}
				<Button
					variant="outline"
					size="sm"
					onClick={handleInstallApp}
					disabled={installingApp}
				>
					{installingApp ? (
						<>
							<Loader2 className="mr-1.5 size-3.5 animate-spin" />
							Installing...
						</>
					) : (
						"Install Update"
					)}
				</Button>
			</div>
		</SettingsRow>
	);
}

function AppInstallProgressCard({
	state,
	completedCount,
	logsExpanded,
	onToggleLogs,
}: {
	state: InstallUiState;
	completedCount: number;
	logsExpanded: boolean;
	onToggleLogs: () => void;
}) {
	const heading =
		state.phase === "running"
			? currentStepLabel(state)
			: state.phase === "succeeded"
				? "Update installed"
				: state.phase === "cancelled"
					? "Update cancelled"
					: "Update failed";

	return (
		<div className="mt-3 rounded-lg border border-border/55 bg-card/70 p-3 text-[12px] shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 font-medium text-foreground">
						{state.phase === "running" ? (
							<Loader2 className="size-3.5 animate-spin text-app-info" />
						) : state.phase === "succeeded" ? (
							<Check className="size-3.5 text-app-success" />
						) : (
							<X className="size-3.5 text-app-destructive" />
						)}
						<span>{heading}</span>
					</div>
					<div className="mt-1 text-muted-foreground">
						{completedCount} of {state.steps.length} steps complete
						{state.repoRoot ? ` · ${state.repoRoot}` : ""}
					</div>
					{state.latestOutput ? (
						<div className="mt-1 max-w-xl truncate font-mono text-[11px] text-muted-foreground/85">
							{state.latestOutput}
						</div>
					) : null}
				</div>
				{state.result ? (
					<div className="shrink-0 text-right text-muted-foreground">
						{state.result.version ? <div>v{state.result.version}</div> : null}
						{state.result.size ? <div>{state.result.size}</div> : null}
					</div>
				) : null}
			</div>

			<div className="mt-3 grid gap-1.5 sm:grid-cols-2">
				{state.steps.map((step) => (
					<div
						key={step.id}
						className={cn(
							"rounded-md border px-2 py-1.5",
							stepStatusClass(step.status),
						)}
					>
						<div className="flex items-center gap-1.5">
							{step.status === "running" ? (
								<Loader2 className="size-3 animate-spin" />
							) : step.status === "ok" ? (
								<Check className="size-3" />
							) : step.status === "error" ? (
								<X className="size-3" />
							) : null}
							<span className="truncate">{step.label}</span>
						</div>
						{step.message ? (
							<div className="mt-0.5 truncate opacity-80">{step.message}</div>
						) : null}
					</div>
				))}
			</div>

			{state.result?.signingWarning ? (
				<SettingsNotice tone="warn">
					{state.result.signingWarning}
				</SettingsNotice>
			) : null}

			<button
				type="button"
				className="mt-3 flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground"
				onClick={onToggleLogs}
			>
				{logsExpanded ? (
					<ChevronDown className="size-3" />
				) : (
					<ChevronRight className="size-3" />
				)}
				Diagnostics log
			</button>
			{logsExpanded ? (
				<pre className="mt-2 max-h-56 overflow-auto rounded-md bg-background/80 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
					{state.log.trim() || "No output yet."}
				</pre>
			) : null}
		</div>
	);
}
