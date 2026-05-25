import { describe, expect, it } from "vitest";
import type { CodeGraph } from "@/lib/api";
import { computeSubgraph, defaultFilter } from "./subgraph";

function graph(): CodeGraph {
	return {
		workspaceId: "w",
		generatedAtMs: 0,
		contentRevision: "rev",
		stats: {
			parsedFiles: 0,
			cachedFiles: 0,
			unresolvedSpecifiers: 0,
			externalPackages: 0,
		},
		nodes: [
			{
				id: "src/a.ts",
				path: "src/a.ts",
				name: "a.ts",
				language: "typescript",
				isExternal: false,
				status: "M",
				insertions: 1,
				deletions: 0,
				fanIn: 1,
				fanOut: 1,
			},
			{
				id: "src/b.ts",
				path: "src/b.ts",
				name: "b.ts",
				language: "typescript",
				isExternal: false,
				status: null,
				insertions: 0,
				deletions: 0,
				fanIn: 1,
				fanOut: 0,
			},
			{
				id: "src/unrelated.ts",
				path: "src/unrelated.ts",
				name: "unrelated.ts",
				language: "typescript",
				isExternal: false,
				status: null,
				insertions: 0,
				deletions: 0,
				fanIn: 0,
				fanOut: 0,
			},
		],
		edges: [
			{
				id: "e0",
				source: "src/a.ts",
				target: "src/b.ts",
				kind: "static",
			},
		],
	};
}

describe("computeSubgraph", () => {
	it("changedOnly + 1-hop seeds changed nodes and their neighbours", () => {
		const sub = computeSubgraph(graph(), {
			...defaultFilter(),
			mode: "changedOnly",
			hopCount: 1,
		});
		expect(sub.nodes.map((n) => n.id).sort()).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("changedOnly + 0-hop returns just the changed files", () => {
		const sub = computeSubgraph(graph(), {
			...defaultFilter(),
			mode: "changedOnly",
			hopCount: 0,
		});
		expect(sub.nodes.map((n) => n.id)).toEqual(["src/a.ts"]);
	});

	it("all mode returns every node", () => {
		const sub = computeSubgraph(graph(), {
			...defaultFilter(),
			mode: "all",
		});
		expect(sub.nodes.length).toBe(3);
	});

	it("language filter drops non-matching nodes", () => {
		const sub = computeSubgraph(graph(), {
			...defaultFilter(),
			mode: "all",
			includeLanguages: new Set(["rust"]),
		});
		expect(sub.nodes.length).toBe(0);
	});

	it("search restricts by path substring", () => {
		const sub = computeSubgraph(graph(), {
			...defaultFilter(),
			mode: "all",
			searchQuery: "unrelated",
		});
		expect(sub.nodes.map((n) => n.id)).toEqual(["src/unrelated.ts"]);
	});

	it("focus mode pins one seed and expands neighbours", () => {
		const sub = computeSubgraph(graph(), {
			...defaultFilter(),
			mode: "focus",
			focusNodeId: "src/b.ts",
			hopCount: 1,
		});
		expect(sub.nodes.map((n) => n.id).sort()).toEqual(["src/a.ts", "src/b.ts"]);
	});
});
