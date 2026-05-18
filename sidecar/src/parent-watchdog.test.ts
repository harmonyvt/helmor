import { describe, expect, it } from "bun:test";
import { shouldExitForMissingParent } from "./parent-watchdog";

describe("parent watchdog", () => {
	it("stays disabled without a valid parent pid", () => {
		expect(shouldExitForMissingParent(undefined)).toBe(false);
		expect(shouldExitForMissingParent("not-a-pid")).toBe(false);
		expect(shouldExitForMissingParent("0")).toBe(false);
	});

	it("exits when launchd has adopted the sidecar", () => {
		expect(
			shouldExitForMissingParent(
				"123",
				() => 1,
				() => true,
			),
		).toBe(true);
	});

	it("exits when the configured parent pid is gone", () => {
		expect(
			shouldExitForMissingParent(
				"123",
				() => 456,
				() => false,
			),
		).toBe(true);
	});

	it("keeps running while the configured parent is alive", () => {
		expect(
			shouldExitForMissingParent(
				"123",
				() => 456,
				() => true,
			),
		).toBe(false);
	});
});
