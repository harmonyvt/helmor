import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type BrowserWebviewBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

const WEBVIEW_LABEL_PREFIX = "helmor_browser_";
const MIN_VISIBLE_SIZE = 24;

export function browserWebviewLabel(tabId: string): string {
	return `${WEBVIEW_LABEL_PREFIX}${tabId.replaceAll("-", "_")}`;
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
): Promise<Webview> {
	const existing = await Webview.getByLabel(label);
	if (existing) {
		await existing.close().catch(() => undefined);
	}

	const webview = new Webview(getCurrentWindow(), label, {
		url,
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		focus: true,
		acceptFirstMouse: true,
		dragDropEnabled: false,
	});

	await new Promise<void>((resolve, reject) => {
		void webview.once("tauri://created", () => resolve());
		void webview.once("tauri://error", (event) => reject(event.payload));
	});
	return webview;
}

export async function closeBrowserWebview(label: string): Promise<void> {
	const existing = await Webview.getByLabel(label);
	await existing?.close().catch(() => undefined);
}

export async function positionBrowserWebview(
	webview: Webview,
	bounds: BrowserWebviewBounds,
): Promise<void> {
	await webview.setPosition(new LogicalPosition(bounds.x, bounds.y));
	await webview.setSize(new LogicalSize(bounds.width, bounds.height));
}
