import { GitBranch, LoaderCircle, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceDetail, WorkspaceStatus } from "@/lib/api";
import { GOAL_LANES } from "./board-model";

export function WorkspaceDetailPanel({
	workspace: ws,
	parentWorkspaceTitle,
	onClose,
	onMove,
	onOpen,
}: {
	workspace: WorkspaceDetail;
	parentWorkspaceTitle: string;
	onClose: () => void;
	onMove: (lane: WorkspaceStatus) => void;
	onOpen?: () => void;
}) {
	const currentLane = GOAL_LANES.find((lane) => lane.id === ws.status);

	return (
		<div className="flex min-h-0 flex-col">
			<div className="flex shrink-0 items-center justify-between border-b border-border/70 px-4 py-3">
				<p className="truncate text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
					{parentWorkspaceTitle}
				</p>
				<div className="ml-2 flex shrink-0 items-center gap-1">
					{onOpen ? (
						<button
							type="button"
							onClick={onOpen}
							className="cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
							title="Open workspace"
						>
							Open ↗
						</button>
					) : null}
					<button
						type="button"
						onClick={onClose}
						className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
						aria-label="Close"
					>
						<X className="size-3.5" />
					</button>
				</div>
			</div>

			<div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
				<div>
					<h2 className="text-sm font-semibold leading-5 tracking-[-0.01em]">
						{ws.title}
					</h2>
					{ws.branch ? (
						<div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
							<GitBranch className="size-3 shrink-0" />
							<span className="truncate font-mono">{ws.branch}</span>
						</div>
					) : null}
				</div>

				<div className="space-y-2">
					<p className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
						Lane
					</p>
					<div className="flex items-center gap-2">
						{currentLane ? (
							<span
								className="size-2 shrink-0 rounded-full"
								style={{ backgroundColor: currentLane.color }}
								aria-hidden="true"
							/>
						) : null}
						<span className="text-sm">{currentLane?.label ?? ws.status}</span>
					</div>
					<div className="flex flex-wrap gap-1.5 pt-0.5">
						{GOAL_LANES.filter((lane) => lane.id !== ws.status).map((lane) => (
							<button
								key={lane.id}
								type="button"
								onClick={() => onMove(lane.id)}
								className="cursor-pointer rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
							>
								→ {lane.label}
							</button>
						))}
					</div>
				</div>

				{ws.prUrl ? (
					<div className="space-y-1.5">
						<p className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
							Pull Request
						</p>
						<a
							href={ws.prUrl}
							target="_blank"
							rel="noreferrer"
							className="block truncate rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							{ws.prTitle ?? "Open PR ↗"}
						</a>
					</div>
				) : null}

				{ws.sessionCount > 0 ? (
					<div className="space-y-1">
						<p className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
							Threads
						</p>
						<p className="text-sm text-muted-foreground">
							{ws.sessionCount} {ws.sessionCount === 1 ? "thread" : "threads"}
						</p>
					</div>
				) : null}
			</div>
		</div>
	);
}

export function AddWorkspacePanel({
	value,
	onChange,
	onClose,
	onSubmit,
	busy,
}: {
	value: string;
	onChange: (value: string) => void;
	onClose: () => void;
	onSubmit: () => void;
	busy: boolean;
}) {
	return (
		<div className="flex min-h-0 flex-col">
			<div className="flex shrink-0 items-center justify-between border-b border-border/70 px-4 py-3">
				<div className="flex items-center gap-2 text-sm font-semibold">
					<Sparkles className="size-4" strokeWidth={1.8} />
					New workspace
				</div>
				<button
					type="button"
					onClick={onClose}
					className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
					aria-label="Close"
				>
					<X className="size-3.5" />
				</button>
			</div>
			<div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
				<p className="text-xs leading-5 text-muted-foreground">
					Each card is a workspace. Give it a name and it'll land in Backlog.
				</p>
				<Textarea
					value={value}
					onChange={(event) => onChange(event.target.value)}
					className="min-h-20 resize-none text-sm"
					placeholder="e.g. Implement auth flow"
					autoFocus
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							onSubmit();
						}
					}}
				/>
				<Button
					className="cursor-pointer"
					onClick={onSubmit}
					disabled={busy || !value.trim()}
				>
					{busy ? (
						<LoaderCircle className="size-4 animate-spin" />
					) : (
						<Plus className="size-4" />
					)}
					Create
				</Button>
			</div>
		</div>
	);
}
