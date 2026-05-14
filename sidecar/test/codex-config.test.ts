import { describe, expect, test } from "bun:test";
import { injectGoalsFeature } from "../src/codex-config.js";

describe("codex config goals feature", () => {
	test("creates a features table for empty config", () => {
		expect(injectGoalsFeature(null)).toBe("[features]\ngoals = true\n");
	});

	test("appends features table when missing", () => {
		expect(injectGoalsFeature('model = "gpt-5.4"\n')).toBe(
			'model = "gpt-5.4"\n\n[features]\ngoals = true\n',
		);
	});

	test("updates false goals value in existing features table", () => {
		expect(
			injectGoalsFeature("[features]\nweb_search = true\ngoals = false\n"),
		).toBe("[features]\nweb_search = true\ngoals = true\n");
	});

	test("leaves config unchanged when goals already enabled", () => {
		expect(injectGoalsFeature("[features]\ngoals = true\n")).toBeNull();
	});
});
