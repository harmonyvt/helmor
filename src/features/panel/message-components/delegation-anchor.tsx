import { useQuery } from "@tanstack/react-query";
import { Bot, CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { HelmorLogoAnimated } from "@/components/helmor-logo-animated";
import { Button } from "@/components/ui/button";
import type { DelegationAnchorPart } from "@/lib/api";
import { sessionThreadMessagesQueryOptions } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { ChatAssistantMessage } from "./assistant-message";
import { ChatSystemMessage } from "./system-message";
import { ChatUserMessage } from "./user-message";

function formatDuration(
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

function statusMeta(status: string) {
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
		label: status === "running" || !status ? "Running…" : status,
		isRunning: true,
	};
}

export function DelegationAnchor({
	part,
	onFocusChild,
}: {
	part: DelegationAnchorPart;
	onFocusChild?: (sessionId: string) => void;
}) {
	const query = useQuery(
		sessionThreadMessagesQueryOptions(part.childSessionId),
	);
	const messages = query.data ?? [];
	const meta = statusMeta(part.status);
	const StatusIcon = meta.icon;

	return (
		<div className="my-2 rounded-xl border border-border/70 bg-muted/15 p-3 shadow-sm">
			<div className="flex min-w-0 items-center gap-2">
				<Bot
					className="size-4 shrink-0 text-muted-foreground"
					strokeWidth={1.8}
				/>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<span className="truncate text-sm font-medium text-foreground">
							{part.title}
						</span>
						<span className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
							{part.provider}
							{part.modelId ? ` · ${part.modelId}` : ""}
						</span>
					</div>
					<div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
						{meta.isRunning ? (
							<HelmorLogoAnimated
								size={12}
								className={cn("opacity-80", meta.className)}
							/>
						) : (
							<StatusIcon
								className={cn("size-3", meta.className)}
								strokeWidth={1.8}
							/>
						)}
						<span>{meta.label}</span>
						{(() => {
							const dur = formatDuration(part.startedAt, part.completedAt);
							return dur ? <span>· {dur}</span> : null;
						})()}
						{part.structuredResult !== undefined ? (
							<span>· Result available</span>
						) : null}
					</div>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					className="cursor-pointer gap-1"
					onClick={() => onFocusChild?.(part.childSessionId)}
				>
					<ExternalLink className="size-3" strokeWidth={1.8} />
					Open
				</Button>
			</div>
			<div className="mt-3 space-y-2 border-l border-border/60 pl-3">
				{messages.length === 0 ? (
					<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<HelmorLogoAnimated size={12} className="opacity-70" />
						Waiting for delegated thread…
					</div>
				) : (
					messages.map((message, index) => {
						const key = message.id ?? `${message.role}:${index}`;
						if (message.role === "user")
							return <ChatUserMessage key={key} message={message} />;
						if (message.role === "assistant")
							return (
								<ChatAssistantMessage
									key={key}
									message={message}
									streaming={message.streaming === true}
									onFocusChild={onFocusChild}
								/>
							);
						return (
							<ChatSystemMessage
								key={key}
								message={message}
								previousAssistantMessage={null}
							/>
						);
					})
				)}
			</div>
			{part.error ? (
				<div className="mt-2 text-xs text-destructive">{part.error}</div>
			) : null}
		</div>
	);
}
