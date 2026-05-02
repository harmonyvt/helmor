import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserTabRecord } from "@/lib/api";
import { navigateBrowserTab } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	browserWebviewLabel,
	createBrowserWebview,
	measureBrowserWebviewBounds,
	positionBrowserWebview,
} from "../browser-webview-runtime";

type BrowserTabPanelProps = {
	tab: BrowserTabRecord;
	isActive: boolean;
};

function displayOrigin(url: string): string {
	try {
		return new URL(url).origin;
	} catch {
		return url;
	}
}

export function BrowserTabPanel({ tab, isActive }: BrowserTabPanelProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const webviewRef = useRef<Awaited<
		ReturnType<typeof createBrowserWebview>
	> | null>(null);
	const [address, setAddress] = useState(tab.url);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nativeReady, setNativeReady] = useState(false);
	const label = useMemo(() => browserWebviewLabel(tab.id), [tab.id]);

	useEffect(() => {
		setAddress(tab.url);
	}, [tab.url]);

	useEffect(() => {
		if (!isActive) return;
		let disposed = false;
		let resizeObserver: ResizeObserver | null = null;
		let intervalId: number | null = null;

		async function mount() {
			const host = hostRef.current;
			if (!host) return;
			setIsLoading(true);
			setError(null);
			try {
				const webview = await createBrowserWebview(
					label,
					tab.url,
					measureBrowserWebviewBounds(host),
				);
				if (disposed) {
					await webview.hide().catch(() => undefined);
					return;
				}
				webviewRef.current = webview;
				setNativeReady(true);
				setIsLoading(false);
				void webview.setFocus().catch(() => undefined);
				resizeObserver = new ResizeObserver(() => {
					if (!hostRef.current || !webviewRef.current) return;
					void positionBrowserWebview(
						webviewRef.current,
						measureBrowserWebviewBounds(hostRef.current),
					).catch(() => undefined);
				});
				resizeObserver.observe(host);
				intervalId = window.setInterval(() => {
					if (!hostRef.current || !webviewRef.current) return;
					void positionBrowserWebview(
						webviewRef.current,
						measureBrowserWebviewBounds(hostRef.current),
					).catch(() => undefined);
				}, 500);
			} catch (mountError) {
				if (!disposed) {
					setNativeReady(false);
					setIsLoading(false);
					setError(
						mountError instanceof Error
							? mountError.message
							: String(mountError),
					);
				}
			}
		}

		void mount();

		return () => {
			disposed = true;
			resizeObserver?.disconnect();
			if (intervalId !== null) window.clearInterval(intervalId);
			const webview = webviewRef.current;
			webviewRef.current = null;
			setNativeReady(false);
			if (webview) void webview.hide().catch(() => undefined);
		};
	}, [isActive, label, tab.url]);

	const handleSubmit = useCallback(
		(event: React.FormEvent) => {
			event.preventDefault();
			void navigateBrowserTab(tab.id, address).catch((submitError) => {
				setError(
					submitError instanceof Error
						? submitError.message
						: String(submitError),
				);
			});
		},
		[address, tab.id],
	);

	return (
		<div
			id={`inspector-panel-browser-${tab.id}`}
			role="tabpanel"
			aria-labelledby={`inspector-tab-browser-${tab.id}`}
			hidden={!isActive}
			className="relative flex min-h-0 flex-1 flex-col bg-app-base"
		>
			<form
				onSubmit={handleSubmit}
				className="relative z-10 flex h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-sidebar px-2"
			>
				<div className="min-w-0 shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
					{displayOrigin(tab.url)}
				</div>
				<input
					aria-label="Browser address"
					value={address}
					onChange={(event) => setAddress(event.target.value)}
					className="h-6 min-w-0 flex-1 rounded border border-border/60 bg-background px-2 text-[12px] text-foreground outline-none focus:border-ring"
					spellCheck={false}
				/>
				<button
					type="submit"
					className="h-6 shrink-0 cursor-pointer rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
					disabled={isLoading}
				>
					Go
				</button>
			</form>
			<div ref={hostRef} className="relative min-h-0 flex-1 overflow-hidden">
				<div
					className={cn(
						"absolute inset-0 flex items-center justify-center bg-app-base text-[12px] text-muted-foreground",
						nativeReady && !error && "opacity-0",
					)}
				>
					{isLoading ? (
						<span className="inline-flex items-center gap-2">
							<Loader2 className="size-3.5 animate-spin" /> Loading browser…
						</span>
					) : error ? (
						<div className="max-w-sm px-4 text-center">
							<div className="mb-1 font-medium text-foreground">
								Native browser unavailable
							</div>
							<div>{error}</div>
						</div>
					) : (
						"Browser ready"
					)}
				</div>
			</div>
		</div>
	);
}
