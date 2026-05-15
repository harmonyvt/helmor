import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { HelmorLogoAnimated } from "@/components/helmor-logo-animated";
import type { DelegationAnchorPart } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	DelegationFeedDialog,
	delegationStatusMeta,
	formatDelegationDuration,
} from "./delegation-feed-dialog";

export function DelegationAnchor({
	part,
	onFocusChild,
}: {
	part: DelegationAnchorPart;
	onFocusChild?: (sessionId: string, parentSessionId?: string | null) => void;
}) {
	const [feedOpen, setFeedOpen] = useState(false);
	const meta = delegationStatusMeta(part.status);
	const StatusIcon = meta.icon;
	const duration = formatDelegationDuration(part.startedAt, part.completedAt);
	const modelTag = part.modelId
		? `${part.provider} · ${part.modelId}`
		: part.provider;

	return (
		<>
			<button
				type="button"
				aria-label={`View delegation: ${part.title}`}
				className="my-1.5 flex w-full cursor-pointer items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/25"
				onClick={() => setFeedOpen(true)}
			>
				{/* Status indicator */}
				{meta.isRunning ? (
					<HelmorLogoAnimated
						size={13}
						className={cn("shrink-0 opacity-80", meta.className)}
					/>
				) : (
					<StatusIcon
						className={cn("size-3.5 shrink-0", meta.className)}
						strokeWidth={2}
					/>
				)}

				{/* Title — truncated single line */}
				<span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-none text-foreground/90">
					{part.title}
				</span>

				{/* Metadata cluster: model tag · duration */}
				<span className="flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground/70">
					<span className="hidden sm:inline">{modelTag}</span>
					{duration ? (
						<>
							<span className="hidden sm:inline">·</span>
							<span>{duration}</span>
						</>
					) : null}
				</span>

				{/* Chevron affordance */}
				<ChevronRight
					className="size-3 shrink-0 text-muted-foreground/40"
					strokeWidth={2}
				/>
			</button>
			<DelegationFeedDialog
				delegation={part}
				open={feedOpen}
				onOpenChange={setFeedOpen}
				onFocusChild={onFocusChild}
			/>
		</>
	);
}
