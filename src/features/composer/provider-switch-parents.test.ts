import { afterEach, describe, expect, it } from "vitest";
import {
	getProviderSwitchParent,
	storeProviderSwitchParent,
} from "./provider-switch-parents";

const STORAGE_KEY = "helmor-provider-switch-parents";
const PARENT = {
	parentSessionId: "session-1",
	fromProvider: "claude",
	toProvider: "codex",
} as const;

describe("provider switch parent storage", () => {
	afterEach(() => {
		localStorage.clear();
	});

	it("treats parsed non-map storage as empty before writing", () => {
		localStorage.setItem(STORAGE_KEY, '"1"');

		expect(() => {
			storeProviderSwitchParent("session-new", PARENT);
		}).not.toThrow();
		expect(getProviderSwitchParent("session-new")).toEqual(PARENT);
	});

	it("ignores parsed array storage before reading", () => {
		localStorage.setItem(STORAGE_KEY, "[]");

		expect(getProviderSwitchParent("session-new")).toBeNull();
	});
});
