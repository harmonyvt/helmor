import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Bot,
	GitBranch,
	GitPullRequestDraft,
	LoaderCircle,
	Pencil,
	Plus,
	Sparkles,
	X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
	createGoalChildWorkspace,
	finalizeWorkspaceFromRepo,
	setWorkspaceStatus,
	updateGoalWorkspaceMeta,
	type WorkspaceDetail,
	type WorkspaceStatus,
} from "@/lib/api";
import {
	goalChildWorkspacesQueryOptions,
	helmorQueryKeys,
	workspaceDetailQueryOptions,
} from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { GoalsAiPanel } from "./ai-panel";

const LANES: { id: WorkspaceStatus; label: string; color: string }[] = [
	{ id: "backlog", label: "Backlog", color: "#848f92" },
	{ id: "in-progress", label: "In progress", color: "#508a5a" },
	{ id: "review", label: "In review", color: "#a09040" },
	{ id: "done", label: "Done", color: "#4a8ab0" },
	{ id: "canceled", label: "Canceled", color: "#a86868" },
];

type DragState = {
	workspaceId: string;
	sourceLane: WorkspaceStatus;
} | null;

type GoalWorkspaceContainerProps = {
	workspaceId: string;
	headerLeading?: React.ReactNode;
	onSelectWorkspace?: (workspaceId: string) => void;
};

