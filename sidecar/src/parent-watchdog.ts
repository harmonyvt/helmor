import { logger } from "./logger.js";

export type ParentWatchdogOptions = {
	parentPid?: string | undefined;
	intervalMs?: number;
	ppid?: () => number;
	isAlive?: (pid: number) => boolean;
	exit?: (code: number) => never;
};

export function shouldExitForMissingParent(
	parentPid: string | undefined,
	ppid: () => number = () => process.ppid,
	isAlive: (pid: number) => boolean = isPidAlive,
): boolean {
	const parsed = Number(parentPid);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		return false;
	}
	if (ppid() === 1) {
		return true;
	}
	return !isAlive(parsed);
}

export function startParentWatchdog(options: ParentWatchdogOptions = {}): void {
	const parentPid = options.parentPid ?? process.env.HELMOR_PARENT_PID;
	const intervalMs = options.intervalMs ?? 2000;
	const ppid = options.ppid ?? (() => process.ppid);
	const isAlive = options.isAlive ?? isPidAlive;
	const exit = options.exit ?? process.exit;

	const parsed = Number(parentPid);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		return;
	}

	const check = () => {
		if (!shouldExitForMissingParent(parentPid, ppid, isAlive)) return;
		logger.info("Parent process gone — sidecar exiting", {
			parentPid: parsed,
			ppid: ppid(),
		});
		exit(0);
	};

	check();
	const timer = setInterval(check, intervalMs);
	timer.unref?.();
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error && typeof error === "object" && "code" in error) {
			return error.code === "EPERM";
		}
		return false;
	}
}
