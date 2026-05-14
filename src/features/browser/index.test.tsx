import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSurface } from ".";

const browserTabHandlers = vi.hoisted(() => ({
	handleAddTab: vi.fn(),
	handleCloseTab: vi.fn(),
	handleSelectTab: vi.fn(),
}));

const browserTabsState = vi.hoisted(() => ({
	tabs: [] as {
		id: string;
		title: string | null;
		url: string;
		active: boolean;
	}[],
	activeTabId: null as string | null,
}));

const browserRuntimeMocks = vi.hoisted(() => {
	const webview = {
		hide: vi.fn(async () => {}),
		position: vi.fn(async () => ({ x: 20, y: 40 })),
		setFocus: vi.fn(async () => {}),
		setPosition: vi.fn(async () => {}),
		setSize: vi.fn(async () => {}),
		show: vi.fn(async () => {}),
		size: vi.fn(async () => ({ width: 640, height: 480 })),
	};
	return {
		createBrowserWebview: vi.fn(async () => webview),
		goBackBrowserWebview: vi.fn(async () => {}),
		goForwardBrowserWebview: vi.fn(async () => {}),
		measureBrowserWebviewBounds: vi.fn(() => ({
			x: 10,
			y: 20,
			width: 320,
			height: 240,
		})),
		openBrowserWebviewDevtools: vi.fn(async () => {}),
		positionBrowserWebview: vi.fn(async () => {}),
		readBrowserWebviewGeometry: vi.fn(async (_webview, bounds, source) => ({
			requestedBounds: bounds,
			nativeFrame: {
				logical: { x: 10, y: 20, width: 320, height: 240 },
				physical: { x: 20, y: 40, width: 640, height: 480 },
			},
			pageViewport: { width: 320, height: 240, scaleFactor: 2 },
			measuredAtMs: 123,
			source,
		})),
		webview,
	};
});

const apiMocks = vi.hoisted(() => ({
	getBrowserTabProfile: vi.fn(async (tabId: string) => ({
		workspaceId: "workspace-1",
		tabId,
		dataDirectory: "profile",
		dataStoreIdentifier: Array.from({ length: 16 }, () => 1),
	})),
	navigateBrowserTab: vi.fn(async () => ({ id: "tab-1" })),
}));

vi.mock("./hooks/use-browser-tabs", () => ({
	useBrowserTabs: () => ({
		tabs: browserTabsState.tabs,
		activeTabId: browserTabsState.activeTabId,
		...browserTabHandlers,
	}),
}));

vi.mock("@/features/browser-tabs/runtime", () => browserRuntimeMocks);

vi.mock("@/lib/api", () => apiMocks);

describe("BrowserSurface", () => {
	beforeEach(() => {
		browserTabsState.tabs = [];
		browserTabsState.activeTabId = null;
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("renders browser chrome without requiring an external tooltip provider", () => {
		render(
			<BrowserSurface
				workspaceId="workspace-1"
				session={{ activeTabId: null }}
				onChangeSession={vi.fn()}
				onExit={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("region", { name: "Browser surface" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "New browser tab" }),
		).toBeInTheDocument();
	});

	it("discloses native frame and page viewport dimensions to React", async () => {
		browserTabsState.tabs = [
			{
				id: "tab-1",
				title: "Example",
				url: "https://example.com",
				active: true,
			},
		];
		browserTabsState.activeTabId = "tab-1";

		render(
			<BrowserSurface
				workspaceId="workspace-1"
				session={{ activeTabId: "tab-1" }}
				onChangeSession={vi.fn()}
				onExit={vi.fn()}
			/>,
		);

		const panel = screen.getByLabelText("Browser tab tab-1");
		const host = panel.firstElementChild as HTMLElement;

		await waitFor(() => {
			expect(host).toHaveAttribute("data-browser-webview-source", "create");
		});
		expect(host).toHaveAttribute("data-browser-webview-width", "320");
		expect(host).toHaveAttribute("data-browser-webview-height", "240");
		expect(host).toHaveAttribute("data-browser-page-viewport-width", "320");
		expect(host).toHaveAttribute("data-browser-page-viewport-height", "240");
		expect(browserRuntimeMocks.createBrowserWebview).toHaveBeenCalledWith(
			"helmor_browser_tab_1",
			"https://example.com",
			{ x: 10, y: 20, width: 320, height: 240 },
			expect.objectContaining({ tabId: "tab-1" }),
		);
		expect(browserRuntimeMocks.positionBrowserWebview).toHaveBeenCalledWith(
			browserRuntimeMocks.webview,
			{ x: 10, y: 20, width: 320, height: 240 },
		);
	});
});
