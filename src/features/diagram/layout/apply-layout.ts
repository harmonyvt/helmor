// dagre-based auto-layout. Synchronous because the default subgraph
// (changed + 1 hop) is small. If users opt into the full-graph view we
// surface a warning and recommend filtering down — running dagre on
// thousands of nodes is the v2 worker-based job.
//
// Layout is split from selection-styling so re-running dagre is
// expensive (changes subgraph or direction) while restyling on click
// is cheap (recolours nodes/edges without moving them).

import type { Edge as XyEdge, Node as XyNode } from "@xyflow/react";
import dagre from "dagre";
import type { CodeGraphEdge, CodeGraphNode } from "@/lib/api";
import { edgeStateFor, nodeStateFor, type SelectionContext } from "./selection";

export type LayoutDirection = "LR" | "TB";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;

export type LaidOutGraph = {
	nodes: XyNode[];
	edges: XyEdge[];
	rawEdges: CodeGraphEdge[];
};

export function layoutGraph(
	nodes: CodeGraphNode[],
	edges: CodeGraphEdge[],
	direction: LayoutDirection,
): LaidOutGraph {
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
			data: { node, selectionState: "default" },
			draggable: false,
		};
	});

	const xyEdges: XyEdge[] = edges.map((edge) => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
		type: "default",
		animated: edge.kind === "dynamic",
		data: { kind: edge.kind },
	}));

	return { nodes: xyNodes, edges: xyEdges, rawEdges: edges };
}

/// Apply selection state on top of a laid-out graph. Cheap — pure data
/// mutation on new arrays, no dagre re-run.
export function applySelectionStyling(
	laid: LaidOutGraph,
	selection: SelectionContext,
): { nodes: XyNode[]; edges: XyEdge[] } {
	const nodes = laid.nodes.map((node) => ({
		...node,
		data: {
			...node.data,
			selectionState: nodeStateFor(node.id, selection),
		},
	}));

	const edges = laid.edges.map((edge, i) => {
		const raw = laid.rawEdges[i];
		const state = raw ? edgeStateFor(raw, selection) : "default";
		const isHighlighted = state === "connected";
		const isDimmed = state === "dimmed";
		const baseDashed = raw?.kind === "typeOnly";
		return {
			...edge,
			animated: raw?.kind === "dynamic" || isHighlighted,
			style: {
				strokeOpacity: isDimmed ? 0.15 : isHighlighted ? 1 : 0.7,
				strokeWidth: isHighlighted ? 2 : 1,
				...(baseDashed ? { strokeDasharray: "4 4" } : {}),
				...(isHighlighted ? { stroke: "var(--color-primary)" } : {}),
			},
			zIndex: isHighlighted ? 1 : 0,
		};
	});

	return { nodes, edges };
}
