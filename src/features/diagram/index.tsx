// Full-screen diagram view. Renders the workspace import graph using
// @xyflow/react. Activated from the inspector "View as graph" button
// and mounted by App.tsx when `workspaceViewMode === "diagram"`.
//
// Interaction model:
//   - Single click: select a file and highlight its 1-hop connections
//     (everything it imports + everything that imports it). All other
//     nodes/edges dim so the dependency picture pops.
//   - Double click: open the Monaco diff for that file (reuses the
//     existing editor view-mode flow).
//   - Click empty canvas / Esc: clear selection.

import "@xyflow/react/dist/style.css";

import {
	Background,
	BackgroundVariant,
	Controls,
	MiniMap,
	type NodeMouseHandler,
	ReactFlow,
	ReactFlowProvider,
} from "@xyflow/react";
import { FileCode2, Network, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CodeGraphNode } from "@/lib/api";
import type { DiffOpenOptions } from "@/lib/editor-session";
import { cn } from "@/lib/utils";
import { DiagramToolbar } from "./controls/diagram-toolbar";
import { ProgressOverlay } from "./controls/progress-overlay";
import { useCodeGraph } from "./hooks/use-code-graph";
import {
	applySelectionStyling,
	type LayoutDirection,
	layoutGraph,
} from "./layout/apply-layout";
import { computeSelectionContext } from "./layout/selection";
import { FileNode, type FileNodeData } from "./nodes/file-node";

type WorkspaceDiagramSurfaceProps = {
	workspaceId: string | null;
	workspaceRootPath: string | null;
	onOpenEditorFile: (path: string, options?: DiffOpenOptions) => void;
	onExit: () => void;
};

const NODE_TYPES = { fileNode: FileNode } as const;

export function WorkspaceDiagramSurface(props: WorkspaceDiagramSurfaceProps) {
	return (
		<ReactFlowProvider>
			<DiagramInner {...props} />
		</ReactFlowProvider>
	);
}

function DiagramInner({
	workspaceId,
	workspaceRootPath,
	onOpenEditorFile,
	onExit,
}: WorkspaceDiagramSurfaceProps) {
	const {
		graph,
		subgraph,
		isLoading,
		isFetching,
		error,
		progress,
		refetch,
		filter,
		setFilter,
	} = useCodeGraph(workspaceId);
	const [direction, setDirection] = useState<LayoutDirection>("LR");
	const [selectedId, setSelectedId] = useState<string | null>(null);

	// Clear selection if the underlying graph changes out from under us.
	useEffect(() => {
		if (!subgraph || !selectedId) return;
		if (!subgraph.visibleNodeIds.has(selectedId)) {
			setSelectedId(null);
		}
	}, [subgraph, selectedId]);

	// Layout — expensive; only re-run on subgraph/direction change.
	const laid = useMemo(() => {
		if (!subgraph) return null;
		return layoutGraph(subgraph.nodes, subgraph.edges, direction);
	}, [subgraph, direction]);

	// Selection context — derived from subgraph edges + selectedId.
	const selectionCtx = useMemo(
		() => computeSelectionContext(selectedId, subgraph?.edges ?? []),
		[selectedId, subgraph],
	);

	// Cheap re-style pass; doesn't move nodes around.
	const { rfNodes, rfEdges } = useMemo(() => {
		if (!laid) return { rfNodes: [], rfEdges: [] };
		const styled = applySelectionStyling(laid, selectionCtx);
		return { rfNodes: styled.nodes, rfEdges: styled.edges };
	}, [laid, selectionCtx]);

	const onNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
		setSelectedId((prev) => (prev === node.id ? null : node.id));
	}, []);

	const onPaneClick = useCallback(() => {
		setSelectedId(null);
	}, []);

	const onNodeDoubleClick = useCallback<NodeMouseHandler>(
		(_event, node) => {
			const data = node.data as FileNodeData;
			const file = data?.node;
			if (!file || file.isExternal) return;
			const status = file.status ?? "M";
			onOpenEditorFile(file.path, {
				fileStatus: status,
				workspaceRootPath,
				workspaceId,
			});
		},
		[onOpenEditorFile, workspaceId, workspaceRootPath],
	);

	// Escape clears selection.
	useEffect(() => {
		function handler(event: KeyboardEvent) {
			if (event.key === "Escape" && selectedId !== null) {
				event.preventDefault();
				setSelectedId(null);
			}
		}
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [selectedId]);

	const totalNodes = graph?.nodes.length ?? 0;
	const visibleNodes = subgraph?.nodes.length ?? 0;
	const showOverlay = isLoading || (isFetching && !graph);

	const selectedNode: CodeGraphNode | null = useMemo(() => {
		if (!selectedId || !subgraph) return null;
		return subgraph.nodes.find((n) => n.id === selectedId) ?? null;
	}, [selectedId, subgraph]);

	const handleOpenSelectedDiff = useCallback(() => {
		if (!selectedNode || selectedNode.isExternal) return;
		const status = selectedNode.status ?? "M";
		onOpenEditorFile(selectedNode.path, {
			fileStatus: status,
			workspaceRootPath,
			workspaceId,
		});
	}, [onOpenEditorFile, selectedNode, workspaceId, workspaceRootPath]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<DiagramToolbar
				filter={filter}
				onFilterChange={setFilter}
				direction={direction}
				onDirectionChange={setDirection}
				nodeCount={visibleNodes}
				totalNodes={totalNodes}
				stats={graph?.stats ?? null}
				isFetching={isFetching}
				onRefresh={refetch}
				onExit={onExit}
			/>
			<div className="relative min-h-0 flex-1">
				{error && (
					<div className="absolute inset-x-0 top-0 z-10 border-b border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
						{error.message}
					</div>
				)}
				{graph && visibleNodes === 0 && !showOverlay && (
					<EmptyState filterMode={filter.mode} totalNodes={totalNodes} />
				)}
				{visibleNodes > 800 && (
					<div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-1.5 text-[11px] text-yellow-700 dark:text-yellow-300">
						{visibleNodes} nodes laid out — consider narrowing the filter.
					</div>
				)}
				<ReactFlow
					nodes={rfNodes}
					edges={rfEdges}
					nodeTypes={NODE_TYPES}
					fitView
					fitViewOptions={{ padding: 0.1, maxZoom: 1.4 }}
					proOptions={{ hideAttribution: true }}
					onNodeClick={onNodeClick}
					onNodeDoubleClick={onNodeDoubleClick}
					onPaneClick={onPaneClick}
					minZoom={0.1}
					maxZoom={2}
				>
					<Background variant={BackgroundVariant.Dots} gap={20} size={1} />
					<MiniMap pannable zoomable className="!bg-card !border-border" />
					<Controls className="!bg-card !border-border" />
				</ReactFlow>
				{selectedNode && (
					<SelectionCard
						node={selectedNode}
						inbound={selectionCtx.inboundCount}
						outbound={selectionCtx.outboundCount}
						onClear={() => setSelectedId(null)}
						onOpenDiff={handleOpenSelectedDiff}
					/>
				)}
				{showOverlay && <ProgressOverlay progress={progress} />}
			</div>
			<div className="border-t border-border bg-muted/10 px-3 py-1 text-[10px] text-muted-foreground">
				Click a file to highlight its imports and importers · Double-click to
				open the diff · Esc to clear
			</div>
		</div>
	);
}

