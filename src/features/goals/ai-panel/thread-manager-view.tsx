import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	Loader2,
	MoreHorizontal,
	Pencil,
	Plus,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { WorkspaceDetail, WorkspaceSessionSummary } from "@/lib/api";
import {
	createSession,
	deleteSession,
	renameSession,
	setCardAssigneeThread,
} from "@/lib/api";
import {
	helmorQueryKeys,
	workspaceSessionsQueryOptions,
} from "@/lib/query-client";
import { cn } from "@/lib/utils";

type ThreadManagerViewProps = {
	goalWorkspaceId: string;
	cards: WorkspaceDetail[];
	onOpenThread?: (
		card: WorkspaceDetail,
		session: WorkspaceSessionSummary,
	) => void;
};

export function ThreadManagerView({
	goalWorkspaceId,
	cards,
	onOpenThread,
}: ThreadManagerViewProps) {
	const queryClient = useQueryClient();
	const [selectedCardId, setSelectedCardId] = useState<string | null>(
		cards[0]?.id ?? null,
	);
	const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
	const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
	const [draftTitle, setDraftTitle] = useState("");
	const [deleteTarget, setDeleteTarget] =
		useState<WorkspaceSessionSummary | null>(null);

	useEffect(() => {
		if (selectedCardId && cards.some((card) => card.id === selectedCardId)) {
			return;
		}
		setSelectedCardId(cards[0]?.id ?? null);
	}, [cards, selectedCardId]);

	const selectedCard = useMemo(
		() => cards.find((card) => card.id === selectedCardId) ?? null,
		[cards, selectedCardId],
	);
	const sessionsQuery = useQuery({
		...workspaceSessionsQueryOptions(selectedCardId ?? "__none__"),
		enabled: Boolean(selectedCardId),
	});
	const sessions = sessionsQuery.data ?? [];
	const activeThreadId = selectedCard?.activeSessionId ?? null;

	const invalidateSelectedCard = async () => {
		if (!selectedCardId) return;
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.workspaceSessions(selectedCardId),
			}),
			queryClient.invalidateQueries({
				queryKey: helmorQueryKeys.goalChildWorkspaces(goalWorkspaceId),
			}),
		]);
	};

	const createActiveThread = async () => {
		if (!selectedCard) return;
		const title = window.prompt(
			"Thread title",
			`Retry — ${selectedCard.title ?? selectedCard.directoryName ?? "Card"}`,
		);
		if (title === null) return;
		setBusyThreadId("new");
		try {
			const { sessionId } = await createSession(selectedCard.id);
			const trimmedTitle = title.trim();
			if (trimmedTitle) {
				await renameSession(sessionId, trimmedTitle);
			}
			await setCardAssigneeThread({
				goalWorkspaceId,
				cardId: selectedCard.id,
				threadId: sessionId,
				reason: "Created from Goal thread manager",
				supersedesThreadId: activeThreadId,
			});
			await invalidateSelectedCard();
		} finally {
			setBusyThreadId(null);
		}
	};

	const saveRename = async (session: WorkspaceSessionSummary) => {
		const trimmed = draftTitle.trim();
		if (!trimmed || trimmed === session.title) {
			setEditingThreadId(null);
			return;
		}
		setBusyThreadId(session.id);
		try {
			await renameSession(session.id, trimmed);
			await invalidateSelectedCard();
			setEditingThreadId(null);
		} finally {
			setBusyThreadId(null);
		}
	};

	const setActiveThread = async (session: WorkspaceSessionSummary) => {
		if (!selectedCard || session.id === activeThreadId) return;
		setBusyThreadId(session.id);
		try {
			await setCardAssigneeThread({
				goalWorkspaceId,
				cardId: selectedCard.id,
				threadId: session.id,
				reason: "Selected from Goal thread manager",
				supersedesThreadId: activeThreadId,
			});
			await invalidateSelectedCard();
		} finally {
			setBusyThreadId(null);
		}
	};

	const confirmDelete = async () => {
		if (!deleteTarget) return;
		setBusyThreadId(deleteTarget.id);
		try {
			await deleteSession(deleteTarget.id);
			await invalidateSelectedCard();
			setDeleteTarget(null);
		} finally {
			setBusyThreadId(null);
		}
	};

	if (cards.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center px-4 text-center text-[12px] text-muted-foreground/60">
				No cards yet. Create a card before managing assignee threads.
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="border-b px-3 py-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 w-full cursor-pointer justify-start text-[12px]"
					onClick={createActiveThread}
					disabled={!selectedCard || busyThreadId !== null}
				>
					{busyThreadId === "new" ? (
						<Loader2 className="mr-1.5 size-3 animate-spin" />
					) : (
						<Plus className="mr-1.5 size-3" />
					)}
					New active thread
				</Button>
			</div>
			<div className="grid min-h-0 flex-1 grid-cols-[minmax(110px,0.42fr)_minmax(0,1fr)]">
				<div className="min-h-0 overflow-y-auto border-r py-1">
					{cards.map((card) => (
						<button
							key={card.id}
							type="button"
							className={cn(
								"flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted/50",
								card.id === selectedCardId && "bg-muted/50",
							)}
							onClick={() => setSelectedCardId(card.id)}
						>
							<span className="truncate text-[12px] font-medium">
								{card.title ?? card.directoryName ?? "Untitled card"}
							</span>
							<span className="text-[10px] text-muted-foreground/55">
								{card.status ?? "in-progress"}
							</span>
						</button>
					))}
				</div>
				<div className="min-h-0 overflow-y-auto py-1">
					{sessionsQuery.isLoading ? (
						<div className="flex h-full items-center justify-center">
							<Loader2 className="size-4 animate-spin text-muted-foreground" />
						</div>
					) : sessions.length === 0 ? (
						<div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground/60">
							No threads in this card yet.
						</div>
					) : (
						sessions.map((session) => (
							<ThreadRow
								key={session.id}
								session={session}
								card={selectedCard}
								isActive={session.id === activeThreadId || session.active}
								isBusy={busyThreadId === session.id}
								isEditing={editingThreadId === session.id}
								draftTitle={draftTitle}
								onDraftTitleChange={setDraftTitle}
								onStartRename={() => {
									setEditingThreadId(session.id);
									setDraftTitle(session.title ?? "");
								}}
								onCancelRename={() => setEditingThreadId(null)}
								onSaveRename={() => saveRename(session)}
								onSetActive={() => setActiveThread(session)}
								onOpen={() => {
									if (selectedCard) onOpenThread?.(selectedCard, session);
								}}
								onDelete={() => setDeleteTarget(session)}
							/>
						))
					)}
				</div>
			</div>
			<ConfirmDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
				title="Delete thread?"
				description="This permanently deletes the conversation thread and its messages. This cannot be undone."
				confirmLabel="Delete"
				loading={Boolean(deleteTarget && busyThreadId === deleteTarget.id)}
				onConfirm={confirmDelete}
			/>
		</div>
	);
}

