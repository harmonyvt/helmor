import {
	Check,
	ChevronDown,
	ChevronRight,
	Download,
	Loader2,
	X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type AppInstallEvent,
	type AppInstallStepStatus,
	cancelHelmorAppInstall,
	type HelmorAppInstallResult,
	restartApp,
	runHelmorAppInstall,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useWorkspaceToast } from "@/lib/workspace-toast-context";
import { SettingsNotice, SettingsRow } from "../components/settings-row";

const INSTALL_STEPS = [
	{ id: "resolveRepo", label: "Find checkout" },
	{ id: "pullRepo", label: "Pull latest changes" },
	{ id: "buildApp", label: "Build app" },
	{ id: "inspectBuiltApp", label: "Inspect build" },
	{ id: "installApp", label: "Install app" },
	{ id: "signApp", label: "Sign app" },
	{ id: "verifyApp", label: "Verify app" },
	{ id: "inspectInstalledApp", label: "Read app details" },
	{ id: "dataInfo", label: "Check data mode" },
] as const;

type InstallPhase = "idle" | "running" | "succeeded" | "failed" | "cancelled";
type UiStepStatus = "pending" | "running" | AppInstallStepStatus | "error";

type UiStep = {
	id: string;
	label: string;
	status: UiStepStatus;
	message: string | null;
};

type InstallUiState = {
	phase: InstallPhase;
	repoRoot: string | null;
	installedAppPath: string | null;
	currentStepId: string | null;
	steps: UiStep[];
	log: string;
	error: string | null;
	result: HelmorAppInstallResult | null;
};

const initialSteps = (): UiStep[] =>
	INSTALL_STEPS.map((step) => ({
		...step,
		status: "pending",
		message: null,
	}));

const initialState = (): InstallUiState => ({
	phase: "idle",
	repoRoot: null,
	installedAppPath: null,
	currentStepId: null,
	steps: initialSteps(),
	log: "",
	error: null,
	result: null,
});

const MAX_LOG_CHARS = 60_000;

function appendLog(log: string, data: string) {
	const next = `${log}${data}`;
	return next.length > MAX_LOG_CHARS ? next.slice(-MAX_LOG_CHARS) : next;
}

function updateStep(
	steps: UiStep[],
	stepId: string,
	patch: Partial<UiStep>,
	fallbackLabel?: string,
) {
	let found = false;
	const next = steps.map((step) => {
		if (step.id !== stepId) return step;
		found = true;
		return {
			...step,
			...(fallbackLabel ? { label: fallbackLabel } : {}),
			...patch,
		};
	});
	if (found) return next;
	return [
		...next,
		{
			id: stepId,
			label: fallbackLabel ?? stepId,
			status: patch.status ?? "pending",
			message: patch.message ?? null,
		},
	];
}

function stepStatusClass(status: UiStepStatus) {
	switch (status) {
		case "ok":
			return "border-green-400/30 bg-green-400/10 text-green-300";
		case "warning":
			return "border-amber-400/30 bg-amber-400/10 text-amber-300";
		case "skipped":
			return "border-muted-foreground/20 bg-muted/40 text-muted-foreground";
		case "error":
			return "border-destructive/35 bg-destructive/10 text-destructive";
		case "running":
			return "border-sky-400/30 bg-sky-400/10 text-sky-300";
		default:
			return "border-border/50 bg-muted/20 text-muted-foreground";
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
	const [installState, setInstallState] =
		useState<InstallUiState>(initialState);
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

	const handleInstallEvent = useCallback((event: AppInstallEvent) => {
		setInstallState((previous) => {
			switch (event.type) {
				case "started":
					return {
						...previous,
						repoRoot: event.repoRoot,
						installedAppPath: event.installedAppPath,
					};
				case "stepStarted":
					return {
						...previous,
						currentStepId: event.stepId,
						steps: updateStep(
							previous.steps,
							event.stepId,
							{ status: "running", message: null },
							event.label,
						),
						log: appendLog(previous.log, `\n==> ${event.label}\n`),
					};
				case "output":
					return {
						...previous,
						log: appendLog(previous.log, event.data),
					};
				case "stepFinished":
					return {
						...previous,
						currentStepId:
							previous.currentStepId === event.stepId
								? null
								: previous.currentStepId,
						steps: updateStep(previous.steps, event.stepId, {
							status: event.status,
							message: event.message,
						}),
					};
				case "completed":
					return {
						...previous,
						phase: "succeeded",
						currentStepId: null,
						result: event.result,
						error: null,
					};
				case "error":
					return {
						...previous,
						phase: event.message.toLowerCase().includes("cancelled")
							? "cancelled"
							: "failed",
						currentStepId: null,
						error: event.message,
						steps: event.stepId
							? updateStep(previous.steps, event.stepId, {
									status: "error",
									message: event.message,
								})
							: previous.steps,
					};
			}
		});
	}, []);

	const showRestartToast = useCallback(
		(result: HelmorAppInstallResult) => {
			if (!result.restartRequired) return;
			pushToast(
				"The new app has been installed. Restart Helmor to start using it.",
				"Restart required",
				"default",
				{
					persistent: true,
					action: {
						label: "Restart now",
						onClick: () => {
							void restartApp(true).catch((error) => {
								pushToast(
									error instanceof Error ? error.message : String(error),
									"Unable to restart Helmor",
									"destructive",
								);
							});
						},
					},
				},
			);
		},
		[pushToast],
	);

	const handleInstallApp = useCallback(async () => {
		setInstallState({
			...initialState(),
			phase: "running",
			log: "Preparing Helmor update…\n",
		});
		setLogsExpanded(false);
		try {
			const result = await runHelmorAppInstall(handleInstallEvent);
			setInstallState((previous) => ({
				...previous,
				phase: "succeeded",
				currentStepId: null,
				result,
				error: null,
			}));
			showRestartToast(result);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			setInstallState((previous) => ({
				...previous,
				phase: message.toLowerCase().includes("cancelled")
					? "cancelled"
					: "failed",
				currentStepId: null,
				error: message,
			}));
		}
	}, [handleInstallEvent, showRestartToast]);

	const handleCancel = useCallback(async () => {
		setCancelling(true);
		try {
			await cancelHelmorAppInstall();
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
							<Loader2 className="size-3.5 animate-spin text-sky-300" />
						) : state.phase === "succeeded" ? (
							<Check className="size-3.5 text-green-300" />
						) : (
							<X className="size-3.5 text-destructive" />
						)}
						<span>{heading}</span>
					</div>
					<div className="mt-1 text-muted-foreground">
						{completedCount} of {state.steps.length} steps complete
						{state.repoRoot ? ` · ${state.repoRoot}` : ""}
					</div>
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
