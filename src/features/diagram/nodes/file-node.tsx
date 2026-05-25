// Custom xyflow node: shows the file's basename, a language pill, a git
// status badge (M/A/D) if the file is part of the diff, and ±line counts.
// Renders "selected / connected / dimmed / default" states so the
// diagram surface can highlight a clicked file and everything that
// imports it (or that it imports).

import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { CodeGraphNode } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { NodeSelectionState } from "../layout/selection";

export type FileNodeData = {
	node: CodeGraphNode;
	selectionState: NodeSelectionState;
};

const STATUS_TOKEN: Record<NonNullable<CodeGraphNode["status"]>, string> = {
	M: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border-yellow-500/40",
	A: "bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/40",
	D: "bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40",
};

const LANG_TOKEN: Record<CodeGraphNode["language"], string> = {
	typescript: "TS",
	tsx: "TSX",
	javascript: "JS",
	jsx: "JSX",
	rust: "RS",
	python: "PY",
};

export function FileNode({ data }: NodeProps) {
	const { node, selectionState } = data as FileNodeData;
	const status = node.status;
	const isChanged = status !== null;
	const selected = selectionState === "selected";
	const connected = selectionState === "connected";
	const dimmed = selectionState === "dimmed";

	return (
		<div
			className={cn(
				"min-w-[180px] rounded-md border bg-card px-3 py-2 text-left shadow-sm transition-[opacity,border-color,box-shadow] duration-150",
				selected &&
					"border-blue-500 shadow-lg ring-2 ring-blue-500/60 ring-offset-1 ring-offset-background",
				connected && "border-blue-400/70 shadow-md",
				dimmed && "border-border/60 opacity-30",
				!selected && !connected && !dimmed && "border-border",
				isChanged && !dimmed && "ring-2 ring-yellow-500/30",
			)}
		>
			<Handle
				type="target"
				position={Position.Left}
				className="!size-1.5 !border-0 !bg-muted-foreground/60"
			/>
			<div className="flex items-center justify-between gap-2">
				<span
					className="truncate text-[12px] font-medium text-foreground"
					title={node.path}
				>
					{node.name}
				</span>
				<span className="rounded bg-muted px-1 py-px text-[10px] font-semibold uppercase text-muted-foreground">
					{LANG_TOKEN[node.language]}
				</span>
			</div>
			<div
				className="mt-1 truncate text-[10px] text-muted-foreground"
				title={node.path}
			>
				{node.path}
			</div>
			<div className="mt-1.5 flex items-center gap-2 text-[10px]">
				{status && (
					<span
						className={cn(
							"rounded border px-1 py-px font-semibold",
							STATUS_TOKEN[status],
						)}
					>
						{status}
					</span>
				)}
				{(node.insertions > 0 || node.deletions > 0) && (
					<span className="font-mono text-muted-foreground">
						<span className="text-green-600 dark:text-green-400">
							+{node.insertions}
						</span>
						<span className="ml-1 text-red-600 dark:text-red-400">
							-{node.deletions}
						</span>
					</span>
				)}
				{node.fanIn + node.fanOut > 0 && (
					<span
						className="ml-auto text-muted-foreground"
						title={`${node.fanIn} in / ${node.fanOut} out`}
					>
						↓{node.fanIn} ↑{node.fanOut}
					</span>
				)}
			</div>
			<Handle
				type="source"
				position={Position.Right}
				className="!size-1.5 !border-0 !bg-muted-foreground/60"
			/>
		</div>
	);
}
