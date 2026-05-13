import {
	type AppInstallEvent,
	type AppInstallStepStatus,
	cancelHelmorAppInstall,
	type HelmorAppInstallResult,
	runHelmorAppInstall,
} from "@/lib/api";

export const INSTALL_STEPS = [
	{ id: "resolveRepo", label: "Find checkout" },
	{ id: "pullRepo", label: "Pull latest changes" },
	{ id: "buildApp", label: "Build app" },
	{ id: "inspectBuiltApp", label: "Inspect build" },
	{ id: "installApp", label: "Install app" },
	{ id: "signApp", label: "Sign app" },
	{ id: "verifyApp", label: "Verify app" },
	{ id: "verifyAppEntitlements", label: "Verify entitlements" },
	{ id: "inspectInstalledApp", label: "Read app details" },
	{ id: "dataInfo", label: "Check data mode" },
] as const;

export type InstallPhase =
	| "idle"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled";
export type UiStepStatus =
	| "pending"
	| "running"
	| AppInstallStepStatus
	| "error";

export type UiStep = {
	id: string;
	label: string;
	status: UiStepStatus;
	message: string | null;
};

export type InstallUiState = {
	phase: InstallPhase;
	repoRoot: string | null;
	installedAppPath: string | null;
	currentStepId: string | null;
	steps: UiStep[];
	log: string;
	latestOutput: string | null;
	error: string | null;
	result: HelmorAppInstallResult | null;
};

const MAX_LOG_CHARS = 60_000;
const MAX_OUTPUT_CHARS = 240;

type Listener = () => void;
type StateUpdater =
	| InstallUiState
	| ((previous: InstallUiState) => InstallUiState);

const listeners = new Set<Listener>();
let installState = initialState();
let currentInstall: Promise<HelmorAppInstallResult> | null = null;

export function getLocalAppInstallSnapshot() {
	return installState;
}

export function subscribeLocalAppInstall(listener: Listener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function startLocalAppInstall(
	onRestartRequired?: (result: HelmorAppInstallResult) => void,
) {
	if (currentInstall) return currentInstall;
	setInstallState({
		...initialState(),
		phase: "running",
		log: "Preparing Helmor update…\n",
	});
	currentInstall = runHelmorAppInstall(handleInstallEvent)
		.then((result) => {
			setInstallState((previous) => ({
				...previous,
				phase: "succeeded",
				currentStepId: null,
				latestOutput: null,
				result,
				error: null,
			}));
			onRestartRequired?.(result);
			return result;
		})
		.catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			setInstallState((previous) => ({
				...previous,
				phase: isCancelledMessage(message) ? "cancelled" : "failed",
				currentStepId: null,
				latestOutput: null,
				error: message,
			}));
			throw error;
		})
		.finally(() => {
			currentInstall = null;
		});
	return currentInstall;
}

export async function cancelLocalAppInstall() {
	return await cancelHelmorAppInstall();
}

export function resetLocalAppInstallStoreForTests() {
	installState = initialState();
	currentInstall = null;
	notifyListeners();
}

export function isCancelledMessage(message: string) {
	return /\bcancell?ed\b/i.test(message);
}

function initialSteps(): UiStep[] {
	return INSTALL_STEPS.map((step) => ({
		...step,
		status: "pending",
		message: null,
	}));
}

function initialState(): InstallUiState {
	return {
		phase: "idle",
		repoRoot: null,
		installedAppPath: null,
		currentStepId: null,
		steps: initialSteps(),
		log: "",
		latestOutput: null,
		error: null,
		result: null,
	};
}

function handleInstallEvent(event: AppInstallEvent) {
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
					latestOutput: null,
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
					latestOutput: latestOutputLine(event.data) ?? previous.latestOutput,
					log: appendLog(previous.log, event.data),
				};
			case "stepFinished":
				return {
					...previous,
					currentStepId:
						previous.currentStepId === event.stepId
							? null
							: previous.currentStepId,
					latestOutput:
						previous.currentStepId === event.stepId
							? null
							: previous.latestOutput,
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
					latestOutput: null,
					result: event.result,
					error: null,
				};
			case "error":
				return {
					...previous,
					phase: isCancelledMessage(event.message) ? "cancelled" : "failed",
					currentStepId: null,
					latestOutput: null,
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
}

function setInstallState(updater: StateUpdater) {
	installState =
		typeof updater === "function" ? updater(installState) : updater;
	notifyListeners();
}

function notifyListeners() {
	for (const listener of listeners) listener();
}

function appendLog(log: string, data: string) {
	const next = `${log}${data}`;
	return next.length > MAX_LOG_CHARS ? next.slice(-MAX_LOG_CHARS) : next;
}

function latestOutputLine(data: string) {
	const lines = data.split(/\r?\n/);
	let line: string | null = null;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const trimmed = lines[index]?.trim();
		if (trimmed) {
			line = trimmed;
			break;
		}
	}
	if (!line) return null;
	return line.length > MAX_OUTPUT_CHARS
		? `${line.slice(0, MAX_OUTPUT_CHARS - 1)}…`
		: line;
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
