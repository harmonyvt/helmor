import { describe, expect, it } from "vitest";
import type { CodeGraphNode } from "@/lib/api";
import {
	canOpenNodeDiff,
	canOpenNodeFile,
	resolveNodeEditorPath,
} from "./open-actions";

function node(overrides: Partial<CodeGraphNode> = {}): CodeGraphNode {
	return {
		id: "src/app.tsx",
		path: "src/app.tsx",
		name: "app.tsx",
		language: "tsx",
		isExternal: false,
		status: null,
		insertions: 0,
		deletions: 0,
		fanIn: 0,
		fanOut: 0,
		...overrides,
	};
}

describe("diagram open actions", () => {
	it("only offers diffs for changed local nodes", () => {
		expect(canOpenNodeDiff(node({ status: "M" }))).toBe(true);
		expect(canOpenNodeDiff(node({ status: null }))).toBe(false);
		expect(canOpenNodeDiff(node({ isExternal: true, status: "M" }))).toBe(
			false,
		);
	});

	it("offers file open for unchanged and modified files but not deleted files", () => {
		expect(canOpenNodeFile(node({ status: null }))).toBe(true);
		expect(canOpenNodeFile(node({ status: "M" }))).toBe(true);
		expect(canOpenNodeFile(node({ status: "D" }))).toBe(false);
		expect(canOpenNodeFile(node({ isExternal: true }))).toBe(false);
	});

	it("resolves graph-relative paths against the workspace root", () => {
		expect(resolveNodeEditorPath("src/app.tsx", "/repo/worktree")).toBe(
			"/repo/worktree/src/app.tsx",
		);
		expect(resolveNodeEditorPath("/repo/worktree/src/app.tsx", "/repo")).toBe(
			"/repo/worktree/src/app.tsx",
		);
	});
});
