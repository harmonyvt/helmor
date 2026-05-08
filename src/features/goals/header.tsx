import { Bot, GitPullRequestDraft, Pencil, Plus } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";

type GoalHeaderProps = {
	headerLeading?: React.ReactNode;
	goalTitle: string;
	goalDescription: string | null;
	prUrl?: string | null;
	onEditGoal: () => void;
	onShowAi: () => void;
	onShowAddCard: () => void;
	canCreateCards?: boolean;
};

export function GoalHeader({
	headerLeading,
	goalTitle,
	goalDescription,
	prUrl,
	onEditGoal,
	onShowAi,
	onShowAddCard,
	canCreateCards = true,
}: GoalHeaderProps) {
	return (
		<>
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
					{prUrl ? (
						<Button asChild variant="outline" size="sm">
							<a href={prUrl} target="_blank" rel="noreferrer">
								Open PR
							</a>
						</Button>
					) : null}
					<Button
						variant="outline"
						size="sm"
						className="cursor-pointer"
						onClick={onShowAi}
						title={
							canCreateCards
								? "Pi AI assistant"
								: "Goal setup must finish before Pi can create cards"
						}
						disabled={!canCreateCards}
					>
						<Bot className="size-3.5" />
						AI
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="cursor-pointer"
						onClick={onShowAddCard}
						disabled={!canCreateCards}
						title={
							canCreateCards
								? "Add card"
								: "Goal setup must finish before adding cards"
						}
					>
						<Plus className="size-3.5" />
						Add card
					</Button>
				</div>
			</header>

			<button
				type="button"
				className="group flex shrink-0 cursor-pointer items-start gap-2 border-b border-border/50 bg-muted/20 px-5 py-2 text-left transition-colors hover:bg-muted/40"
				onClick={onEditGoal}
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
		</>
	);
}
