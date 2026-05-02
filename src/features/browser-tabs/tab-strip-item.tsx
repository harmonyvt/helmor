import { Globe, X } from "lucide-react";
import type { BrowserTabRecord } from "@/lib/api";
import { cn } from "@/lib/utils";
import { browserToolTabId } from "./ids";

type BrowserTabStripItemProps = {
	tab: BrowserTabRecord;
	index: number;
	activeTab: string;
	onSelect: (tabId: string) => void;
	onClose: (tabId: string) => void;
};

export function BrowserTabStripItem({
	tab,
	index,
	activeTab,
	onSelect,
	onClose,
}: BrowserTabStripItemProps) {
	const label = tab.title?.trim() || `Browser ${index + 1}`;
	const tabActiveId = browserToolTabId(tab.id);
	const isActive = activeTab === tabActiveId;

	return (
		<div
			role="tab"
			id={`inspector-tab-browser-${tab.id}`}
			aria-controls={`inspector-panel-browser-${tab.id}`}
			aria-selected={isActive}
			tabIndex={isActive ? 0 : -1}
			className={cn(
				"group/tab relative flex h-full min-w-[6rem] shrink-0 transform-gpu cursor-pointer items-center overflow-hidden px-3 text-[12px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-0",
				isActive && "text-foreground",
			)}
			onClick={() => onSelect(tabActiveId)}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onSelect(tabActiveId);
				}
			}}
		>
			<span className="terminal-tab-fade flex min-w-0 flex-1 items-center justify-center gap-1.5">
				<Globe className="size-3 shrink-0" strokeWidth={1.8} />
				<span className="truncate">{label}</span>
			</span>
			<button
				type="button"
				aria-label={`Close ${label}`}
				onClick={(event) => {
					event.stopPropagation();
					onClose(tab.id);
				}}
				className="pointer-events-none invisible absolute inset-y-0 right-0 flex w-3 cursor-pointer items-center justify-center text-muted-foreground/70 hover:text-foreground group-hover/tab:pointer-events-auto group-hover/tab:visible focus-visible:pointer-events-auto focus-visible:visible"
			>
				<X className="size-3" strokeWidth={2} />
			</button>
			<span
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-foreground opacity-0 transition-opacity",
					isActive && "opacity-100",
				)}
			/>
		</div>
	);
}
