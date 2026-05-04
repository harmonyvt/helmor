import { GitBranch, LayoutGrid, MessageSquare } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import type { MobileTab } from "./mobile-shell";

interface MobileBottomNavProps {
	activeTab: MobileTab;
	onTabChange: (tab: MobileTab) => void;
	hasUnread?: boolean;
}

interface TabConfig {
	id: MobileTab;
	label: string;
	icon: React.ElementType;
}

const TABS: TabConfig[] = [
	{ id: "workspaces", label: "Workspaces", icon: LayoutGrid },
	{ id: "thread", label: "Thread", icon: MessageSquare },
	{ id: "inspector", label: "Inspector", icon: GitBranch },
];

export function MobileBottomNav({
	activeTab,
	onTabChange,
	hasUnread = false,
}: MobileBottomNavProps) {
	return (
		<div
			className="shrink-0 border-t border-border bg-sidebar"
			style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
		>
			<div className="flex h-[49px] items-stretch">
				{TABS.map(({ id, label, icon: Icon }) => {
					const isActive = activeTab === id;
					const isThread = id === "thread";

					return (
						<button
							key={id}
							type="button"
							onClick={() => onTabChange(id)}
							className={cn(
								"relative flex min-h-[44px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 transition-colors",
								"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
							)}
							aria-label={label}
							aria-pressed={isActive}
						>
							<div className="relative">
								<Icon
									className={cn(
										"h-5 w-5",
										isActive ? "text-foreground" : "text-muted-foreground",
									)}
								/>
								{isThread && hasUnread && (
									<span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
								)}
							</div>
							<span
								className={cn(
									"text-[11px] leading-none",
									isActive
										? "font-medium text-foreground"
										: "text-muted-foreground",
								)}
							>
								{label}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
