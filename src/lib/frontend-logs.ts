export type FrontendLogLevel = "debug" | "error" | "info" | "log" | "warn";

export type FrontendLogEntry = {
	ts: string;
	level: FrontendLogLevel;
	message: string;
	args: unknown[];
	url?: string;
};

const MAX_FRONTEND_LOGS = 1000;
const entries: FrontendLogEntry[] = [];
let installed = false;

const LEVELS: FrontendLogLevel[] = ["debug", "error", "info", "log", "warn"];

export function installFrontendLogCapture(): void {
	if (installed) return;
	installed = true;

	for (const level of LEVELS) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			captureFrontendLog(level, args);
			original(...args);
		};
	}
}

export function getFrontendLogs(): FrontendLogEntry[] {
	return entries.map((entry) => ({
		...entry,
		args: entry.args.map(serializeConsoleArg),
	}));
}

function captureFrontendLog(level: FrontendLogLevel, args: unknown[]): void {
	entries.push({
		ts: new Date().toISOString(),
		level,
		message: args.map(formatConsoleArg).join(" "),
		args: args.map(serializeConsoleArg),
		url: window.location.href,
	});
	if (entries.length > MAX_FRONTEND_LOGS) {
		entries.splice(0, entries.length - MAX_FRONTEND_LOGS);
	}
}

function formatConsoleArg(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof Error) return `${value.name}: ${value.message}`;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function serializeConsoleArg(value: unknown): unknown {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
		};
	}
	if (typeof value === "undefined") return { type: "undefined" };
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		return String(value);
	}
}
