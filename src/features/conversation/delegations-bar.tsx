import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Loader2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DelegationRecord } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	DelegationFeedDialog,
	delegationRecordToFeed,
	delegationStatusMeta,
} from "../panel/message-components/delegation-feed-dialog";

type DelegationsBarProps = {
	delegations: readonly DelegationRecord[];
	onFocusChild?: (sessionId: string, parentSessionId?: string | null) => void;
};

function StatusIcon({
	status,
	size = "sm",
}: {
	status: string;
	size?: "sm" | "xs";
}) {
	const meta = delegationStatusMeta(status);
	const cls = size === "xs" ? "size-2.5" : "size-3";
	if (meta.isRunning) {
		return (
			<Loader2
				className={cn(cls, "shrink-0 animate-spin text-foreground/70")}
			/>
		);
	}
	if (status === "succeeded") {
		return (
			<CheckCircle2
				className={cn(
					cls,
					"shrink-0 text-[color:var(--workspace-sidebar-status-progress)]",
				)}
			/>
		);
	}
	if (status === "failed" || status === "timeout" || status === "cancelled") {
		return <AlertTriangle className={cn(cls, "shrink-0 text-destructive")} />;
	}
	return <Bot className={cn(cls, "shrink-0 text-muted-foreground/50")} />;
}

function DelegationChip({
	delegation,
	onSelect,
}: {
	delegation: DelegationRecord;
	onSelect: () => void;
}) {
	const running = delegationStatusMeta(delegation.status).isRunning;
	return (
		<button
			type="button"
			title={delegation.title}
			onClick={(event) => {
				event.stopPropagation();
				onSelect();
			}}
			className={cn(
				"relative flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full transition-opacity hover:opacity-70",
				running ? "bg-foreground/10" : "bg-muted/40",
			)}
		>
			{running ? (
				<span className="absolute inset-0 animate-ping rounded-full bg-foreground/20 opacity-60" />
			) : null}
			<StatusIcon status={delegation.status} size="xs" />
		</button>
	);
}

function DelegationRow({
	delegation,
	onSelect,
}: {
	delegation: DelegationRecord;
	onSelect: () => void;
}) {
	const meta = delegationStatusMeta(delegation.status);
	return (
		<button
			type="button"
			onClick={onSelect}
			className="group flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent/50"
		>
			<StatusIcon status={delegation.status} />
			<span className="min-w-0 flex-1 truncate text-[12px] text-foreground/80">
				{delegation.title}
			</span>
			<span className="shrink-0 truncate text-[10px] text-muted-foreground/60">
				{delegation.provider}
			</span>
			<span
				className={cn(
					"shrink-0 text-[10px] tabular-nums",
					meta.isRunning && "text-foreground/60",
					delegation.status === "succeeded" &&
						"text-[color:var(--workspace-sidebar-status-progress)]",
					(delegation.status === "failed" ||
						delegation.status === "timeout" ||
						delegation.status === "cancelled") &&
						"text-destructive",
				)}
			>
				{meta.label}
			</span>
		</button>
	);
}

export function DelegationsBar({
	delegations,
	onFocusChild,
}: DelegationsBarProps) {
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = useMemo(
		() =>
			delegations.find((delegation) => delegation.id === selectedId) ?? null,
		[delegations, selectedId],
	);
	const runningCount = delegations.filter(
		(delegation) => delegationStatusMeta(delegation.status).isRunning,
	).length;

	if (delegations.length === 0) return null;

	return (
		<>
			<div className="mb-2 overflow-hidden rounded-lg border border-border/50 bg-sidebar/50">
				<button
					type="button"
					onClick={() => setIsCollapsed((value) => !value)}
					className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors hover:bg-accent/30"
				>
					<span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
						Delegates
					</span>
					{isCollapsed ? (
						<div className="ml-1 flex items-center gap-1">
							{delegations.map((delegation) => (
								<DelegationChip
									key={delegation.id}
									delegation={delegation}
									onSelect={() => setSelectedId(delegation.id)}
								/>
							))}
						</div>
					) : null}
					<span className="ml-auto rounded-full bg-muted/60 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground/60">
						{runningCount > 0
							? `${runningCount}/${delegations.length}`
							: delegations.length}
					</span>
					{isCollapsed ? (
						<ChevronDown className="size-3 shrink-0 text-muted-foreground/50" />
					) : (
						<ChevronUp className="size-3 shrink-0 text-muted-foreground/50" />
					)}
				</button>
				<div
					className={cn(
						"grid transition-[grid-template-rows] duration-200",
						isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
					)}
				>
					<div className="overflow-hidden">
						<div className="max-h-44 overflow-y-auto border-t border-border/30 pb-1">
							{delegations.map((delegation) => (
								<DelegationRow
									key={delegation.id}
									delegation={delegation}
									onSelect={() => setSelectedId(delegation.id)}
								/>
							))}
						</div>
					</div>
				</div>
			</div>
			<DelegationFeedDialog
				delegation={selected ? delegationRecordToFeed(selected) : null}
				open={selected !== null}
				onOpenChange={(open) => {
					if (!open) setSelectedId(null);
				}}
				onFocusChild={onFocusChild}
			/>
		</>
	);
}
