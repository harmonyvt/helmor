import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	GitPullRequestDraft,
	LoaderCircle,
	Plus,
	Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
	createGoalChildWorkspace,
	finalizeWorkspaceFromRepo,
	type GoalCard,
	upsertGoalCard,
	type WorkspaceDetail,
	type WorkspaceStatus,
} from "@/lib/api";
import {
	goalCardsQueryOptions,
	helmorQueryKeys,
	workspaceDetailQueryOptions,
} from "@/lib/query-client";
import { cn } from "@/lib/utils";

const LANES: { id: WorkspaceStatus; label: string }[] = [
	{ id: "backlog", label: "Backlog" },
	{ id: "in-progress", label: "In progress" },
	{ id: "review", label: "In review" },
	{ id: "done", label: "Done" },
	{ id: "canceled", label: "Canceled" },
];

const KANBAN_UI_PROMPT =
	"Build the Goal Kanban UI in `src/features/goals/`. Implement lane layout, card rendering, drag/drop or explicit lane moves, proposed-card review controls, and linked-workspace actions. Match existing Helmor styling, use feature-folder structure, keep custom click targets `cursor-pointer`, and do not change backend APIs beyond the planned Goal API contracts.";

type GoalWorkspaceContainerProps = {
	workspaceId: string;
};

export function GoalWorkspaceContainer({
	workspaceId,
}: GoalWorkspaceContainerProps) {
	const queryClient = useQueryClient();
	const [plannerPrompt, setPlannerPrompt] = useState(
		"Hey, break this goal into implementation cards. Start with the actual Kanban UI and assign it to Claude Code Opus.",
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
					? { startBranch: prepared.sourceStartBranch, fetchStartBranch: true }
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

	const addKanbanUiCard = () => {
		upsertMutation.mutate({
			goalWorkspaceId: workspaceId,
			title: "Build Goal Kanban UI",
			description: KANBAN_UI_PROMPT,
			lane: "backlog",
			assignedProvider: "claude",
			assignedModelId: "default",
			assignedEffortLevel: "high",
		});
	};

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
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-background">
			<header className="flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
						<GitPullRequestDraft className="size-3.5" strokeWidth={1.8} />
						Goal Workspace
					</div>
					<h1 className="mt-1 truncate text-lg font-semibold tracking-[-0.02em]">
						{workspace?.title ?? "Goal"}
					</h1>
				</div>
				{workspace?.prUrl ? (
					<Button asChild variant="outline" size="sm">
						<a href={workspace.prUrl} target="_blank" rel="noreferrer">
							Open Goal PR
						</a>
					</Button>
				) : null}
			</header>

			<div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] gap-0">
				<section className="min-w-0 overflow-auto p-4">
					<div className="grid min-h-full grid-cols-5 gap-3">
						{LANES.map((lane) => (
							<GoalLane
								key={lane.id}
								lane={lane}
								cards={cardsByLane.get(lane.id) ?? []}
								onMove={(card, nextLane) =>
									upsertMutation.mutate({
										...card,
										lane: nextLane,
										goalWorkspaceId: workspaceId,
									})
								}
								onCreateWorkspace={(card) =>
									createWorkspaceMutation.mutate(card)
								}
								busyCardId={
									createWorkspaceMutation.isPending
										? createWorkspaceMutation.variables?.id
										: null
								}
							/>
						))}
					</div>
				</section>

				<aside className="flex min-h-0 flex-col border-l border-border/70 bg-sidebar/70 p-4">
					<div className="flex items-center gap-2 text-sm font-semibold">
						<Sparkles className="size-4" strokeWidth={1.8} />
						Planner
					</div>
					<p className="mt-2 text-xs leading-5 text-muted-foreground">
						Draft cards here before creating child workspaces. The Kanban UI
						card is preconfigured for Claude Code Opus.
					</p>
					<Textarea
						value={plannerPrompt}
						onChange={(event) => setPlannerPrompt(event.target.value)}
						className="mt-4 min-h-40 resize-none text-sm"
						placeholder="Describe a card or paste a planner step..."
					/>
					<div className="mt-3 grid gap-2">
						<Button
							className="cursor-pointer"
							onClick={addPlannerCard}
							disabled={upsertMutation.isPending}
						>
							<Plus className="size-4" />
							Create proposed card
						</Button>
						<Button
							className="cursor-pointer"
							variant="outline"
							onClick={addKanbanUiCard}
							disabled={upsertMutation.isPending}
						>
							Add Kanban UI card for Opus
						</Button>
					</div>
					<GoalInstructions workspace={workspace ?? null} />
				</aside>
			</div>
		</div>
	);
}

