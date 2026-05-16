/**
 * Content-part renderers for the Goals AI panel.
 *
 * Handles every `ExtendedMessagePart` variant: thinking (reasoning),
 * tool-call, text, system-notice, and collapsed-group.
 */
import {
	AlertCircle,
	ChevronDown,
	ChevronRight,
	Info,
	Wrench,
} from "lucide-react";
import { Suspense, useState } from "react";
import {
	AssigneeReportNotificationBlock,
	parseAssigneeReportNotification,
} from "@/components/ai/assignee-report-notification";
import { LazyStreamdown } from "@/components/streamdown-loader";
import type {
	CollapsedGroupPart,
	ExtendedMessagePart,
	ReasoningPart,
	SystemNoticePart,
	TextPart,
	ToolCallPart,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function ContentParts({ parts }: { parts: ExtendedMessagePart[] }) {
	return (
		<div className="flex flex-col gap-1.5">
			{parts.map((part) => (
				<PartSwitch key={partKey(part)} part={part} />
			))}
		</div>
	);
}

function partKey(part: ExtendedMessagePart): string {
	if (part.type === "tool-call") return part.toolCallId;
	if (part.type === "plan-review") return part.toolUseId;
	if (part.type === "collapsed-group") return part.id;
	return part.id;
}

function PartSwitch({ part }: { part: ExtendedMessagePart }) {
	switch (part.type) {
		case "text":
			return <TextBlock part={part} />;
		case "reasoning":
			return <ThinkingBlock part={part} />;
		case "tool-call":
			return <ToolCallBlock part={part} />;
		case "system-notice":
			return <SystemNoticeBlock part={part} />;
		case "collapsed-group":
			return <CollapsedGroupBlock part={part} />;
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function TextBlock({ part }: { part: TextPart }) {
	if (!part.text.trim()) return null;
	if (parseAssigneeReportNotification(part.text)) {
		return <AssigneeReportNotificationBlock text={part.text} />;
	}

	return (
		<div className="conversation-markdown assistant-markdown-scale max-w-none break-words text-[12.5px] leading-relaxed text-foreground">
			<Suspense fallback={<TextFallback text={part.text} />}>
				<LazyStreamdown className="conversation-streamdown" mode="static">
					{part.text}
				</LazyStreamdown>
			</Suspense>
		</div>
	);
}

function TextFallback({ text }: { text: string }) {
	return (
		<div className="conversation-streamdown whitespace-pre-wrap break-words">
			{text}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Thinking / Reasoning
// ---------------------------------------------------------------------------

function ThinkingBlock({ part }: { part: ReasoningPart }) {
	const isStreaming = part.streaming === true;
	const [open, setOpen] = useState(isStreaming);

	const durationLabel =
		part.durationMs != null ? `${(part.durationMs / 1000).toFixed(1)}s` : null;

	return (
		<div className="rounded-md border border-amber-500/20 bg-amber-500/5">
			<button
				type="button"
				className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left"
				onClick={() => setOpen((o) => !o)}
			>
				<span
					className={cn(
						"size-1.5 rounded-full shrink-0",
						isStreaming ? "bg-amber-400 animate-pulse" : "bg-amber-500/60",
					)}
				/>
				<span className="flex-1 text-[11px] font-medium text-amber-600/90 dark:text-amber-400/90">
					{isStreaming ? "Thinking…" : "Thought"}
					{durationLabel && (
						<span className="ml-1 text-[10px] font-normal text-amber-500/60">
							{durationLabel}
						</span>
					)}
				</span>
				{!isStreaming &&
					(open ? (
						<ChevronDown className="size-3 text-amber-500/50" />
					) : (
						<ChevronRight className="size-3 text-amber-500/50" />
					))}
			</button>

			{open && part.text && (
				<div className="border-t border-amber-500/10 px-2.5 py-2">
					<p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-amber-700/80 dark:text-amber-300/60">
						{part.text}
					</p>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Tool call
// ---------------------------------------------------------------------------

const KANBAN_TOOL_LABELS: Record<string, string> = {
	list_kanban_cards: "List cards",
	create_kanban_card: "Create card",
	move_kanban_card: "Move card",
	update_kanban_card: "Update card",
	send_assignee_message: "Message assignee",
	read_assignee_thread: "Read assignee",
	summarize_assignee_status: "Summarize assignee",
	list_assignees: "List assignees",
	inspect_workspace_merge_state: "Inspect merge",
	refresh_change_request: "Refresh PR",
	sync_workspace_target_branch: "Sync branch",
	push_workspace_branch: "Push branch",
	merge_change_request: "Merge PR",
	check_workspace_landed: "Check landed",
	mark_workspace_landed: "Mark landed",
};

/**
 * Extract a short human-readable detail from tool arguments for the
 * collapsed tool-call summary. Returns null when nothing useful is available.
 */
function getToolCallDetail(
	toolName: string,
	args: Record<string, unknown>,
): string | null {
	function s(v: unknown): string | null {
		return typeof v === "string" && v.trim() ? v.trim() : null;
	}
	const cardId = s(args.cardId) ?? s(args.card_id);
	switch (toolName) {
		case "send_assignee_message": {
			const msg = s(args.message);
			if (msg) return msg.length > 48 ? `${msg.slice(0, 48)}…` : msg;
			return cardId;
		}
		case "read_assignee_thread":
		case "summarize_assignee_status":
			return cardId;
		case "list_assignees":
			return s(args.status);
		default:
			return null;
	}
}

function toolStatusIcon(status?: string, isError?: boolean) {
	if (isError) return <span className="text-destructive">✕</span>;
	if (!status || status === "done")
		return <span className="text-emerald-500">✓</span>;
	if (status === "running" || status === "streaming_input")
		return (
			<span className="size-1.5 rounded-full bg-blue-400 animate-pulse inline-block" />
		);
	return (
		<span className="size-1.5 rounded-full bg-muted-foreground/40 inline-block" />
	);
}

function ToolCallBlock({ part }: { part: ToolCallPart }) {
	const [open, setOpen] = useState(false);
	const label = KANBAN_TOOL_LABELS[part.toolName] ?? part.toolName;
	const detail = getToolCallDetail(part.toolName, part.args);
	const isRunning =
		part.streamingStatus === "running" ||
		part.streamingStatus === "streaming_input" ||
		part.streamingStatus === "pending";

	return (
		<div className="rounded-md border border-border/50 bg-muted/30">
			<button
				type="button"
				className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left"
				onClick={() => setOpen((o) => !o)}
			>
				<Wrench className="size-3 shrink-0 text-muted-foreground/60" />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-[11.5px] font-medium text-foreground/80">
						{label}
					</span>
					{detail ? (
						<span className="truncate text-[10px] text-muted-foreground/50">
							{detail}
						</span>
					) : part.toolName !== label ? (
						<span className="font-mono text-[9.5px] text-muted-foreground/50">
							{part.toolName}
						</span>
					) : null}
				</span>
				<span className="shrink-0 text-[11px]">
					{toolStatusIcon(part.streamingStatus, part.isError)}
				</span>
				{!isRunning &&
					(open ? (
						<ChevronDown className="size-3 text-muted-foreground/40" />
					) : (
						<ChevronRight className="size-3 text-muted-foreground/40" />
					))}
			</button>

			{open && (
				<div className="border-t border-border/40 px-2.5 py-2 space-y-1.5">
					{/* Args */}
					{Object.keys(part.args).length > 0 && (
						<div>
							<p className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground/50">
								Input
							</p>
							<pre className="overflow-x-auto rounded bg-muted/50 px-2 py-1.5 text-[10.5px] leading-relaxed text-foreground/70">
								{JSON.stringify(part.args, null, 2)}
							</pre>
						</div>
					)}
					{/* Result */}
					{part.result !== undefined && (
						<div>
							<p className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground/50">
								Output
							</p>
							<pre
								className={cn(
									"overflow-x-auto rounded px-2 py-1.5 text-[10.5px] leading-relaxed",
									part.isError
										? "bg-destructive/10 text-destructive"
										: "bg-muted/50 text-foreground/70",
								)}
							>
								{typeof part.result === "string"
									? part.result
									: JSON.stringify(part.result, null, 2)}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// System notice
// ---------------------------------------------------------------------------

const SEVERITY_STYLES = {
	info: "border-blue-500/20 bg-blue-500/5 text-blue-600/80 dark:text-blue-400/80",
	warning:
		"border-amber-500/20 bg-amber-500/5 text-amber-600/80 dark:text-amber-400/80",
	error: "border-destructive/20 bg-destructive/5 text-destructive/80",
};

function SystemNoticeBlock({ part }: { part: SystemNoticePart }) {
	const Icon = part.severity === "error" ? AlertCircle : Info;
	const styles = SEVERITY_STYLES[part.severity] ?? SEVERITY_STYLES.info;

	return (
		<div className={cn("flex gap-1.5 rounded-md border px-2.5 py-2", styles)}>
			<Icon className="mt-px size-3 shrink-0" />
			<div className="min-w-0">
				<p className="text-[11.5px] font-medium leading-snug">{part.label}</p>
				{part.body && (
					<p className="mt-0.5 text-[10.5px] leading-relaxed opacity-80">
						{part.body}
					</p>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Collapsed group
// ---------------------------------------------------------------------------

function CollapsedGroupBlock({ part }: { part: CollapsedGroupPart }) {
	const [open, setOpen] = useState(false);

	return (
		<div className="rounded-md border border-border/40 bg-muted/20">
			<button
				type="button"
				className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left"
				onClick={() => setOpen((o) => !o)}
			>
				<Wrench className="size-3 shrink-0 text-muted-foreground/50" />
				<span className="flex-1 text-[11px] text-muted-foreground/70">
					{part.summary}
				</span>
				{open ? (
					<ChevronDown className="size-3 text-muted-foreground/40" />
				) : (
					<ChevronRight className="size-3 text-muted-foreground/40" />
				)}
			</button>

			{open && (
				<div className="border-t border-border/30 px-2.5 py-2 space-y-1">
					{part.tools.map((tool) => (
						<ToolCallBlock key={tool.toolCallId} part={tool} />
					))}
				</div>
			)}
		</div>
	);
}
