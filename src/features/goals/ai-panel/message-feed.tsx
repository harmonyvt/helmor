/**
 * Message feed — renders the scrollable list of ThreadMessageLike objects
 * and the streaming indicator. Each message is rendered as a user bubble
 * (right-aligned) or an assistant block (full-width, content-typed).
 */
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ThreadMessageLike } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ContentParts } from "./content-parts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageFeedProps = {
	messages: ThreadMessageLike[];
	streaming: boolean;
	children?: React.ReactNode; // Pi UI interaction cards slot
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MessageFeed({
	messages,
	streaming,
	children,
}: MessageFeedProps) {
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages, children]);

	const hasContent = messages.length > 0 || streaming;

	return (
		<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
			{!hasContent && <EmptyState />}

			<div className="flex flex-col gap-3">
				{messages.map((msg) => (
					<MessageRow key={msg.id ?? Math.random()} message={msg} />
				))}

				{/* Pi UI interaction cards (select / confirm / input) */}
				{children}

				{streaming && !children && <StreamingIndicator />}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
	return (
		<div className="flex h-full min-h-[120px] items-center justify-center">
			<p className="px-4 text-center text-[12px] text-muted-foreground/50 leading-relaxed">
				Ask Pi to create cards, move tasks, or describe what needs to be built.
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Streaming indicator
// ---------------------------------------------------------------------------

function StreamingIndicator() {
	return (
		<div className="flex items-center gap-2 px-0.5 text-[11.5px] text-muted-foreground/60">
			<Loader2 className="size-3 animate-spin" />
			<span>Pi is working…</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Message row
// ---------------------------------------------------------------------------

function MessageRow({ message }: { message: ThreadMessageLike }) {
	const isUser = message.role === "user";

	if (isUser) {
		return <UserMessage message={message} />;
	}

	// System messages rendered inline (usually notices)
	if (message.role === "system" || message.role === "error") {
		return <SystemMessageRow message={message} />;
	}

	// Assistant messages: render content parts directly
	return <AssistantMessage message={message} />;
}

// ---------------------------------------------------------------------------
// User message bubble
// ---------------------------------------------------------------------------

function UserMessage({ message }: { message: ThreadMessageLike }) {
	const text = extractUserText(message);
	if (!text) return null;

	return (
		<div className="flex justify-end">
			<div className="max-w-[88%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-[12.5px] leading-relaxed text-primary-foreground">
				<p className="whitespace-pre-wrap break-words">{text}</p>
			</div>
		</div>
	);
}

function extractUserText(msg: ThreadMessageLike): string {
	for (const part of msg.content) {
		if (part.type === "text") return part.text;
	}
	return "";
}

// ---------------------------------------------------------------------------
// Assistant message
// ---------------------------------------------------------------------------

function AssistantMessage({ message }: { message: ThreadMessageLike }) {
	if (message.content.length === 0) return null;

	return (
		<div className={cn("flex flex-col", message.streaming && "opacity-95")}>
			<ContentParts parts={message.content} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// System / error message
// ---------------------------------------------------------------------------

function SystemMessageRow({ message }: { message: ThreadMessageLike }) {
	if (message.content.length === 0) return null;
	return (
		<div className="flex flex-col">
			<ContentParts parts={message.content} />
		</div>
	);
}
