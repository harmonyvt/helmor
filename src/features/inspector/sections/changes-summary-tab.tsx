import { getMaterialFileIcon } from "file-extension-icon-js";
import { LoaderCircleIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import {
	buildWorkspaceChangeSummaryContext,
	type WorkspaceChangeSummaryContext,
} from "@/lib/api";
import type { InspectorFileItem } from "@/lib/editor-session";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<InspectorFileItem["status"], string> = {
	M: "text-yellow-500",
	A: "text-green-500",
	D: "text-red-500",
};

type SummaryState =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "requested" }
	| { kind: "error"; message: string };

type SummaryTabPanelProps = {
	workspaceRootPath: string | null;
	stagedChanges: InspectorFileItem[];
	unstagedChanges: InspectorFileItem[];
	committedChanges: InspectorFileItem[];
	onRequestAiSummary?: (context: WorkspaceChangeSummaryContext) => void;
};

export function SummaryTabPanel({
	workspaceRootPath,
	stagedChanges,
	unstagedChanges,
	committedChanges,
	onRequestAiSummary,
}: SummaryTabPanelProps) {
	const [state, setState] = useState<SummaryState>({ kind: "idle" });

	const allFiles = [...stagedChanges, ...unstagedChanges, ...committedChanges];
	const uniqueFileCount = new Set(allFiles.map((f) => f.path)).size;
	const totalInsertions = allFiles.reduce((sum, f) => sum + f.insertions, 0);
	const totalDeletions = allFiles.reduce((sum, f) => sum + f.deletions, 0);
	const hasChanges = uniqueFileCount > 0;

	const handleGenerate = async () => {
		if (!workspaceRootPath) return;
		setState({ kind: "loading" });
		try {
			const context =
				await buildWorkspaceChangeSummaryContext(workspaceRootPath);
			onRequestAiSummary?.(context);
			setState({ kind: "requested" });
		} catch (error) {
			setState({ kind: "error", message: String(error) });
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			{/* Stats bar */}
			<div className="flex shrink-0 items-center gap-2.5 border-b border-border/40 px-3 py-2 font-mono text-[11px]">
				{hasChanges ? (
					<>
						<span className="font-semibold text-foreground">
							{uniqueFileCount} file{uniqueFileCount !== 1 ? "s" : ""}
						</span>
						{totalInsertions > 0 && (
							<span className="text-chart-2">+{totalInsertions}</span>
						)}
						{totalDeletions > 0 && (
							<span className="text-destructive">−{totalDeletions}</span>
						)}
					</>
				) : (
					<span className="text-muted-foreground">No changes yet</span>
				)}
			</div>

			{/* File breakdown */}
			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11.5px]">
				{hasChanges ? (
					<div className="space-y-3">
						{stagedChanges.length > 0 && (
							<ScopeGroup label="Staged" files={stagedChanges} />
						)}
						{unstagedChanges.length > 0 && (
							<ScopeGroup label="Changes" files={unstagedChanges} />
						)}
						{committedChanges.length > 0 && (
							<ScopeGroup label="Remote" files={committedChanges} />
						)}
					</div>
				) : (
					<p className="py-1 text-[11px] text-muted-foreground">
						No changes on this branch yet.
					</p>
				)}
			</div>

			{/* AI summary action */}
			<div className="shrink-0 border-t border-border/60 px-3 py-2">
				<AiSummaryAction
					state={state}
					disabled={!hasChanges || !workspaceRootPath}
					onGenerate={() => void handleGenerate()}
					onReset={() => setState({ kind: "idle" })}
				/>
			</div>
		</div>
	);
}

function ScopeGroup({
	label,
	files,
}: {
	label: string;
	files: InspectorFileItem[];
}) {
	const scopeInsertions = files.reduce((s, f) => s + f.insertions, 0);
	const scopeDeletions = files.reduce((s, f) => s + f.deletions, 0);

	return (
		<div>
			<div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
				<span>{label}</span>
				<span className="opacity-40">·</span>
				<span>{files.length}</span>
				{scopeInsertions > 0 && (
					<span className="font-normal normal-case text-chart-2">
						+{scopeInsertions}
					</span>
				)}
				{scopeDeletions > 0 && (
					<span className="font-normal normal-case text-destructive">
						−{scopeDeletions}
					</span>
				)}
			</div>
			<div className="space-y-0.5 pl-1">
				{files.map((file) => (
					<SummaryFileRow key={file.path} file={file} />
				))}
			</div>
		</div>
	);
}

function SummaryFileRow({ file }: { file: InspectorFileItem }) {
	return (
		<div className="flex items-center gap-1.5 py-[1.5px] text-muted-foreground">
			<img
				src={getMaterialFileIcon(file.name)}
				alt=""
				className="size-4 shrink-0"
			/>
			<span className="min-w-0 flex-1 truncate">{file.name}</span>
			<span className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums">
				{file.insertions > 0 && (
					<span className="text-chart-2">+{file.insertions}</span>
				)}
				{file.deletions > 0 && (
					<span className="text-destructive">−{file.deletions}</span>
				)}
				<span
					className={cn(
						"inline-flex h-4 w-4 items-center justify-center text-[10px] font-semibold",
						STATUS_COLORS[file.status],
					)}
				>
					{file.status}
				</span>
			</span>
		</div>
	);
}

function AiSummaryAction({
	state,
	disabled,
	onGenerate,
	onReset,
}: {
	state: SummaryState;
	disabled: boolean;
	onGenerate: () => void;
	onReset: () => void;
}) {
	if (state.kind === "idle") {
		return (
			<button
				type="button"
				disabled={disabled}
				onClick={onGenerate}
				className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
			>
				<SparklesIcon className="size-3.5 shrink-0" strokeWidth={1.8} />
				<span>Generate AI Summary</span>
			</button>
		);
	}

	if (state.kind === "loading") {
		return (
			<div className="flex items-center gap-2 px-2 py-1.5 text-[11.5px] text-muted-foreground">
				<LoaderCircleIcon
					className="size-3.5 shrink-0 animate-spin"
					strokeWidth={1.8}
				/>
				<span>Building summary context…</span>
			</div>
		);
	}

	if (state.kind === "requested") {
		return (
			<div className="space-y-1.5 px-2 py-1">
				<div className="flex items-center gap-1.5 text-[11.5px]">
					<SparklesIcon
						className="size-3.5 shrink-0 text-chart-2"
						strokeWidth={1.8}
					/>
					<span className="font-medium text-foreground">Summary requested</span>
				</div>
				<p className="text-[11px] text-muted-foreground">
					A new session has been created with an AI summary of your changes.
				</p>
				<button
					type="button"
					onClick={onReset}
					className="cursor-pointer text-[10.5px] text-muted-foreground underline-offset-2 hover:underline"
				>
					Request again
				</button>
			</div>
		);
	}

	// error
	return (
		<div className="space-y-1.5 px-2 py-1">
			<p className="text-[11px] text-destructive">
				Failed to build summary context.
			</p>
			<button
				type="button"
				onClick={onReset}
				className="cursor-pointer text-[10.5px] text-muted-foreground underline-offset-2 hover:underline"
			>
				Try again
			</button>
		</div>
	);
}
