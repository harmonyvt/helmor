import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	GitBranch,
	GitPullRequestDraft,
	LoaderCircle,
	Plus,
	Sparkles,
	X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
	createGoalChildWorkspace,
	finalizeWorkspaceFromRepo,
	type GoalCard,
	upsertGoalCard,
	type WorkspaceStatus,
} from "@/lib/api";
import {
	goalCardsQueryOptions,
	helmorQueryKeys,
	workspaceDetailQueryOptions,
} from "@/lib/query-client";
import { cn } from "@/lib/utils";

const LANES: { id: WorkspaceStatus; label: string; color: string }[] = [
	{ id: "backlog", label: "Backlog", color: "#848f92" },
	{ id: "in-progress", label: "In progress", color: "#508a5a" },
	{ id: "review", label: "In review", color: "#a09040" },
	{ id: "done", label: "Done", color: "#4a8ab0" },
	{ id: "canceled", label: "Canceled", color: "#a86868" },
];

type DragState = {
	cardId: string;
	sourceLane: WorkspaceStatus;
} | null;

type GoalWorkspaceContainerProps = {
	workspaceId: string;
};

export function GoalWorkspaceContainer({
	workspaceId,
}: GoalWorkspaceContainerProps) {
	const queryClient = useQueryClient();
	const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
	const [showPlanner, setShowPlanner] = useState(false);
	const [plannerPrompt, setPlannerPrompt] = useState(
		"Break this goal into implementation cards. Start with the actual Kanban UI and assign it to Claude Code Opus.",
	);
	const [dragState, setDragState] = useState<DragState>(null);
	const [dragOverLane, setDragOverLane] = useState<WorkspaceStatus | null>(
		null,
	);

	const detailQuery = useQuery(workspaceDetailQueryOptions(workspaceId));
	const cardsQuery = useQuery(goalCardsQueryOptions(workspaceId));
	const workspace = detailQuery.data;
	const cards = cardsQuery.data ?? [];

	const cardsByLane = useMemo(() => {
		const grouped = new Map<WorkspaceStatus, GoalCard[]>();
		for (const lane of LANES) grouped.set(lane.id, []);
		for (const card of cards) {
			const lane = grouped.get(card.lane) ? card.lane : "backlog";
			grouped.get(lane)?.push(card);
		}
		return grouped;
	}, [cards]);

	const selectedCard = useMemo(
		() => cards.find((c) => c.id === selectedCardId) ?? null,
		[cards, selectedCardId],
	);

	const invalidate = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.goalCards(workspaceId),
			}),
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceGroups,
			}),
		]);
	};

	const upsertMutation = useMutation({
		mutationFn: upsertGoalCard,
		onSuccess: invalidate,
	});

	const createWorkspaceMutation = useMutation({
		mutationFn: async (card: GoalCard) => {
			const prepared = await createGoalChildWorkspace({
				goalWorkspaceId: workspaceId,
				goalCardId: card.id,
				title: card.title,
			});
			await finalizeWorkspaceFromRepo(prepared.workspaceId, {
				...(prepared.sourceStartBranch
					? {
							startBranch: prepared.sourceStartBranch,
							fetchStartBranch: true,
						}
					: {}),
			});
			return prepared;
		},
		onSuccess: async (prepared) => {
			await Promise.all([
				invalidate(),
				queryClient.invalidateQueries({
					queryKey: helmorQueryKeys.workspaceDetail(prepared.workspaceId),
				}),
			]);
		},
	});

	const handleMoveCard = useCallback(
		(card: GoalCard, lane: WorkspaceStatus) => {
			upsertMutation.mutate({
				...card,
				lane,
				goalWorkspaceId: workspaceId,
			});
		},
		[upsertMutation, workspaceId],
	);

	const addPlannerCard = () => {
		const title = plannerPrompt
			.trim()
			.split(/\r?\n/)[0]
			?.replace(/^[-#\s]+/, "")
			.trim();
		if (!title) return;
		upsertMutation.mutate({
			goalWorkspaceId: workspaceId,
			title: title.length > 80 ? `${title.slice(0, 77)}...` : title,
			description: plannerPrompt,
			lane: "backlog",
			assignedProvider: "claude",
			assignedModelId: "default",
			assignedEffortLevel: "high",
		});
		setShowPlanner(false);
	};

	const handleDragStart = useCallback(
		(cardId: string, sourceLane: WorkspaceStatus) => {
			setDragState({ cardId, sourceLane });
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
			const card = cards.find((c) => c.id === dragState.cardId);
			if (card) handleMoveCard(card, laneId);
			setDragState(null);
			setDragOverLane(null);
		},
		[dragState, cards, handleMoveCard],
	);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		// Only clear if leaving the lane container entirely
		if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
			setDragOverLane(null);
		}
	}, []);

	const isPanelOpen = selectedCard !== null || showPlanner;

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-background">
			{/* Header */}
			<header className="flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
						<GitPullRequestDraft className="size-3.5" strokeWidth={1.8} />
						Goal Workspace
					</div>
					<h1 className="mt-0.5 truncate text-lg font-semibold tracking-[-0.02em]">
						{workspace?.title ?? "Goal"}
					</h1>
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
							setShowPlanner(true);
							setSelectedCardId(null);
						}}
					>
						<Plus className="size-3.5" />
						Add card
					</Button>
				</div>
			</header>

			{/* Body: lanes + optional detail/planner panel */}
			<div className="flex min-h-0 flex-1 overflow-hidden">
				{/* Kanban lanes: horizontally scrollable */}
				<div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
					<div className="flex h-full gap-3 p-4">
						{LANES.map((lane) => (
							<GoalLane
								key={lane.id}
								lane={lane}
								cards={cardsByLane.get(lane.id) ?? []}
								isDragOver={dragOverLane === lane.id}
								draggedCardId={dragState?.cardId ?? null}
								selectedCardId={selectedCardId}
								onCardClick={(card) => {
									setSelectedCardId(card.id);
									setShowPlanner(false);
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

				{/* Detail / Planner panel — slides in from right */}
				{isPanelOpen && (
					<aside className="flex w-72 min-h-0 shrink-0 flex-col border-l border-border/70 bg-sidebar/70">
						{selectedCard ? (
							<CardDetailPanel
								card={selectedCard}
								parentWorkspaceTitle={workspace?.title ?? "Goal"}
								onClose={() => setSelectedCardId(null)}
								onMove={(lane) => handleMoveCard(selectedCard, lane)}
								onCreateWorkspace={() =>
									createWorkspaceMutation.mutate(selectedCard)
								}
								busy={
									createWorkspaceMutation.isPending &&
									createWorkspaceMutation.variables?.id === selectedCard.id
								}
							/>
						) : showPlanner ? (
							<PlannerPanel
								value={plannerPrompt}
								onChange={setPlannerPrompt}
								onClose={() => setShowPlanner(false)}
								onSubmit={addPlannerCard}
								busy={upsertMutation.isPending}
							/>
						) : null}
					</aside>
				)}
			</div>
		</div>
	);
}

function GoalLane({
	lane,
	cards,
	isDragOver,
	draggedCardId,
	selectedCardId,
	onCardClick,
	onDragStart,
	onDragEnd,
	onDragOver,
	onDrop,
	onDragLeave,
}: {
	lane: { id: WorkspaceStatus; label: string; color: string };
	cards: GoalCard[];
	isDragOver: boolean;
	draggedCardId: string | null;
	selectedCardId: string | null;
	onCardClick: (card: GoalCard) => void;
	onDragStart: (cardId: string, sourceLane: WorkspaceStatus) => void;
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
			{/* Lane header */}
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
					{cards.length}
				</span>
			</div>

			{/* Cards */}
			<div className="flex flex-col gap-2 overflow-y-auto p-2">
				{cards.map((card) => (
					<GoalCardItem
						key={card.id}
						card={card}
						isSelected={selectedCardId === card.id}
						isDragging={draggedCardId === card.id}
						onClick={() => onCardClick(card)}
						onDragStart={() => onDragStart(card.id, card.lane)}
						onDragEnd={onDragEnd}
					/>
				))}
				{cards.length === 0 ? (
					<div
						className={cn(
							"rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground transition-colors duration-150",
							isDragOver ? "border-ring/50 bg-accent/20" : "border-border/70",
						)}
					>
						{isDragOver ? "Drop here" : "No cards"}
					</div>
				) : isDragOver ? (
					<div className="rounded-lg border-2 border-dashed border-ring/50 px-3 py-4 text-center text-xs text-muted-foreground" />
				) : null}
			</div>
		</div>
	);
}

function GoalCardItem({
	card,
	isSelected,
	isDragging,
	onClick,
	onDragStart,
	onDragEnd,
}: {
	card: GoalCard;
	isSelected: boolean;
	isDragging: boolean;
	onClick: () => void;
	onDragStart: () => void;
	onDragEnd: () => void;
}) {
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
			<h3 className="line-clamp-2 text-sm font-medium leading-5">
				{card.title}
			</h3>
			{card.description ? (
				<p className="mt-1.5 line-clamp-2 text-xs leading-[1.5] text-muted-foreground">
					{card.description}
				</p>
			) : null}
			<div className="mt-2.5 flex flex-wrap gap-1.5">
				{card.assignedProvider ? (
					<span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-medium capitalize text-accent-foreground">
						{card.assignedProvider}
					</span>
				) : null}
				{card.assignedEffortLevel ? (
					<span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						{card.assignedEffortLevel}
					</span>
				) : null}
				{card.childWorkspaceId ? (
					<span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						<GitBranch className="size-2.5" />
						Workspace
					</span>
				) : null}
			</div>
		</article>
	);
}

function CardDetailPanel({
	card,
	parentWorkspaceTitle,
	onClose,
	onMove,
	onCreateWorkspace,
	busy,
}: {
	card: GoalCard;
	parentWorkspaceTitle: string;
	onClose: () => void;
	onMove: (lane: WorkspaceStatus) => void;
	onCreateWorkspace: () => void;
	busy: boolean;
}) {
	const childWorkspaceQuery = useQuery({
		...workspaceDetailQueryOptions(card.childWorkspaceId ?? ""),
		enabled: !!card.childWorkspaceId,
	});
	const childWorkspace = childWorkspaceQuery.data;
	const currentLane = LANES.find((l) => l.id === card.lane);

	return (
		<div className="flex min-h-0 flex-col">
			{/* Panel header */}
			<div className="flex shrink-0 items-center justify-between border-b border-border/70 px-4 py-3">
				<div className="min-w-0">
					<p className="truncate text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
						{parentWorkspaceTitle}
					</p>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="ml-2 shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
					aria-label="Close card detail"
				>
					<X className="size-3.5" />
				</button>
			</div>

			{/* Scrollable content */}
			<div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
				{/* Card title + description */}
				<div>
					<h2 className="text-sm font-semibold leading-5 tracking-[-0.01em]">
						{card.title}
					</h2>
					{card.description ? (
						<p className="mt-2 whitespace-pre-wrap text-xs leading-[1.6] text-muted-foreground">
							{card.description}
						</p>
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
						<span className="text-sm">{currentLane?.label ?? card.lane}</span>
					</div>
					<div className="flex flex-wrap gap-1.5 pt-0.5">
						{LANES.filter((l) => l.id !== card.lane).map((lane) => (
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

				{/* Agent assignment */}
				{card.assignedProvider ||
				card.assignedModelId ||
				card.assignedEffortLevel ? (
					<div className="space-y-2">
						<p className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
							Agent
						</p>
						<div className="flex flex-wrap gap-1.5">
							{card.assignedProvider ? (
								<span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium capitalize text-accent-foreground">
									{card.assignedProvider}
								</span>
							) : null}
							{card.assignedModelId ? (
								<span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
									{card.assignedModelId}
								</span>
							) : null}
							{card.assignedEffortLevel ? (
								<span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
									{card.assignedEffortLevel}
								</span>
							) : null}
						</div>
					</div>
				) : null}

				{/* Sub-workspace */}
				<div className="space-y-2">
					<p className="text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
						Sub-workspace
					</p>
					{card.childWorkspaceId ? (
						childWorkspace ? (
							<div className="space-y-2 rounded-lg border border-border/70 bg-background/60 p-3">
								<p className="truncate text-xs font-medium leading-4">
									{childWorkspace.title}
								</p>
								{childWorkspace.branch ? (
									<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
										<GitBranch className="size-3 shrink-0" />
										<span className="truncate font-mono">
											{childWorkspace.branch}
										</span>
									</div>
								) : null}
								<div className="flex items-center justify-between gap-2">
									<div className="flex items-center gap-1.5">
										<span
											className="size-2 shrink-0 rounded-full"
											style={{
												backgroundColor:
													LANES.find((l) => l.id === childWorkspace.status)
														?.color ?? "#848f92",
											}}
											aria-hidden="true"
										/>
										<span className="text-[11px] capitalize text-muted-foreground">
											{childWorkspace.status.replace("-", " ")}
										</span>
									</div>
									{childWorkspace.prUrl ? (
										<a
											href={childWorkspace.prUrl}
											target="_blank"
											rel="noreferrer"
											className="shrink-0 rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
										>
											PR ↗
										</a>
									) : null}
								</div>
							</div>
						) : (
							<div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
								Loading workspace...
							</div>
						)
					) : (
						<Button
							variant="outline"
							size="xs"
							className="w-full cursor-pointer justify-start"
							onClick={onCreateWorkspace}
							disabled={busy}
						>
							{busy ? (
								<LoaderCircle className="size-3 animate-spin" />
							) : (
								<Plus className="size-3" />
							)}
							Create sub-workspace
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

function PlannerPanel({
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
					Add card
				</div>
				<button
					type="button"
					onClick={onClose}
					className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
					aria-label="Close planner"
				>
					<X className="size-3.5" />
				</button>
			</div>
			<div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
				<p className="text-xs leading-5 text-muted-foreground">
					Draft a card. The first line becomes the title.
				</p>
				<Textarea
					value={value}
					onChange={(e) => onChange(e.target.value)}
					className="min-h-32 resize-none text-sm"
					placeholder="Describe a card..."
					autoFocus
				/>
				<Button className="cursor-pointer" onClick={onSubmit} disabled={busy}>
					<Plus className="size-4" />
					Create card
				</Button>
			</div>
		</div>
	);
}
