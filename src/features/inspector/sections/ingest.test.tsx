import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render-with-providers";
import { IngestTab } from "./ingest";

const apiMocks = vi.hoisted(() => ({
	clearDebugIngestEntries: vi.fn(),
	readDebugIngestEntries: vi.fn(),
	subscribeDebugIngest: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	Channel: class Channel<T> {
		onmessage?: (value: T) => void;
	},
	invoke: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		clearDebugIngestEntries: apiMocks.clearDebugIngestEntries,
		readDebugIngestEntries: apiMocks.readDebugIngestEntries,
		subscribeDebugIngest: apiMocks.subscribeDebugIngest,
	};
});

describe("IngestTab", () => {
	beforeEach(() => {
		apiMocks.clearDebugIngestEntries.mockResolvedValue(undefined);
		apiMocks.readDebugIngestEntries.mockResolvedValue([]);
		apiMocks.subscribeDebugIngest.mockResolvedValue({
			workspaceId: "workspace-1",
			running: true,
			url: "http://127.0.0.1:4321",
			ingestUrl: "http://127.0.0.1:4321/ingest",
			host: "127.0.0.1",
			port: 4321,
			entryCount: 0,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
		cleanup();
	});

	it("renders status, urls, entries, and clear action", async () => {
		apiMocks.readDebugIngestEntries.mockResolvedValue([
			{
				id: "entry-1",
				workspaceId: "workspace-1",
				receivedAt: "2026-05-10T00:00:00Z",
				payload: {
					level: "info",
					source: "vitest",
					message: "Captured console failure",
				},
			},
		]);

		renderWithProviders(
			<IngestTab
				workspaceId="workspace-1"
				isActive
				state={{
					active: true,
					starting: false,
					status: {
						workspaceId: "workspace-1",
						running: true,
						url: "http://127.0.0.1:4321",
						ingestUrl: "http://127.0.0.1:4321/ingest",
						host: "127.0.0.1",
						port: 4321,
						entryCount: 0,
					},
					error: null,
				}}
			/>,
		);

		expect(screen.getByText("Running on localhost")).toBeInTheDocument();
		expect(screen.getByText("POST / GET / DELETE")).toBeInTheDocument();
		await screen.findByText("Captured console failure");
		fireEvent.click(screen.getByRole("button", { name: /clear/i }));
		await waitFor(() =>
			expect(apiMocks.clearDebugIngestEntries).toHaveBeenCalledWith(
				"workspace-1",
			),
		);
	});

	it("renders failed-start state", () => {
		renderWithProviders(
			<IngestTab
				workspaceId="workspace-1"
				isActive
				state={{
					active: true,
					starting: false,
					status: null,
					error: "port bind failed",
				}}
			/>,
		);

		expect(screen.getByText("Startup failed")).toBeInTheDocument();
		expect(screen.getByText("port bind failed")).toBeInTheDocument();
	});
});