function SelectionCard({
	node,
	inbound,
	outbound,
	onClear,
	onOpenDiff,
}: {
	node: CodeGraphNode;
	inbound: number;
	outbound: number;
	onClear: () => void;
	onOpenDiff: () => void;
}) {
	return (
		<div
			className={cn(
				"absolute bottom-3 left-3 z-10 max-w-[420px] rounded-md border border-border bg-card p-3 shadow-md",
				"text-[12px]",
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div
						className="truncate font-medium text-foreground"
						title={node.path}
					>
						{node.name}
					</div>
					<div
						className="truncate text-[11px] text-muted-foreground"
						title={node.path}
					>
						{node.path}
					</div>
				</div>
				<button
					type="button"
					onClick={onClear}
					aria-label="Clear selection"
					className="cursor-pointer text-muted-foreground hover:text-foreground"
				>
					<X className="size-3.5" />
				</button>
			</div>
			<div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
				<span>
					<span className="font-medium text-foreground">{inbound}</span>{" "}
					importer{inbound === 1 ? "" : "s"}
				</span>
				<span>
					<span className="font-medium text-foreground">{outbound}</span> import
					{outbound === 1 ? "" : "s"}
				</span>
				{node.status && (
					<span className="rounded border border-yellow-500/40 bg-yellow-500/10 px-1 py-px text-[10px] font-semibold text-yellow-700 dark:text-yellow-300">
						{node.status}
					</span>
				)}
			</div>
			<div className="mt-2">
				<Button
					size="xs"
					variant="outline"
					onClick={onOpenDiff}
					disabled={node.isExternal}
					className="gap-1.5"
				>
					<FileCode2 className="size-3" />
					Open diff
				</Button>
			</div>
		</div>
	);
}

function EmptyState({
	filterMode,
	totalNodes,
}: {
	filterMode: "changedOnly" | "all" | "focus";
	totalNodes: number;
}) {
	const message =
		filterMode === "changedOnly"
			? totalNodes === 0
				? "No source files indexed yet."
				: "No changed files on this branch. Switch to All to see the full graph."
			: "Nothing matches the current filter.";
	return (
		<div className="pointer-events-none flex h-full items-center justify-center text-[12px] text-muted-foreground">
			<div className="flex flex-col items-center gap-2">
				<Network className="size-6 opacity-40" />
				<span>{message}</span>
			</div>
		</div>
	);
}
