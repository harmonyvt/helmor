import { afterEach, describe, expect, it } from "bun:test";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "./logger";

const originalLogDir = process.env.HELMOR_LOG_DIR;
const originalLog = process.env.HELMOR_LOG;
const originalSdkEvents = process.env.HELMOR_LOG_SDK_EVENTS;

let tempDir: string | undefined;
let logger: Logger | undefined;

afterEach(() => {
	logger?.close();
	logger = undefined;
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
	restoreEnv();
});

describe("Logger", () => {
	it("rotates synchronously without accumulating open backup streams", () => {
		tempDir = mkdtempSync(join(tmpdir(), "helmor-sidecar-logger-"));
		process.env.HELMOR_LOG_DIR = tempDir;
		process.env.HELMOR_LOG = "info";
		delete process.env.HELMOR_LOG_SDK_EVENTS;

		logger = new Logger({ enableFileInTest: true, maxBytes: 256 });

		for (let i = 0; i < 200; i += 1) {
			logger.info("rotation pressure", {
				i,
				payload: "x".repeat(80),
			});
		}

		logger.close();

		const entries = readdirSync(tempDir).sort();
		expect(entries).toEqual(["sidecar.jsonl", "sidecar.jsonl.1"]);
		expect(statSync(join(tempDir, "sidecar.jsonl")).size).toBeGreaterThan(0);
		expect(statSync(join(tempDir, "sidecar.jsonl.1")).size).toBeGreaterThan(0);
	});

	it("logs compact SDK summaries by default", () => {
		tempDir = mkdtempSync(join(tmpdir(), "helmor-sidecar-logger-"));
		process.env.HELMOR_LOG_DIR = tempDir;
		process.env.HELMOR_LOG = "debug";
		delete process.env.HELMOR_LOG_SDK_EVENTS;

		logger = new Logger({ enableFileInTest: true });
		logger.sdkEvent("req-1", {
			type: "event_msg",
			method: "turn.delta",
			secretPayload: "x".repeat(1000),
		});
		logger.close();

		const line = readFileSync(join(tempDir, "sidecar.jsonl"), "utf8").trim();
		const record = JSON.parse(line);

		expect(record).toMatchObject({
			msg: "sdk_event",
			requestId: "req-1",
			type: "event_msg",
			method: "turn.delta",
		});
		expect(record.event).toBeUndefined();
		expect(record.eventSummary).toMatchObject({
			type: "event_msg",
			method: "turn.delta",
		});
		expect(line).not.toContain("secretPayload");
	});

	it("logs full SDK payloads only when explicitly enabled", () => {
		tempDir = mkdtempSync(join(tmpdir(), "helmor-sidecar-logger-"));
		process.env.HELMOR_LOG_DIR = tempDir;
		process.env.HELMOR_LOG = "debug";
		process.env.HELMOR_LOG_SDK_EVENTS = "1";

		logger = new Logger({ enableFileInTest: true });
		logger.sdkEvent("req-2", {
			type: "event_msg",
			secretPayload: "kept-for-explicit-debugging",
		});
		logger.close();

		const line = readFileSync(join(tempDir, "sidecar.jsonl"), "utf8").trim();
		const record = JSON.parse(line);

		expect(record.event).toMatchObject({
			type: "event_msg",
			secretPayload: "kept-for-explicit-debugging",
		});
		expect(line).toContain("secretPayload");
	});
});

function restoreEnv(): void {
	restoreEnvValue("HELMOR_LOG_DIR", originalLogDir);
	restoreEnvValue("HELMOR_LOG", originalLog);
	restoreEnvValue("HELMOR_LOG_SDK_EVENTS", originalSdkEvents);
}

function restoreEnvValue(key: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
}
