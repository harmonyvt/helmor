// dagre-based auto-layout. Synchronous because the default subgraph
// (changed + 1 hop) is small. If users opt into the full-graph view we
// surface a warning and recommend filtering down — running dagre on
// thousands of nodes is the v2 worker-based job.

import type { Edge as XyEdge, Node as XyNode } from "@xyflow/react";
import dagre from "dagre";
import type { CodeGraphEdge, CodeGraphNode } from "@/lib/api";

export type LayoutDirection = "LR" | "TB";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;

export function layoutGraph(
	nodes: CodeGraphNode[],
	edges: CodeGraphEdge[],
	direction: LayoutDirection,
): { nodes: XyNode[]; edges: XyEdge[] } {
	const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
	g.setGraph({
		rankdir: direction,
		nodesep: 24,
		ranksep: 80,
		marginx: 20,
		marginy: 20,
	});
	g.setDefaultEdgeLabel(() => ({}));

	for (const node of nodes) {
		g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
	}
	for (const edge of edges) {
		if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
			g.setEdge(edge.source, edge.target);
		}
	}

	dagre.layout(g);

	const xyNodes: XyNode[] = nodes.map((node) => {
		const pos = g.node(node.id) as { x: number; y: number } | undefined;
		return {
			id: node.id,
			type: "fileNode",
			position: pos
				? { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 }
				: { x: 0, y: 0 },
			data: { node },
			draggable: false,
		};
	});

	const xyEdges: XyEdge[] = edges.map((edge) => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
		type: edgeTypeFor(edge.kind),
		animated: edge.kind === "dynamic",
		data: { kind: edge.kind },
		style:
			edge.kind === "typeOnly"
				? { strokeDasharray: "4 4", strokeOpacity: 0.6 }
				: undefined,
	}));

	return { nodes: xyNodes, edges: xyEdges };
}

function edgeTypeFor(_kind: CodeGraphEdge["kind"]): string {
	return "default";
}
