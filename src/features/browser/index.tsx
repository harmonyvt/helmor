import {
	ArrowLeftIcon,
	ArrowRightIcon,
	GlobeIcon,
	PlusIcon,
	SquareTerminalIcon,
	XIcon,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { TrafficLightSpacer } from "@/components/chrome/traffic-light-spacer";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { browserWebviewLabel } from "@/features/browser-tabs/ids";
import {
	createBrowserWebview,
	goBackBrowserWebview,
	goForwardBrowserWebview,
	measureBrowserWebviewBounds,
	openBrowserWebviewDevtools,
	positionBrowserWebview,
} from "@/features/browser-tabs/runtime";
import { ShortcutDisplay } from "@/features/shortcuts/shortcut-display";
import { getBrowserTabProfile, navigateBrowserTab } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { BrowserSessionState } from "./browser-session";
import { useBrowserTabs } from "./hooks/use-browser-tabs";

type BrowserSurfaceProps = {
	workspaceId: string;
	session: BrowserSessionState;
	onChangeSession: (session: BrowserSessionState) => void;
	onExit: () => void;
};

export function BrowserSurface({
	workspaceId,
	session,
	onChangeSession,
	onExit,
}: BrowserSurfaceProps) {
	const { tabs, activeTabId, handleAddTab, handleSelectTab, handleCloseTab } =
		useBrowserTabs({ workspaceId, session, onChangeSession });

	const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

	return (
		<TooltipProvider delayDuration={0}>
			<section
				aria-label="Browser surface"
				data-focus-scope="browser"
				className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
			>
				<BrowserChrome
					tabs={tabs}
					activeTabId={activeTabId}
					activeUrl={activeTab?.url ?? ""}
					onSelectTab={handleSelectTab}
					onCloseTab={handleCloseTab}
					onAddTab={handleAddTab}
					onExit={onExit}
				/>
				<div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
					{tabs.length === 0 ? (
						<BrowserEmptyState onAddTab={handleAddTab} />
					) : (
						tabs.map((tab) => (
							<BrowserTabPanel
								key={tab.id}
								tabId={tab.id}
								url={tab.url}
								isActive={tab.id === activeTabId}
							/>
						))
					)}
				</div>
			</section>
		</TooltipProvider>
	);
}

// ---------------------------------------------------------------------------
// Chrome bar
// ---------------------------------------------------------------------------

type BrowserChromeProps = {
	tabs: { id: string; title: string | null; url: string }[];
	activeTabId: string | null;
	activeUrl: string;
	onSelectTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onAddTab: () => void;
	onExit: () => void;
};

function BrowserChrome({
	tabs,
	activeTabId,
	activeUrl,
	onSelectTab,
	onCloseTab,
	onAddTab,
	onExit,
}: BrowserChromeProps) {
	const [address, setAddress] = useState(activeUrl);
	const activeTabIdRef = useRef(activeTabId);

	// Keep address bar in sync when the active tab changes.
	useLayoutEffect(() => {
		if (activeTabId !== activeTabIdRef.current || activeUrl !== address) {
			setAddress(activeUrl);
		}
		activeTabIdRef.current = activeTabId;
	}, [activeTabId, activeUrl]); // eslint-disable-line react-hooks/exhaustive-deps

	const handleNavigate = useCallback(
		(event: React.FormEvent) => {
			event.preventDefault();
			if (!activeTabId) return;
			let url = address.trim();
			if (url && !url.includes("://") && !url.startsWith("about:")) {
				url = `https://${url}`;
			}
			void navigateBrowserTab(activeTabId, url).catch(() => undefined);
		},
		[activeTabId, address],
	);

	const handleGoBack = useCallback(() => {
		if (!activeTabId) return;
		void goBackBrowserWebview(activeTabId).catch(() => undefined);
	}, [activeTabId]);

	const handleGoForward = useCallback(() => {
		if (!activeTabId) return;
		void goForwardBrowserWebview(activeTabId).catch(() => undefined);
	}, [activeTabId]);

	const handleOpenDevtools = useCallback(() => {
		if (!activeTabId) return;
		void openBrowserWebviewDevtools(activeTabId).catch(() => undefined);
	}, [activeTabId]);

	return (
		<div
			className="flex h-9 shrink-0 items-stretch border-b border-border/60 bg-sidebar"
			data-tauri-drag-region
		>
			<TrafficLightSpacer side="left" width={86} />

			{/* Tab strip */}
			<div
				className="scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
				data-tauri-drag-region
			>
				{tabs.map((tab, index) => {
					const isActive = tab.id === activeTabId;
					const label = tab.title?.trim() || `Browser ${index + 1}`;
					return (
						<button
							key={tab.id}
							type="button"
							role="tab"
							aria-selected={isActive}
							onClick={() => onSelectTab(tab.id)}
							className={cn(
								"group/tab relative flex h-full min-w-[96px] max-w-[160px] shrink-0 cursor-pointer items-center gap-1.5 overflow-hidden px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-0",
								isActive
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							<GlobeIcon
								className="size-3 shrink-0 opacity-60"
								strokeWidth={1.8}
							/>
							<span className="min-w-0 flex-1 truncate text-left">{label}</span>
							<span
								aria-label={`Close ${label}`}
								role="button"
								tabIndex={-1}
								onClick={(e) => {
									e.stopPropagation();
									onCloseTab(tab.id);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										e.stopPropagation();
										onCloseTab(tab.id);
									}
								}}
								className="invisible ml-auto flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/60 hover:text-foreground group-hover/tab:visible"
							>
								<XIcon className="size-3" strokeWidth={2} />
							</span>
							<span
								aria-hidden="true"
								className={cn(
									"pointer-events-none absolute inset-x-0 bottom-0 h-px bg-foreground opacity-0 transition-opacity",
									isActive && "opacity-100",
								)}
							/>
						</button>
					);
				})}
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label="New browser tab"
							onClick={onAddTab}
							className="flex h-full w-8 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
						>
							<PlusIcon className="size-3.5" strokeWidth={1.8} />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom" className="text-[12px]">
						New tab
					</TooltipContent>
				</Tooltip>
			</div>

			{/* Separator */}
			<div className="mx-2 my-2 w-px bg-border/60" />

			{/* Address bar + nav */}
			<form
				onSubmit={handleNavigate}
				className="flex shrink-0 items-center gap-1 pr-2"
				style={{ width: "min(520px, 44%)" }}
			>
				<BrowserChromeIconButton
					label="Back"
					disabled={!activeTabId}
					onClick={handleGoBack}
				>
					<ArrowLeftIcon className="size-3.5" strokeWidth={1.8} />
				</BrowserChromeIconButton>
				<BrowserChromeIconButton
					label="Forward"
					disabled={!activeTabId}
					onClick={handleGoForward}
				>
					<ArrowRightIcon className="size-3.5" strokeWidth={1.8} />
				</BrowserChromeIconButton>
				<input
					aria-label="Browser address"
					value={address}
					onChange={(e) => setAddress(e.target.value)}
					onFocus={(e) => e.currentTarget.select()}
					disabled={!activeTabId}
					placeholder="Enter URL"
					spellCheck={false}
					className="h-6 min-w-0 flex-1 rounded-md border border-transparent bg-background/70 px-2.5 text-[12px] text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors focus:border-border hover:border-border/60 disabled:opacity-40"
				/>
				<BrowserChromeIconButton
					label="Open dev console"
					disabled={!activeTabId}
					onClick={handleOpenDevtools}
				>
					<SquareTerminalIcon className="size-3.5" strokeWidth={1.8} />
				</BrowserChromeIconButton>
			</form>

			{/* Exit */}
			<div className="flex shrink-0 items-center pr-1.5">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onExit}
					aria-label="Exit browser"
					className="gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-foreground"
				>
					<ShortcutDisplay hotkey="Escape" />
					<XIcon className="size-3.5" strokeWidth={1.8} />
				</Button>
			</div>

			<TrafficLightSpacer side="right" width={140} />
		</div>
	);
}

function BrowserChromeIconButton({
	label,
	disabled,
	onClick,
	children,
}: {
	label: string;
	disabled: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					disabled={disabled}
					onClick={onClick}
					aria-label={label}
					className="text-muted-foreground hover:text-foreground"
				>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="text-[12px]">
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

// ---------------------------------------------------------------------------
// Individual tab panel — mounts/hides native WebView
// ---------------------------------------------------------------------------

type BrowserTabPanelProps = {
	tabId: string;
	url: string;
	isActive: boolean;
};

type WebviewInstance = Awaited<ReturnType<typeof createBrowserWebview>>;

function BrowserTabPanel({ tabId, url, isActive }: BrowserTabPanelProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const webviewRef = useRef<WebviewInstance | null>(null);
	const latestUrlRef = useRef(url);
	const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
		"idle",
	);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const label = useMemo(() => browserWebviewLabel(tabId), [tabId]);

	useEffect(() => {
		latestUrlRef.current = url;
	}, [url]);

	useEffect(() => {
		if (!isActive) return;
		let disposed = false;
		let resizeObserver: ResizeObserver | null = null;
		let pollId: number | null = null;

		async function mount() {
			const host = hostRef.current;
			if (!host) return;
			setStatus("loading");
			setErrorMsg(null);
			try {
				let webview = webviewRef.current;
				if (webview) {
					await webview.show().catch(() => undefined);
					await positionBrowserWebview(
						webview,
						measureBrowserWebviewBounds(host),
					);
				} else {
					const profile = await getBrowserTabProfile(tabId);
					if (disposed) return;
					webview = await createBrowserWebview(
						label,
						latestUrlRef.current,
						measureBrowserWebviewBounds(host),
						profile,
					);
				}
				if (disposed) {
					await webview.hide().catch(() => undefined);
					return;
				}
				webviewRef.current = webview;
				setStatus("ready");
				void webview.setFocus().catch(() => undefined);

				const reposition = () => {
					if (!hostRef.current || !webviewRef.current) return;
					void positionBrowserWebview(
						webviewRef.current,
						measureBrowserWebviewBounds(hostRef.current),
					).catch(() => undefined);
				};

				resizeObserver = new ResizeObserver(reposition);
				resizeObserver.observe(host);
				// Re-measure immediately after setup: the webview was created during
				// async awaits (getBrowserTabProfile + createBrowserWebview), so the
				// layout may have shifted (inspector appeared, window resized, etc.)
				// by the time we get here. The ResizeObserver only fires on *changes*,
				// so without this call the stale bounds persist until the 500ms poll.
				reposition();
				pollId = window.setInterval(reposition, 500);
			} catch (err) {
				if (!disposed) {
					setStatus("error");
					setErrorMsg(err instanceof Error ? err.message : String(err));
				}
			}
		}

		void mount();

		return () => {
			disposed = true;
			resizeObserver?.disconnect();
			if (pollId !== null) window.clearInterval(pollId);
			const wv = webviewRef.current;
			setStatus("idle");
			if (wv) void wv.hide().catch(() => undefined);
		};
	}, [isActive, label, tabId]);

	return (
		<div
			hidden={!isActive}
			className="absolute inset-0 flex flex-col"
			aria-label={`Browser tab ${tabId}`}
		>
			<div ref={hostRef} className="relative min-h-0 flex-1 overflow-hidden">
				{status !== "ready" && (
					<div className="absolute inset-0 flex items-center justify-center bg-background">
						{status === "error" ? (
							<div className="max-w-xs space-y-1 px-6 text-center">
								<p className="text-[13px] font-medium text-foreground">
									Browser unavailable
								</p>
								<p className="text-[12px] text-muted-foreground">{errorMsg}</p>
							</div>
						) : status === "loading" ? (
							<p className="text-[12px] text-muted-foreground">Loading…</p>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function BrowserEmptyState({ onAddTab }: { onAddTab: () => void }) {
	return (
		<div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
			<GlobeIcon
				className="size-8 text-muted-foreground/30"
				strokeWidth={1.2}
			/>
			<p className="text-[13px] text-muted-foreground">No browser tabs open</p>
			<button
				type="button"
				onClick={onAddTab}
				className="cursor-pointer rounded-md border border-border/60 px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			>
				Open a tab
			</button>
		</div>
	);
}
