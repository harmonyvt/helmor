import { Bot } from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { GoalPiPhysicalState } from "./types";

type GoalPiChipProps = {
	piState: GoalPiPhysicalState;
	unreadCount?: number;
	/** When set, labels the tooltip with the goal name (used in workspace header). */
	goalTitle?: string | null;
	disabled?: boolean;
	onClick: () => void;
	className?: string;
};

/**
 * Compact chip that represents the Pi AI surface in either the goal board
 * header or the child workspace header. Visual state tracks piState:
 *
 *  - "panel" / "sheet"  → filled background (Pi is open)
 *  - "dock"             → ghost (Pi is minimised)
 *
 * An unread badge replaces the status dot when Pi has sent messages while
 * minimised.
 */
export function GoalPiChip({
	piState,
	unreadCount = 0,
	goalTitle,
	disabled = false,
	onClick,
	className,
}: GoalPiChipProps) {
	const isOpen = piState === "panel" || piState === "sheet";

	const tooltipLabel = isOpen
		? "Minimise Pi"
		: goalTitle
			? `Open Pi · ${goalTitle}`
			: "Open Pi";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={onClick}
					disabled={disabled}
					aria-label={tooltipLabel}
					aria-pressed={isOpen}
					className={cn(
						"relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[min(var(--radius-md),10px)] border px-2 text-[12px] font-medium transition-colors",
						isOpen
							? "border-border bg-accent text-foreground"
							: "border-border/60 bg-transparent text-muted-foreground hover:border-border hover:bg-accent/40 hover:text-foreground",
						disabled && "pointer-events-none opacity-40",
						className,
					)}
				>
					<Bot className="size-3.5 shrink-0" strokeWidth={1.8} />
					<span>Pi</span>

					{/* Unread badge or status dot */}
					{unreadCount > 0 ? (
						<span
							aria-label={`${unreadCount} unread`}
							className="flex h-4 min-w-4 items-center justify-center rounded-full bg-chart-2 px-1 text-[10px] font-semibold text-white"
						>
							{unreadCount > 9 ? "9+" : unreadCount}
						</span>
					) : (
						<span
							aria-hidden
							className={cn(
								"size-1.5 rounded-full transition-colors",
								isOpen ? "bg-chart-2" : "bg-muted-foreground/30",
							)}
						/>
					)}
				</button>
			</TooltipTrigger>
			<TooltipContent
				side="bottom"
				sideOffset={4}
				className="flex h-[22px] items-center rounded-md px-1.5 text-[11px] leading-none"
			>
				{tooltipLabel}
			</TooltipContent>
		</Tooltip>
	);
}
