/**
 * Structured JSON logger for the sidecar process.
 *
 * - NDJSON to a single-file size ring: `sidecar.jsonl` (active) + `sidecar.jsonl.1`
 *   (previous segment). Disk use is bounded at 2 × MAX_BYTES; no dates, no
 *   cleanup pass.
 * - Dev stderr matches Rust tracing-subscriber's default format so both
 *   processes produce visually identical terminal output.
 * - stdout is NEVER touched — it is the exclusive JSON protocol channel.
 */

import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	renameSync,
	statSync,
	unlinkSync,
	writeSync,
} from "node:fs";

const MAX_BYTES = 10 * 1024 * 1024;

type Level = "debug" | "info" | "error";
const LEVELS: Record<Level, number> = { debug: 0, info: 1, error: 2 };

// ANSI codes matching Rust tracing-subscriber defaults.
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// Local RFC 3339 timestamp matching Rust's ChronoLocal default output.
// Pads ms → µs (6 fractional digits) and appends the UTC offset.
function localTs(): string {
	const d = new Date();
	const off = -d.getTimezoneOffset();
	const sign = off >= 0 ? "+" : "-";
	const abs = Math.abs(off);
	const oh = String(Math.floor(abs / 60)).padStart(2, "0");
	const om = String(abs % 60).padStart(2, "0");
	const pad = (n: number, w = 2) => String(n).padStart(w, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}000${sign}${oh}:${om}`;
}
const LEVEL_FMT: Record<Level, { label: string; color: string }> = {
	error: { label: "ERROR", color: "\x1b[31m" }, // red
	info: { label: " INFO", color: "\x1b[32m" }, // green (right-padded to 5)
	debug: { label: "DEBUG", color: "\x1b[34m" }, // blue
};

function fmtValue(v: unknown): string {
	if (typeof v === "string") return `"${v}"`;
	if (v === null || v === undefined) return String(v);
	if (typeof v === "object") return JSON.stringify(v);
	return String(v);
}

export function errorDetails(err: unknown): Record<string, unknown> {
	if (err instanceof Error) {
		const details: Record<string, unknown> = {
			error: err.message,
			errorName: err.name,
		};
		if (err.stack) {
			details.errorStack = err.stack;
		}
		if ("cause" in err && err.cause !== undefined) {
			details.errorCause = String(err.cause);
		}
		return details;
	}

	if (typeof err === "object" && err !== null) {
		try {
			return { error: JSON.stringify(err) };
		} catch {
			return { error: String(err) };
		}
	}

	return { error: String(err) };
}

type LoggerOptions = {
	maxBytes?: number;
	enableFileInTest?: boolean;
};

type SdkEventSummary = {
	type: string;
	method?: string;
	id?: string;
	itemType?: string;
	keyCount?: number;
};

export class Logger {
	private minLevel: number;
	private fd: number | undefined;
	private devStderr: boolean;
	private primaryPath: string | undefined;
	private backupPath: string | undefined;
	private bytes = 0;
	private maxBytes: number;
	private sdkFullEvents: boolean;

	constructor(options: LoggerOptions = {}) {
		this.maxBytes = options.maxBytes ?? MAX_BYTES;
		const envLevel = process.env.HELMOR_LOG?.toLowerCase();
		const level: Level =
			envLevel === "debug" || envLevel === "trace"
				? "debug"
				: envLevel === "error"
					? "error"
					: "info";
		this.minLevel = LEVELS[level];
		this.devStderr = level === "debug";
		this.sdkFullEvents = process.env.HELMOR_LOG_SDK_EVENTS === "1";

		// Skip file writes under `bun test`. This singleton is created on first
		// import, before any test-level env override can fire, so agent-spawned
		// shells inheriting HELMOR_LOG_DIR from a release helmor would otherwise
		// pollute ~/helmor/logs. Bun auto-sets NODE_ENV=test.
		const isTest =
			process.env.NODE_ENV === "test" || process.env.BUN_TEST === "1";
		const logDir = process.env.HELMOR_LOG_DIR;
		if (logDir && (!isTest || options.enableFileInTest)) {
			mkdirSync(logDir, { recursive: true });
			this.primaryPath = `${logDir}/sidecar.jsonl`;
			this.backupPath = `${logDir}/sidecar.jsonl.1`;
			this.bytes = fileSize(this.primaryPath);
			this.fd = openSync(this.primaryPath, "a");
		}
	}

	debug(msg: string, data?: Record<string, unknown>): void {
		this.emit("debug", msg, data);
	}
	info(msg: string, data?: Record<string, unknown>): void {
		this.emit("info", msg, data);
	}
	error(msg: string, data?: Record<string, unknown>): void {
		this.emit("error", msg, data);
	}

	/** Log SDK event summaries by default; full payloads require HELMOR_LOG_SDK_EVENTS=1. */
	sdkEvent(requestId: string, event: unknown): void {
		if (LEVELS.debug < this.minLevel) return;

		const ts = localTs();
		const summary = summarizeSdkEvent(event);
		const payload = this.sdkFullEvents
			? { ...summary, event }
			: { ...summary, eventSummary: summary };

		const line = `${JSON.stringify({ ts, level: "debug", source: "sidecar", msg: "sdk_event", requestId, ...payload })}\n`;
		this.writeLine(line);

		if (this.devStderr) {
			const { label, color } = LEVEL_FMT.debug;
			const json = JSON.stringify(this.sdkFullEvents ? event : summary);
			process.stderr.write(
				`${DIM}${localTs()}${RESET} ${color}${label}${RESET} ${DIM}sidecar:${RESET} [${requestId}] ← sdk ${json}\n`,
			);
		}
	}

	private emit(
		level: Level,
		msg: string,
		data?: Record<string, unknown>,
	): void {
		if (LEVELS[level] < this.minLevel) return;

		const ts = localTs();
		const line = `${JSON.stringify({ ts, level, source: "sidecar", msg, ...data })}\n`;
		this.writeLine(line);

		// Human-readable stderr matching Rust tracing format
		if (this.devStderr) {
			const { label, color } = LEVEL_FMT[level];
			let fields = "";
			if (data) {
				for (const [k, v] of Object.entries(data)) {
					fields += ` ${k}=${fmtValue(v)}`;
				}
			}
			process.stderr.write(
				`${DIM}${localTs()}${RESET} ${color}${label}${RESET} ${DIM}sidecar:${RESET} ${msg}${fields}\n`,
			);
		}
	}

	private writeLine(line: string): void {
		if (this.fd === undefined || !this.primaryPath || !this.backupPath) return;
		const len = Buffer.byteLength(line);
		if (this.bytes + len > this.maxBytes) {
			this.rotate();
		}
		if (this.fd === undefined) return;
		try {
			writeSync(this.fd, line);
			this.bytes += len;
		} catch {
			this.close();
		}
	}

	private rotate(): void {
		if (this.fd === undefined || !this.primaryPath || !this.backupPath) return;
		this.close();
		try {
			if (existsSync(this.backupPath)) unlinkSync(this.backupPath);
			if (existsSync(this.primaryPath)) {
				renameSync(this.primaryPath, this.backupPath);
			}
		} catch {
			// Best-effort: keep appending to whatever primary currently is.
		}
		try {
			this.fd = openSync(this.primaryPath, "a");
			this.bytes = fileSize(this.primaryPath);
		} catch {
			this.fd = undefined;
			this.bytes = 0;
		}
	}

	close(): void {
		if (this.fd === undefined) return;
		try {
			closeSync(this.fd);
		} catch {
			// Ignore close failures; logging must never bring down the sidecar.
		} finally {
			this.fd = undefined;
		}
	}
}

function summarizeSdkEvent(event: unknown): SdkEventSummary {
	if (!event || typeof event !== "object") {
		return { type: "unknown" };
	}

	const evt = event as Record<string, unknown>;
	const params =
		evt.params && typeof evt.params === "object"
			? (evt.params as Record<string, unknown>)
			: undefined;
	const item =
		params?.item && typeof params.item === "object"
			? (params.item as Record<string, unknown>)
			: undefined;
	const keyCount = Object.keys(evt).length;

	return {
		type: String(evt.type ?? params?.type ?? evt.method ?? "unknown"),
		method: typeof evt.method === "string" ? evt.method : undefined,
		id:
			typeof evt.id === "string" || typeof evt.id === "number"
				? String(evt.id)
				: undefined,
		itemType: typeof item?.type === "string" ? item.type : undefined,
		keyCount: keyCount > 0 ? keyCount : undefined,
	};
}

function fileSize(path: string): number {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
}

export const logger = new Logger();
