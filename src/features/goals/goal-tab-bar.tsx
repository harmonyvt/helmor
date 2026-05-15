import {
	Activity,
	GitBranch,
	GitFork,
	LayoutGrid,
	MessageSquare,
	Plus,
	Terminal,
	Users,
} from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";
import type { GoalTabView } from "./types";

type TabDef = {
	id: GoalTabView;
	label: string;
	icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

const GOAL_TABS: TabDef[] = [
	{ id: "board", label: "Board", icon: LayoutGrid },
	{ id: "changes", label: "Changes", icon: GitBranch },
	{ id: "comments", label: "Comments", icon: MessageSquare },
	{ id: "branch-tree", label: "Branches", icon: GitFork },
	{ id: "team", label: "Team", icon: Users },
	{ id: "timeline", label: "Timeline", icon: Activity },
	{ id: "terminal", label: "Terminal", icon: Terminal },
];

type GoalTabBarProps = {
	activeTab: GoalTabView;
	onTabChange: (tab: GoalTabView) => void;
	canCreateCards?: boolean;
	onAddCard: () => void;
	/** Optional count badges keyed by tab id. Shown as a small pill next to the tab label. */
	tabBadges?: Partial<Record<GoalTabView, number>>;
};

export function GoalTabBar({
	activeTab,
	onTabChange,
	canCreateCards = false,
	onAddCard,
	tabBadges,
}: GoalTabBarProps) {
	return (
		<div
			role="tablist"
			aria-label="Goal views"
			className="flex shrink-0 items-center justify-between border-b border-border/60 px-3"
		>
			<div className="flex items-center">
				{GOAL_TABS.map((tab) => {
					const Icon = tab.icon;
					const isActive = activeTab === tab.id;
					const badge = tabBadges?.[tab.id] ?? 0;
					return (
						<button
							key={tab.id}
							role="tab"
							type="button"
							aria-selected={isActive}
							onClick={() => onTabChange(tab.id)}
							className={cn(
								"relative flex h-9 cursor-pointer items-center gap-1.5 px-2.5 text-[12px] font-medium transition-colors",
								isActive
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							<Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
							<span>{tab.label}</span>
							{badge > 0 && (
								<span className="inline-flex min-w-[14px] items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--workspace-pr-conflicts-accent)_15%,transparent)] px-1 py-px text-[9px] font-semibold tabular-nums text-[var(--workspace-pr-conflicts-accent)]">
									{badge > 99 ? "99+" : badge}
								</span>
							)}
							{isActive && (
								<span
									aria-hidden="true"
									className="absolute inset-x-0 bottom-0 h-[2px] rounded-t-full bg-foreground"
								/>
							)}
						</button>
					);
				})}
			</div>

			<div className="flex items-center gap-1.5 py-1">
				<button
					type="button"
					onClick={onAddCard}
					disabled={!canCreateCards}
					title={
						canCreateCards
							? "Add card"
							: "Goal setup must finish before adding cards"
					}
					className={cn(
						"inline-flex h-7 cursor-pointer items-center gap-1 rounded-[min(var(--radius-md),10px)] border border-border/60 px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground",
						!canCreateCards && "pointer-events-none opacity-40",
					)}
				>
					<Plus className="size-3.5" />
					Add
				</button>
			</div>
		</div>
	);
}
