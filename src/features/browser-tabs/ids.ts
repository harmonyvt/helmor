const BROWSER_TAB_PREFIX = "browser:";
const WEBVIEW_LABEL_PREFIX = "helmor_browser_";

export function browserToolTabId(tabId: string): string {
	return `${BROWSER_TAB_PREFIX}${tabId}`;
}

export function browserIdFromToolTabId(tabId: string): string | null {
	return tabId.startsWith(BROWSER_TAB_PREFIX)
		? tabId.slice(BROWSER_TAB_PREFIX.length)
		: null;
}

export function browserWebviewLabel(tabId: string): string {
	return `${WEBVIEW_LABEL_PREFIX}${tabId.replaceAll("-", "_")}`;
}
