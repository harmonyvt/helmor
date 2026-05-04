import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview, type WebviewOptions } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { BrowserProfileOptions } from "@/lib/api";
import { browserWebviewLabel } from "./ids";

export type BrowserWebviewBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

const MIN_VISIBLE_SIZE = 24;
const FALLBACK_BROWSER_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
const APP_USER_AGENT_TOKENS =
	/\s+(?:Helmor|Tauri|Wry|Electron|tauri)\/[\w.-]+/gi;

function currentNavigator(): Navigator | null {
	return typeof navigator === "undefined" ? null : navigator;
}

export function browserUserAgent(source?: string): string {
	const rawAgent = source ?? currentNavigator()?.userAgent ?? "";
	const cleanedAgent = rawAgent.replace(APP_USER_AGENT_TOKENS, "").trim();

	if (!cleanedAgent) return FALLBACK_BROWSER_USER_AGENT;
	if (/\bSafari\//.test(cleanedAgent) || /\bChrome\//.test(cleanedAgent)) {
		return cleanedAgent;
	}
	if (/\bAppleWebKit\//.test(cleanedAgent)) {
		return `${cleanedAgent} Version/17.6 Safari/605.1.15`;
	}

	return FALLBACK_BROWSER_USER_AGENT;
}

function supportsRelativeDataDirectory(): boolean {
	const platform = currentNavigator()?.platform ?? "";
	return !/^(Mac|iPhone|iPad|iPod)/i.test(platform);
}

export function browserWebviewOptions(
	url: string,
	bounds: BrowserWebviewBounds,
	profile?: BrowserProfileOptions | null,
): WebviewOptions {
	return {
		url,
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		focus: true,
		acceptFirstMouse: true,
		dragDropEnabled: false,
		javascriptDisabled: false,
		incognito: false,
		userAgent: browserUserAgent(),
		...(profile?.dataStoreIdentifier.length === 16
			? { dataStoreIdentifier: profile.dataStoreIdentifier }
			: {}),
		...(profile?.dataDirectory && supportsRelativeDataDirectory()
			? { dataDirectory: profile.dataDirectory }
			: {}),
	};
}

export function measureBrowserWebviewBounds(
	element: HTMLElement,
): BrowserWebviewBounds {
	const rect = element.getBoundingClientRect();
	return {
		x: Math.max(0, Math.round(rect.left)),
		y: Math.max(0, Math.round(rect.top)),
		width: Math.max(MIN_VISIBLE_SIZE, Math.round(rect.width)),
		height: Math.max(MIN_VISIBLE_SIZE, Math.round(rect.height)),
	};
}

export async function createBrowserWebview(
	label: string,
	url: string,
	bounds: BrowserWebviewBounds,
	profile?: BrowserProfileOptions | null,
): Promise<Webview> {
	const existing = await Webview.getByLabel(label);
	if (existing) {
		await existing.close().catch(() => undefined);
	}

	const webview = new Webview(
		getCurrentWindow(),
		label,
		browserWebviewOptions(url, bounds, profile),
	);

	await new Promise<void>((resolve, reject) => {
		void webview.once("tauri://created", () => resolve());
		void webview.once("tauri://error", (event) => reject(event.payload));
	});
	return webview;
}

export async function closeBrowserWebviewForTab(tabId: string): Promise<void> {
	const existing = await Webview.getByLabel(browserWebviewLabel(tabId));
	await existing?.close().catch(() => undefined);
}

export async function positionBrowserWebview(
	webview: Webview,
	bounds: BrowserWebviewBounds,
): Promise<void> {
	await webview.setPosition(new LogicalPosition(bounds.x, bounds.y));
	await webview.setSize(new LogicalSize(bounds.width, bounds.height));
}

export type BrowserRuntimeMetadataHandlers = {
	onTitleChange?: (title: string | null) => void;
	onLocationChange?: (url: string) => void;
	onLoadStateChange?: (loading: boolean) => void;
};

export type UnlistenBrowserRuntimeMetadata = () => void;

export async function listenBrowserRuntimeMetadata(
	_webview: Webview,
	_handlers: BrowserRuntimeMetadataHandlers,
): Promise<UnlistenBrowserRuntimeMetadata> {
	return () => {};
}
