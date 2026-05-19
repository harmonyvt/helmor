import { describe, expect, it } from "bun:test";
import {
	PiNoProgressTimeoutError,
	PiProgressWatchdog,
	resolvePiAbortTimeoutMs,
	resolvePiNoProgressTimeoutMs,
} from "./pi-session-manager";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Pi progress watchdog", () => {
	it("uses the default timeout for missing or invalid env values", () => {
		expect(resolvePiNoProgressTimeoutMs()).toBe(90_000);
		expect(resolvePiNoProgressTimeoutMs("")).toBe(90_000);
		expect(resolvePiNoProgressTimeoutMs("not-a-number")).toBe(90_000);
		expect(resolvePiNoProgressTimeoutMs("-1")).toBe(90_000);
		expect(resolvePiNoProgressTimeoutMs("1234.9")).toBe(1234);

		expect(resolvePiAbortTimeoutMs()).toBe(1_500);
		expect(resolvePiAbortTimeoutMs("")).toBe(1_500);
		expect(resolvePiAbortTimeoutMs("not-a-number")).toBe(1_500);
		expect(resolvePiAbortTimeoutMs("-1")).toBe(1_500);
		expect(resolvePiAbortTimeoutMs("2500.9")).toBe(2500);
	});

	it("rejects when no progress is observed", async () => {
		const watchdog = new PiProgressWatchdog(5, "timed out");
		const result = watchdog.promise.catch((err) => err);

		watchdog.start();

		const err = await result;
		expect(err).toBeInstanceOf(PiNoProgressTimeoutError);
		expect(err.message).toBe("timed out");
	});

	it("resets the timeout when progress is observed", async () => {
		const watchdog = new PiProgressWatchdog(25, "timed out");
		let settled = false;
		const result = watchdog.promise.catch((err) => {
			settled = true;
			return err;
		});

		watchdog.start();
		await sleep(15);
		watchdog.markProgress();
		await sleep(15);
		expect(settled).toBe(false);

		const err = await result;
		expect(err).toBeInstanceOf(PiNoProgressTimeoutError);
	});

	it("stops without rejecting", async () => {
		const watchdog = new PiProgressWatchdog(5, "timed out");
		let settled = false;
		watchdog.promise.catch(() => {
			settled = true;
		});

		watchdog.start();
		watchdog.stop();
		await sleep(15);

		expect(settled).toBe(false);
	});
});