function GoalLane({
	lane,
	cards,
	onMove,
	onCreateWorkspace,
	busyCardId,
}: {
	lane: { id: WorkspaceStatus; label: string };
	cards: GoalCard[];
	onMove: (card: GoalCard, lane: WorkspaceStatus) => void;
	onCreateWorkspace: (card: GoalCard) => void;
	busyCardId: string | null | undefined;
}) {
	return (
		<div className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-muted/20">
			<div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
				<h2 className="text-sm font-medium">{lane.label}</h2>
				<span className="rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
					{cards.length}
				</span>
			</div>
			<div className="grid content-start gap-2 overflow-auto p-2">
				{cards.map((card) => (
					<GoalCardItem
						key={card.id}
						card={card}
						onMove={onMove}
						onCreateWorkspace={onCreateWorkspace}
						busy={busyCardId === card.id}
					/>
				))}
				{cards.length === 0 ? (
					<div className="rounded-lg border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
						No cards
					</div>
				) : null}
			</div>
		</div>
	);
}

function GoalCardItem({
	card,
	onMove,
	onCreateWorkspace,
	busy,
}: {
	card: GoalCard;
	onMove: (card: GoalCard, lane: WorkspaceStatus) => void;
	onCreateWorkspace: (card: GoalCard) => void;
	busy: boolean;
}) {
	return (
		<article className="rounded-lg border border-border/70 bg-background p-3 shadow-sm">
			<h3 className="text-sm font-medium leading-5">{card.title}</h3>
			{card.description ? (
				<p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
					{card.description}
				</p>
			) : null}
			<div className="mt-3 flex flex-wrap gap-1.5">
				{card.assignedProvider || card.assignedModelId ? (
					<span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
						{card.assignedProvider ?? "agent"} ·{" "}
						{card.assignedModelId ?? "model"}
					</span>
				) : null}
				{card.assignedEffortLevel ? (
					<span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						{card.assignedEffortLevel}
					</span>
				) : null}
			</div>
			<div className="mt-3 grid gap-2">
				{card.childWorkspaceId ? (
					<div className="rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
						Workspace linked
					</div>
				) : (
					<Button
						variant="outline"
						size="xs"
						className="cursor-pointer"
						onClick={() => onCreateWorkspace(card)}
						disabled={busy}
					>
						{busy ? (
							<LoaderCircle className="size-3 animate-spin" />
						) : (
							<Plus className="size-3" />
						)}
						Create child workspace
					</Button>
				)}
				<div className="flex gap-1 overflow-x-auto">
					{LANES.filter((lane) => lane.id !== card.lane).map((lane) => (
						<button
							key={lane.id}
							type="button"
							onClick={() => onMove(card, lane.id)}
							className={cn(
								"shrink-0 rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer",
							)}
						>
							{lane.label}
						</button>
					))}
				</div>
			</div>
		</article>
	);
}

function GoalInstructions({
	workspace,
}: {
	workspace: WorkspaceDetail | null;
}) {
	return (
		<div className="mt-4 rounded-xl border border-border/70 bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
			<p className="font-medium text-foreground">Kanban UI delegation</p>
			<p className="mt-1">
				Use Claude Code Opus (`default`) with high effort for the UI card. Child
				workspaces target the Goal branch
				{workspace?.branch ? ` ${workspace.branch}` : ""}.
			</p>
		</div>
	);
}
