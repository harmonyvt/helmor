// Full-screen diagram view. Renders the workspace import graph using
// @xyflow/react. Activated from the inspector "View as graph" button
// and mounted by App.tsx when `workspaceViewMode === "diagram"`.

import "@xyflow/react/dist/style.css";

import {
	Background,
	BackgroundVariant,
	Controls,
	MiniMap,
	type NodeMouseHandler,
	ReactFlow,
	ReactFlowProvider,
	type Edge as XyEdge,
	type Node as XyNode,
} from "@xyflow/react";
import { Network } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { DiffOpenOptions } from "@/lib/editor-session";
import { DiagramToolbar } from "./controls/diagram-toolbar";
import { ProgressOverlay } from "./controls/progress-overlay";
import { useCodeGraph } from "./hooks/use-code-graph";
import { type LayoutDirection, layoutGraph } from "./layout/apply-layout";
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

	const { rfNodes, rfEdges } = useMemo<{
		rfNodes: XyNode[];
		rfEdges: XyEdge[];
	}>(() => {
		if (!subgraph) return { rfNodes: [], rfEdges: [] };
		const laid = layoutGraph(subgraph.nodes, subgraph.edges, direction);
		return { rfNodes: laid.nodes, rfEdges: laid.edges };
	}, [subgraph, direction]);

	const onNodeClick = useCallback<NodeMouseHandler>(
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

	const totalNodes = graph?.nodes.length ?? 0;
	const visibleNodes = subgraph?.nodes.length ?? 0;
	const showOverlay = isLoading || (isFetching && !graph);

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
					minZoom={0.1}
					maxZoom={2}
				>
					<Background variant={BackgroundVariant.Dots} gap={20} size={1} />
					<MiniMap pannable zoomable className="!bg-card !border-border" />
					<Controls className="!bg-card !border-border" />
				</ReactFlow>
				{showOverlay && <ProgressOverlay progress={progress} />}
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
