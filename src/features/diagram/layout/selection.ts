// Pure helpers for the click-to-highlight interaction. Given a selected
// node id and the current edge set, compute which other nodes are
// "connected" (incoming + outgoing 1-hop). The diagram surface uses
// this to dim everything else so the user can trace dependencies at a
// glance.

import type { CodeGraphEdge } from "@/lib/api";

export type NodeSelectionState =
	| "selected"
	| "connected"
	| "dimmed"
	| "default";

export type SelectionContext = {
	selectedId: string | null;
	connectedIds: Set<string>;
	inboundCount: number;
	outboundCount: number;
};

export function computeSelectionContext(
	selectedId: string | null,
	edges: CodeGraphEdge[],
): SelectionContext {
	if (selectedId === null) {
		return {
			selectedId: null,
			connectedIds: new Set(),
			inboundCount: 0,
			outboundCount: 0,
		};
	}
	const connected = new Set<string>();
	let inbound = 0;
	let outbound = 0;
	for (const edge of edges) {
		if (edge.source === selectedId) {
			connected.add(edge.target);
			outbound += 1;
		}
		if (edge.target === selectedId) {
			connected.add(edge.source);
			inbound += 1;
		}
	}
	return {
		selectedId,
		connectedIds: connected,
		inboundCount: inbound,
		outboundCount: outbound,
	};
}

export function nodeStateFor(
	nodeId: string,
	ctx: SelectionContext,
): NodeSelectionState {
	if (ctx.selectedId === null) return "default";
	if (nodeId === ctx.selectedId) return "selected";
	if (ctx.connectedIds.has(nodeId)) return "connected";
	return "dimmed";
}

export function edgeStateFor(
	edge: CodeGraphEdge,
	ctx: SelectionContext,
): NodeSelectionState {
	if (ctx.selectedId === null) return "default";
	if (edge.source === ctx.selectedId || edge.target === ctx.selectedId) {
		return "connected";
	}
	return "dimmed";
}