function ThreadRow({
	session,
	card,
	isActive,
	isBusy,
	isEditing,
	draftTitle,
	onDraftTitleChange,
	onStartRename,
	onCancelRename,
	onSaveRename,
	onSetActive,
	onOpen,
	onDelete,
}: {
	session: WorkspaceSessionSummary;
	card: WorkspaceDetail | null;
	isActive: boolean;
	isBusy: boolean;
	isEditing: boolean;
	draftTitle: string;
	onDraftTitleChange: (value: string) => void;
	onStartRename: () => void;
	onCancelRename: () => void;
	onSaveRename: () => void;
	onSetActive: () => void;
	onOpen: () => void;
	onDelete: () => void;
}) {
	const label = session.title?.trim() || "Untitled thread";
	const status = session.threadStatus ?? session.status;
	const modelLabel =
		session.model?.split("/").pop() ?? session.agentType ?? "agent";
	const updated = new Date(session.updatedAt).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
	return (
		<div className="group flex gap-2 px-3 py-2.5 hover:bg-muted/35">
			<div className="min-w-0 flex-1">
				{isEditing ? (
					<form
						className="flex gap-1"
						onSubmit={(event) => {
							event.preventDefault();
							onSaveRename();
						}}
					>
						<Input
							value={draftTitle}
							onChange={(event) => onDraftTitleChange(event.target.value)}
							className="h-7 text-[12px]"
							autoFocus
						/>
						<Button
							type="submit"
							variant="outline"
							size="sm"
							className="h-7 cursor-pointer px-2 text-[11px]"
						>
							Save
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 cursor-pointer px-2 text-[11px]"
							onClick={onCancelRename}
						>
							Cancel
						</Button>
					</form>
				) : (
					<button
						type="button"
						className="block w-full cursor-pointer text-left"
						onClick={onOpen}
						disabled={!card}
					>
						<div className="flex items-center gap-1.5">
							<span className="truncate text-[12.5px] font-medium leading-snug">
								{label}
							</span>
							{isActive && (
								<span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
									active
								</span>
							)}
						</div>
						<div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/55">
							<span>{updated}</span>
							<span>·</span>
							<span className="truncate">{modelLabel}</span>
							<span>·</span>
							<span className="truncate">{status}</span>
						</div>
						{session.staleReason && (
							<div className="mt-1 truncate text-[10px] text-destructive/80">
								{session.staleReason}
							</div>
						)}
					</button>
				)}
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-7 shrink-0 cursor-pointer opacity-70 group-hover:opacity-100"
						disabled={isBusy}
					>
						{isBusy ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<MoreHorizontal className="size-3.5" />
						)}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={onOpen} disabled={!card}>
						Open thread
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onSetActive} disabled={isActive}>
						<CheckCircle2 className="size-3" />
						Set active assignee
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onStartRename}>
						<Pencil className="size-3" />
						Rename
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onClick={onDelete}>
						<Trash2 className="size-3" />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
