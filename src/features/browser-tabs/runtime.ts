import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview, type WebviewOptions } from "@tauri-apps/api/webview";
import {
	type BrowserProfileOptions,
	type BrowserWebviewBounds,
	browserGoBack,
	browserGoForward,
	createBrowserWebviewHost,
	openBrowserDevtools,
} from "@/lib/api";
import { browserWebviewLabel } from "./ids";

const MIN_VISIBLE_SIZE = 24;
const FALLBACK_BROWSER_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
const APP_USER_AGENT_TOKENS =
	/\s+(?:Helmor|Tauri|Wry|Electron|tauri)\/[\w.-]+/gi;

export type BrowserWebviewGeometrySource =
	| "create"
	| "resize"
	| "poll"
	| "manual";

export type BrowserWebviewFrame = {
	logical: BrowserWebviewBounds;
	physical: BrowserWebviewBounds;
};

export type BrowserPageViewport = {
	width: number;
	height: number;
	scaleFactor: number;
};

export type BrowserWebviewGeometry = {
	requestedBounds: BrowserWebviewBounds;
	nativeFrame: BrowserWebviewFrame;
	pageViewport: BrowserPageViewport;
	measuredAtMs: number;
	source: BrowserWebviewGeometrySource;
};

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

export function browserWebviewOptions(
	url: string,
	bounds: BrowserWebviewBounds,
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
	profile: BrowserProfileOptions,
): Promise<Webview> {
	const existing = await Webview.getByLabel(label);
	if (existing) {
		await existing.close().catch(() => undefined);
	}

	await createBrowserWebviewHost(
		label,
		url,
		bounds,
		profile,
		browserUserAgent(),
	);
	const webview = await Webview.getByLabel(label);
	if (!webview) {
		throw new Error(`Created browser webview ${label} was not found`);
	}
	return webview;
}

export async function closeBrowserWebviewForTab(tabId: string): Promise<void> {
	const existing = await Webview.getByLabel(browserWebviewLabel(tabId));
	await existing?.close().catch(() => undefined);
}

export async function goBackBrowserWebview(tabId: string): Promise<void> {
	await browserGoBack(tabId);
}

export async function goForwardBrowserWebview(tabId: string): Promise<void> {
	await browserGoForward(tabId);
}

export async function openBrowserWebviewDevtools(tabId: string): Promise<void> {
	await openBrowserDevtools(tabId);
}

export async function positionBrowserWebview(
	webview: Webview,
	bounds: BrowserWebviewBounds,
): Promise<void> {
	await webview.setPosition(new LogicalPosition(bounds.x, bounds.y));
	await webview.setSize(new LogicalSize(bounds.width, bounds.height));
}

function currentScaleFactor(): number {
	if (typeof window === "undefined") return 1;
	const scaleFactor = window.devicePixelRatio;
	return Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
}

function roundGeometryValue(value: number): number {
	return Math.round(value * 100) / 100;
}

function logicalFromPhysical(
	physical: BrowserWebviewBounds,
	scaleFactor: number,
): BrowserWebviewBounds {
	return {
		x: roundGeometryValue(physical.x / scaleFactor),
		y: roundGeometryValue(physical.y / scaleFactor),
		width: roundGeometryValue(physical.width / scaleFactor),
		height: roundGeometryValue(physical.height / scaleFactor),
	};
}

export async function readBrowserWebviewGeometry(
	webview: Pick<Webview, "position" | "size">,
	requestedBounds: BrowserWebviewBounds,
	source: BrowserWebviewGeometrySource,
): Promise<BrowserWebviewGeometry> {
	const scaleFactor = currentScaleFactor();
	try {
		const [position, size] = await Promise.all([
			webview.position(),
			webview.size(),
		]);
		const physical = {
			x: position.x,
			y: position.y,
			width: size.width,
			height: size.height,
		};
		const logical = logicalFromPhysical(physical, scaleFactor);
		return {
			requestedBounds,
			nativeFrame: { logical, physical },
			pageViewport: {
				width: logical.width,
				height: logical.height,
				scaleFactor,
			},
			measuredAtMs: Date.now(),
			source,
		};
	} catch {
		return {
			requestedBounds,
			nativeFrame: {
				logical: requestedBounds,
				physical: {
					x: roundGeometryValue(requestedBounds.x * scaleFactor),
					y: roundGeometryValue(requestedBounds.y * scaleFactor),
					width: roundGeometryValue(requestedBounds.width * scaleFactor),
					height: roundGeometryValue(requestedBounds.height * scaleFactor),
				},
			},
			pageViewport: {
				width: requestedBounds.width,
				height: requestedBounds.height,
				scaleFactor,
			},
			measuredAtMs: Date.now(),
			source,
		};
	}
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
