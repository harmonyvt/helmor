// Pure helpers for filtering the full code graph into a renderable
// subgraph. Kept dependency-free so the worker can import it too.

import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "@/lib/api";

export type DiagramFilter = {
	mode: "changedOnly" | "all" | "focus";
	hopCount: number;
	focusNodeId: string | null;
	includeLanguages: Set<string>;
	searchQuery: string;
};

export type Subgraph = {
	nodes: CodeGraphNode[];
	edges: CodeGraphEdge[];
	visibleNodeIds: Set<string>;
	hasChanged: boolean;
};

export function defaultFilter(): DiagramFilter {
	return {
		mode: "changedOnly",
		hopCount: 1,
		focusNodeId: null,
		includeLanguages: new Set([
			"typescript",
			"tsx",
			"javascript",
			"jsx",
			"rust",
			"python",
		]),
		searchQuery: "",
	};
}

export function computeSubgraph(
	graph: CodeGraph,
	filter: DiagramFilter,
): Subgraph {
	const allowed = new Set<string>();
	const hasChangedAny = graph.nodes.some((node) => node.status !== null);

	const seeds = pickSeeds(graph, filter);
	for (const id of seeds) allowed.add(id);

	if (filter.mode !== "all" && filter.hopCount > 0) {
		expandNeighbours(allowed, graph.edges, filter.hopCount);
	}

	if (filter.mode === "all") {
		for (const node of graph.nodes) allowed.add(node.id);
	}

	const visible = graph.nodes.filter((node) => {
		if (!allowed.has(node.id)) return false;
		if (!filter.includeLanguages.has(node.language)) return false;
		if (filter.searchQuery.trim()) {
			const q = filter.searchQuery.trim().toLowerCase();
			if (!node.path.toLowerCase().includes(q)) return false;
		}
		return true;
	});

	const visibleSet = new Set(visible.map((n) => n.id));
	const edges = graph.edges.filter(
		(edge) => visibleSet.has(edge.source) && visibleSet.has(edge.target),
	);

	return {
		nodes: visible,
		edges,
		visibleNodeIds: visibleSet,
		hasChanged: hasChangedAny,
	};
}

function pickSeeds(graph: CodeGraph, filter: DiagramFilter): string[] {
	if (filter.mode === "focus" && filter.focusNodeId) {
		return [filter.focusNodeId];
	}
	if (filter.mode === "changedOnly") {
		return graph.nodes
			.filter((node) => node.status !== null)
			.map((node) => node.id);
	}
	// "all" — seeds are all nodes; expansion is a no-op.
	return graph.nodes.map((node) => node.id);
}

function expandNeighbours(
	allowed: Set<string>,
	edges: CodeGraphEdge[],
	hops: number,
): void {
	let frontier = new Set(allowed);
	for (let i = 0; i < hops; i++) {
		const next = new Set<string>();
		for (const edge of edges) {
			if (frontier.has(edge.source) && !allowed.has(edge.target)) {
				next.add(edge.target);
			}
			if (frontier.has(edge.target) && !allowed.has(edge.source)) {
				next.add(edge.source);
			}
		}
		if (next.size === 0) return;
		for (const id of next) allowed.add(id);
		frontier = next;
	}
}