export function GoalWorkspaceContainer({
	workspaceId,
	headerLeading,
	onSelectWorkspace,
}: GoalWorkspaceContainerProps) {
	const queryClient = useQueryClient();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [showAddPanel, setShowAddPanel] = useState(false);
	const [showAiPanel, setShowAiPanel] = useState(false);
	const [showGoalSheet, setShowGoalSheet] = useState(false);
	const [newCardTitle, setNewCardTitle] = useState("");
	const [dragState, setDragState] = useState<DragState>(null);
	const [dragOverLane, setDragOverLane] = useState<WorkspaceStatus | null>(
		null,
	);

	const detailQuery = useQuery(workspaceDetailQueryOptions(workspaceId));
	const childQuery = useQuery(goalChildWorkspacesQueryOptions(workspaceId));
	const workspace = detailQuery.data;
	const children = childQuery.data ?? [];

	const invalidate = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.goalChildWorkspaces(workspaceId),
			}),
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceGroups,
			}),
		]);
	}, [queryClient, workspaceId]);

	const saveGoalMeta = useCallback(
		async (title: string, description: string) => {
			await updateGoalWorkspaceMeta(
				workspaceId,
				title.trim() || null,
				description.trim() || null,
			);
			await queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceDetail(workspaceId),
			});
			setShowGoalSheet(false);
		},
		[workspaceId, queryClient],
	);

	const byLane = useMemo(() => {
		const grouped = new Map<WorkspaceStatus, WorkspaceDetail[]>();
		for (const lane of LANES) grouped.set(lane.id, []);
		for (const ws of children) {
			const key = grouped.has(ws.status) ? ws.status : "backlog";
			grouped.get(key)?.push(ws);
		}
		return grouped;
	}, [children]);

	const selectedWorkspace = useMemo(
		() => children.find((c) => c.id === selectedId) ?? null,
		[children, selectedId],
	);

	// ── Move card (drag or button) ────────────────────────────────────────────
	const moveMutation = useMutation({
		mutationFn: ({
			workspaceId: wid,
			status,
		}: {
			workspaceId: string;
			status: WorkspaceStatus;
		}) => setWorkspaceStatus(wid, status),
		onSuccess: invalidate,
	});

	const handleMoveCard = useCallback(
		(ws: WorkspaceDetail, lane: WorkspaceStatus) => {
			moveMutation.mutate({ workspaceId: ws.id, status: lane });
		},
		[moveMutation],
	);

	// ── Create child workspace ────────────────────────────────────────────────
	const createMutation = useMutation({
		mutationFn: async (title: string) => {
			const prepared = await createGoalChildWorkspace({
				goalWorkspaceId: workspaceId,
				title: title || undefined,
			});
			await finalizeWorkspaceFromRepo(prepared.workspaceId, {
				...(prepared.sourceStartBranch
					? { startBranch: prepared.sourceStartBranch, fetchStartBranch: true }
					: {}),
			});
			return prepared;
		},
		onSuccess: async (prepared) => {
			setSelectedId(prepared.workspaceId);
			setShowAddPanel(false);
			setNewCardTitle("");
			await Promise.all([
				invalidate(),
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceDetail(prepared.workspaceId),
				}),
			]);
		},
	});

	const addCard = () => {
		if (!newCardTitle.trim()) return;
		createMutation.mutate(newCardTitle.trim());
	};

	// ── Drag-and-drop ─────────────────────────────────────────────────────────
	const handleDragStart = useCallback(
		(wsId: string, sourceLane: WorkspaceStatus) => {
			setDragState({ workspaceId: wsId, sourceLane });
		},
		[],
	);
	const handleDragEnd = useCallback(() => {
		setDragState(null);
		setDragOverLane(null);
	}, []);
	const handleDragOver = useCallback(
		(laneId: WorkspaceStatus, e: React.DragEvent) => {
			e.preventDefault();
			setDragOverLane(laneId);
		},
		[],
	);
	const handleDrop = useCallback(
		(laneId: WorkspaceStatus) => {
			if (!dragState || dragState.sourceLane === laneId) {
				setDragState(null);
				setDragOverLane(null);
				return;
			}
			const ws = children.find((c) => c.id === dragState.workspaceId);
			if (ws) handleMoveCard(ws, laneId);
			setDragState(null);
			setDragOverLane(null);
		},
		[dragState, children, handleMoveCard],
	);
	const handleDragLeave = useCallback((e: React.DragEvent) => {
		if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
			setDragOverLane(null);
		}
	}, []);

	const isPanelOpen = selectedWorkspace !== null || showAddPanel || showAiPanel;

	const goalTitle = workspace?.goalTitle ?? workspace?.title ?? "Goal";
	const goalDescription = workspace?.goalDescription ?? null;

	// Snapshot for Pi — list of child workspaces in a compact format.
	const piSnapshot = useMemo(
		() =>
			JSON.stringify(
				children.map((c) => ({
					id: c.id,
					title: c.title,
					lane: c.status,
					branch: c.branch,
					prUrl: c.prUrl,
					sessionCount: c.sessionCount,
				})),
			),
		[children],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-background">
			{/* Goal meta sheet */}
			<GoalMetaSheet
				open={showGoalSheet}
				onOpenChange={setShowGoalSheet}
				initialTitle={workspace?.goalTitle ?? ""}
				initialDescription={workspace?.goalDescription ?? ""}
				onSave={saveGoalMeta}
			/>

			{/* Header */}
			<header
				className="flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-3"
				data-tauri-drag-region
			>
				<div className="flex min-w-0 items-center gap-2">
					{headerLeading}
					<div className="min-w-0">
						<div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
							<GitPullRequestDraft className="size-3.5" strokeWidth={1.8} />
							Goal Workspace
						</div>
						<h1 className="mt-0.5 truncate text-lg font-semibold tracking-[-0.02em]">
							{goalTitle}
						</h1>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{workspace?.prUrl ? (
						<Button asChild variant="outline" size="sm">
							<a href={workspace.prUrl} target="_blank" rel="noreferrer">
								Open PR
							</a>
						</Button>
					) : null}
					<Button
						variant="outline"
						size="sm"
						className="cursor-pointer"
						onClick={() => {
							setShowAiPanel((p) => !p);
							setSelectedId(null);
							setShowAddPanel(false);
						}}
						title="Pi AI assistant"
					>
						<Bot className="size-3.5" />
						AI
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="cursor-pointer"
						onClick={() => {
							setShowAddPanel(true);
							setSelectedId(null);
							setShowAiPanel(false);
						}}
					>
						<Plus className="size-3.5" />
						Add card
					</Button>
				</div>
			</header>

			{/* Goal description banner */}
			<button
				type="button"
				className="group flex shrink-0 cursor-pointer items-start gap-2 border-b border-border/50 bg-muted/20 px-5 py-2 text-left transition-colors hover:bg-muted/40"
				onClick={() => setShowGoalSheet(true)}
				title="Edit goal title and description"
			>
				<div className="min-w-0 flex-1">
					{goalDescription ? (
						<p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
							{goalDescription}
						</p>
					) : (
						<p className="text-[12px] text-muted-foreground/50 italic">
							Add a description for this goal…
						</p>
					)}
				</div>
				<Pencil className="mt-0.5 size-3 shrink-0 text-muted-foreground/30 transition-opacity group-hover:text-muted-foreground/60" />
			</button>

			{/* Body */}
			<div className="flex min-h-0 flex-1 overflow-hidden">
				{/* Kanban lanes */}
				<div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
					<div className="flex h-full gap-3 p-4">
						{LANES.map((lane) => (
							<GoalLane
								key={lane.id}
								lane={lane}
								workspaces={byLane.get(lane.id) ?? []}
								isDragOver={dragOverLane === lane.id}
								draggedId={dragState?.workspaceId ?? null}
								selectedId={selectedId}
								onCardClick={(ws) => {
									setSelectedId(ws.id);
									setShowAddPanel(false);
									setShowAiPanel(false);
									onSelectWorkspace?.(ws.id);
								}}
								onDragStart={handleDragStart}
								onDragEnd={handleDragEnd}
								onDragOver={(e) => handleDragOver(lane.id, e)}
								onDrop={() => handleDrop(lane.id)}
								onDragLeave={handleDragLeave}
							/>
						))}
					</div>
				</div>

				{/* Side panel */}
				{isPanelOpen && (
					<aside className="flex w-72 min-h-0 shrink-0 flex-col border-l border-border/70 bg-sidebar/70">
						{showAiPanel ? (
							<GoalsAiPanel
								workspaceId={workspaceId}
								cards={children}
								kanbanSnapshot={piSnapshot}
								goalTitle={workspace?.goalTitle ?? null}
								goalDescription={workspace?.goalDescription ?? null}
								onClose={() => setShowAiPanel(false)}
								onCardCreated={(ws) => setSelectedId(ws.id)}
							/>
						) : selectedWorkspace ? (
							<WorkspaceDetailPanel
								workspace={selectedWorkspace}
								parentWorkspaceTitle={workspace?.title ?? "Goal"}
								onClose={() => setSelectedId(null)}
								onMove={(lane) => handleMoveCard(selectedWorkspace, lane)}
								onOpen={
									onSelectWorkspace
										? () => onSelectWorkspace(selectedWorkspace.id)
										: undefined
								}
							/>
						) : showAddPanel ? (
							<AddCardPanel
								value={newCardTitle}
								onChange={setNewCardTitle}
								onClose={() => setShowAddPanel(false)}
								onSubmit={addCard}
								busy={createMutation.isPending}
							/>
						) : null}
					</aside>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Lane
// ---------------------------------------------------------------------------

function GoalLane({
	lane,
	workspaces,
	isDragOver,
	draggedId,
	selectedId,
	onCardClick,
	onDragStart,
	onDragEnd,
	onDragOver,
	onDrop,
	onDragLeave,
}: {
	lane: { id: WorkspaceStatus; label: string; color: string };
	workspaces: WorkspaceDetail[];
	isDragOver: boolean;
	draggedId: string | null;
	selectedId: string | null;
	onCardClick: (ws: WorkspaceDetail) => void;
	onDragStart: (id: string, lane: WorkspaceStatus) => void;
	onDragEnd: () => void;
	onDragOver: (e: React.DragEvent) => void;
	onDrop: () => void;
	onDragLeave: (e: React.DragEvent) => void;
}) {
	return (
		<div
			className={cn(
				"flex min-h-0 w-52 shrink-0 flex-col rounded-xl border transition-colors duration-150",
				isDragOver
					? "border-ring/60 bg-accent/30"
					: "border-border/70 bg-muted/20",
			)}
			onDragOver={onDragOver}
			onDrop={onDrop}
			onDragLeave={onDragLeave}
		>
			<div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2">
				<div className="flex items-center gap-2">
					<span
						className="size-2 shrink-0 rounded-full"
						style={{ backgroundColor: lane.color }}
						aria-hidden="true"
					/>
					<h2 className="text-sm font-medium">{lane.label}</h2>
				</div>
				<span className="rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
					{workspaces.length}
				</span>
			</div>

			<div className="flex flex-col gap-2 overflow-y-auto p-2">
				{workspaces.map((ws) => (
					<WorkspaceCard
						key={ws.id}
						workspace={ws}
						isSelected={selectedId === ws.id}
						isDragging={draggedId === ws.id}
						onClick={() => onCardClick(ws)}
						onDragStart={() => onDragStart(ws.id, ws.status)}
						onDragEnd={onDragEnd}
					/>
				))}
				{workspaces.length === 0 ? (
					<div
						className={cn(
							"rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground transition-colors duration-150",
							isDragOver ? "border-ring/50 bg-accent/20" : "border-border/70",
						)}
					>
						{isDragOver ? "Drop here" : "No cards"}
					</div>
				) : isDragOver ? (
					<div className="rounded-lg border-2 border-dashed border-ring/50 px-3 py-4" />
				) : null}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function WorkspaceCard({
	workspace: ws,
	isSelected,
	isDragging,
	onClick,
	onDragStart,
	onDragEnd,
}: {
	workspace: WorkspaceDetail;
	isSelected: boolean;
	isDragging: boolean;
	onClick: () => void;
	onDragStart: () => void;
	onDragEnd: () => void;
}) {
	const agentType = ws.activeSessionAgentType;

	return (
		<article
			draggable
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onClick={onClick}
			className={cn(
				"cursor-pointer select-none rounded-lg border bg-background p-3 shadow-sm transition-all duration-150",
				isSelected
					? "border-ring/60 shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_20%,transparent)]"
					: "border-border/70 hover:border-border hover:shadow-md",
				isDragging && "opacity-40 scale-[0.97]",
			)}
		>
			<h3 className="line-clamp-2 text-sm font-medium leading-5">{ws.title}</h3>
			{ws.branch ? (
				<div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
					<GitBranch className="size-2.5 shrink-0" />
					<span className="truncate font-mono">{ws.branch}</span>
				</div>
			) : null}
			<div className="mt-2 flex flex-wrap gap-1.5">
				{agentType ? (
					<span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-medium capitalize text-accent-foreground">
						{agentType}
					</span>
				) : null}
				{ws.prUrl ? (
					<span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						PR
					</span>
				) : null}
				{ws.sessionCount > 0 ? (
					<span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						{ws.sessionCount} {ws.sessionCount === 1 ? "thread" : "threads"}
					</span>
				) : null}
			</div>
		</article>
	);
}

// ---------------------------------------------------------------------------
// Workspace detail panel (right-side)
// ---------------------------------------------------------------------------

function WorkspaceDetailPanel({
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
	const currentLane = LANES.find((l) => l.id === ws.status);

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

				{/* Lane */}
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
						{LANES.filter((l) => l.id !== ws.status).map((lane) => (
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

				{/* PR */}
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

				{/* Sessions */}
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

// ---------------------------------------------------------------------------
// Add card panel
// ---------------------------------------------------------------------------

function AddCardPanel({
	value,
	onChange,
	onClose,
	onSubmit,
	busy,
}: {
	value: string;
	onChange: (v: string) => void;
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
					onChange={(e) => onChange(e.target.value)}
					className="min-h-20 resize-none text-sm"
					placeholder="e.g. Implement auth flow"
					autoFocus
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
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

// ---------------------------------------------------------------------------
// Goal Meta Sheet
// ---------------------------------------------------------------------------

function GoalMetaSheet({
	open,
	onOpenChange,
	initialTitle,
	initialDescription,
	onSave,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialTitle: string;
	initialDescription: string;
	onSave: (title: string, description: string) => Promise<void>;
}) {
	const [title, setTitle] = useState(initialTitle);
	const [description, setDescription] = useState(initialDescription);
	const [saving, setSaving] = useState(false);

	const handleSave = async () => {
		setSaving(true);
		try {
			await onSave(title, description);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="flex w-full max-w-md flex-col gap-0 p-0"
			>
				<SheetHeader className="border-b border-border/70 px-5 py-4">
					<SheetTitle>Goal details</SheetTitle>
					<SheetDescription>
						Set a title and description for this goal workspace. The Pi AI agent
						uses these to stay focused on what you're building.
					</SheetDescription>
				</SheetHeader>

				<div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
					<div className="space-y-1.5">
						<label
							htmlFor="goal-title"
							className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground"
						>
							Title
						</label>
						<input
							id="goal-title"
							type="text"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="e.g. Build the authentication system"
							className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
						/>
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="goal-description"
							className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground"
						>
							Description
						</label>
						<Textarea
							id="goal-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Describe what this goal is about, what success looks like, and any constraints or context the AI should know..."
							className="min-h-[120px] resize-y text-sm"
						/>
					</div>
				</div>

				<SheetFooter className="border-t border-border/70 px-5 py-4">
					<Button
						variant="outline"
						className="cursor-pointer"
						onClick={() => onOpenChange(false)}
						disabled={saving}
					>
						Cancel
					</Button>
					<Button
						className="cursor-pointer"
						onClick={handleSave}
						disabled={saving}
					>
						{saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
						Save
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
