import type { CodeGraph, CodeGraphNode } from "@/lib/api";
import type { FileViewerGraphContext } from "@/lib/monaco-runtime";

export function buildViewerGraphContext(
	graph: CodeGraph | null,
	path: string,
): FileViewerGraphContext | null {
	if (!graph) {
		return null;
	}

	const normalizedPath = normalizePath(path);
	const node = graph.nodes.find(
		(candidate) =>
			normalizePath(candidate.path) === normalizedPath ||
			normalizedPath.endsWith(`/${normalizePath(candidate.path)}`),
	);
	if (!node || node.isExternal) {
		return null;
	}

	return {
		path: node.path,
		language: node.language,
		fanIn: node.fanIn,
		fanOut: node.fanOut,
		imports: connectedPaths(graph, node, "outbound"),
		importedBy: connectedPaths(graph, node, "inbound"),
		languageServicesLabel: languageServicesLabel(node),
	};
}

function connectedPaths(
	graph: CodeGraph,
	node: CodeGraphNode,
	direction: "inbound" | "outbound",
): string[] {
	const ids =
		direction === "outbound"
			? graph.edges
					.filter((edge) => edge.source === node.id)
					.map((edge) => edge.target)
			: graph.edges
					.filter((edge) => edge.target === node.id)
					.map((edge) => edge.source);
	const nodesById = new Map(
		graph.nodes.map((candidate) => [candidate.id, candidate]),
	);
	return ids
		.map((id) => nodesById.get(id)?.path ?? id)
		.filter((value, index, all) => all.indexOf(value) === index)
		.sort((a, b) => a.localeCompare(b));
}

function languageServicesLabel(node: CodeGraphNode): string {
	switch (node.language) {
		case "typescript":
		case "tsx":
		case "javascript":
		case "jsx":
			return "TypeScript worker hover, diagnostics, and references are available in Monaco.";
		case "rust":
			return "Rust graph metadata is available; rust-analyzer process support is the next backend step.";
		default:
			return "Graph metadata only.";
	}
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/");
}
