import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSurface } from ".";

const browserTabHandlers = vi.hoisted(() => ({
	handleAddTab: vi.fn(),
	handleCloseTab: vi.fn(),
	handleSelectTab: vi.fn(),
}));

vi.mock("./hooks/use-browser-tabs", () => ({
	useBrowserTabs: () => ({
		tabs: [],
		activeTabId: null,
		...browserTabHandlers,
	}),
}));

describe("BrowserSurface", () => {
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
});
