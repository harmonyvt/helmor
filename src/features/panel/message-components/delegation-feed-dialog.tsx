import { useQuery } from "@tanstack/react-query";
import { Bot, CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { HelmorLogoAnimated } from "@/components/helmor-logo-animated";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type {
	DelegationAnchorPart,
	DelegationRecord,
	ThreadMessageLike,
} from "@/lib/api";
import { sessionThreadMessagesQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { MemoConversationMessage } from "./conversation-message";

type DelegationFeedLike = Pick<
	DelegationAnchorPart,
	| "childSessionId"
	| "parentSessionId"
	| "title"
	| "provider"
	| "modelId"
	| "status"
	| "startedAt"
	| "completedAt"
	| "structuredResult"
	| "error"
>;

export function delegationRecordToFeed(
	record: DelegationRecord,
): DelegationFeedLike {
	return {
		childSessionId: record.childSessionId,
		parentSessionId: record.parentSessionId,
		title: record.title,
		provider: record.provider,
		modelId: record.modelId,
		status: record.status,
		startedAt: record.startedAt,
		completedAt: record.completedAt,
		structuredResult: record.structuredResult,
		error: record.error,
	};
}

export function formatDelegationDuration(
	startedAt: string | null | undefined,
	completedAt: string | null | undefined,
): string | null {
	if (!startedAt || !completedAt) return null;
	const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
	if (Number.isNaN(ms) || ms < 0) return null;
	const secs = Math.round(ms / 1000);
	if (secs < 60) return `${secs}s`;
	return `${Math.floor(secs / 60)}m ${(secs % 60).toString().padStart(2, "0")}s`;
}

export function delegationStatusMeta(status: string) {
	if (status === "succeeded")
		return {
			icon: CheckCircle2,
			className: "text-chart-2",
			label: "Done",
			isRunning: false,
		};
	if (status === "failed" || status === "timeout" || status === "cancelled") {
		const label =
			status === "failed"
				? "Failed"
				: status === "timeout"
					? "Timed out"
					: "Cancelled";
		return {
			icon: XCircle,
			className: "text-destructive",
			label,
			isRunning: false,
		};
	}
	return {
		icon: XCircle,
		className: "text-chart-3",
		label: status === "running" || !status ? "Running..." : status,
		isRunning: true,
	};
}

export function DelegationFeedDialog({
	delegation,
	open,
	onOpenChange,
	onFocusChild,
}: {
	delegation: DelegationFeedLike | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onFocusChild?: (sessionId: string, parentSessionId?: string | null) => void;
}) {
	const query = useQuery({
		...sessionThreadMessagesQueryOptions(
			delegation?.childSessionId ?? "__none__",
		),
		enabled: open && Boolean(delegation?.childSessionId),
	});
	const messages = query.isError ? [] : (query.data ?? []);
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const lastMessage = messages[messages.length - 1] ?? null;

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		viewport.scrollTop = viewport.scrollHeight;
	}, [lastMessage, messages.length, delegation?.status]);

	if (!delegation) {
		return null;
	}

	const meta = delegationStatusMeta(delegation.status);
	const StatusIcon = meta.icon;
	const duration = formatDelegationDuration(
		delegation.startedAt,
		delegation.completedAt,
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[min(86vh,820px)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
				<DialogHeader className="border-b px-4 py-3 pr-12">
					<div className="flex min-w-0 items-center gap-2">
						<Bot className="size-4 shrink-0 text-muted-foreground" />
						<div className="min-w-0 flex-1">
							<DialogTitle className="truncate text-sm">
								{delegation.title}
							</DialogTitle>
							<div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
								<span className="truncate">
									{delegation.provider}
									{delegation.modelId ? ` · ${delegation.modelId}` : ""}
								</span>
								<span>·</span>
								<span className="inline-flex items-center gap-1">
									{meta.isRunning ? (
										<HelmorLogoAnimated
											size={12}
											className={cn("opacity-80", meta.className)}
										/>
									) : (
										<StatusIcon className={cn("size-3", meta.className)} />
									)}
									{meta.label}
								</span>
								{duration ? (
									<>
										<span>·</span>
										<span>{duration}</span>
									</>
								) : null}
							</div>
						</div>
						{onFocusChild ? (
							<Button
								type="button"
								variant="ghost"
								size="xs"
								className="shrink-0 cursor-pointer gap-1"
								onClick={() =>
									onFocusChild(
										delegation.childSessionId,
										delegation.parentSessionId,
									)
								}
							>
								<ExternalLink className="size-3" />
								Open thread
							</Button>
						) : null}
					</div>
				</DialogHeader>
				<div
					ref={viewportRef}
					className="scrollbar-stable max-h-[min(72vh,680px)] overflow-y-auto px-4 py-3"
				>
					{query.isError ? (
						<div className="text-xs text-destructive">
							Failed to load delegated thread.
						</div>
					) : messages.length === 0 ? (
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<HelmorLogoAnimated size={12} className="opacity-70" />
							Waiting for delegated thread...
						</div>
					) : (
						<div className="space-y-3">
							{messages.map((message, index) => {
								const key = message.id ?? `${message.role}:${index}`;
								return (
									<MemoConversationMessage
										key={key}
										message={message}
										previousAssistantMessage={findPreviousAssistantMessage(
											messages,
											index,
										)}
										sessionId={delegation.childSessionId}
										itemIndex={index}
										onFocusChild={onFocusChild}
									/>
								);
							})}
						</div>
					)}
					{delegation.error ? (
						<div className="mt-3 text-xs text-destructive">
							{delegation.error}
						</div>
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function findPreviousAssistantMessage(
	messages: ThreadMessageLike[],
	index: number,
): ThreadMessageLike | null {
	for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
		const candidate = messages[cursor];
		if (candidate?.role === "assistant") return candidate;
	}
	return null;
}
