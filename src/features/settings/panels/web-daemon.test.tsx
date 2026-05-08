import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
	cleanupWebDaemon: vi.fn(),
	getWebDaemonStatus: vi.fn(),
	startWebDaemon: vi.fn(),
	stopWebDaemon: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		cleanupWebDaemon: apiMocks.cleanupWebDaemon,
		getWebDaemonStatus: apiMocks.getWebDaemonStatus,
		startWebDaemon: apiMocks.startWebDaemon,
		stopWebDaemon: apiMocks.stopWebDaemon,
	};
});

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
	},
}));

import { WebDaemonPanel } from "./web-daemon";

const stoppedStatus = {
	state: "stopped" as const,
	pid: null,
	url: "http://127.0.0.1:17778",
	openUrl: "http://127.0.0.1:17778",
	reachableUrls: ["http://127.0.0.1:17778"],
	host: "127.0.0.1",
	listenHost: "127.0.0.1",
	port: 17778,
	dataDir: "/Users/harmony/helmor-dev",
	frontendDir: "/repo/dist-web",
	frontendExists: true,
	identity: "development",
	command: "cargo run --bin helmor-web",
	startedAtMs: null,
	lastError: null,
};

const runningStatus = {
	...stoppedStatus,
	state: "running" as const,
	pid: 123,
	startedAtMs: 1,
};

describe("WebDaemonPanel", () => {
	beforeEach(() => {
		apiMocks.cleanupWebDaemon.mockReset();
		apiMocks.getWebDaemonStatus.mockReset();
		apiMocks.startWebDaemon.mockReset();
		apiMocks.stopWebDaemon.mockReset();
	});

	it("starts in network tailnet mode when selected", async () => {
		const user = userEvent.setup();
		apiMocks.getWebDaemonStatus.mockResolvedValue(stoppedStatus);
		apiMocks.startWebDaemon.mockResolvedValue({
			...runningStatus,
			url: "http://100.118.99.70:17778",
			openUrl: "http://100.118.99.70:17778",
			reachableUrls: ["http://100.118.99.70:17778", "http://127.0.0.1:17778"],
			host: "0.0.0.0",
			listenHost: "0.0.0.0",
		});

		render(<WebDaemonPanel />);

		await screen.findByText("Stopped");
		await user.click(screen.getByRole("button", { name: /Network\/Tailnet/i }));
		expect(
			screen.getByText(/exposes the unauthenticated web API/i),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Start" }));

		await waitFor(() =>
			expect(apiMocks.startWebDaemon).toHaveBeenCalledWith({
				host: "0.0.0.0",
			}),
		);
		await waitFor(() =>
			expect(
				screen.getAllByText(/http:\/\/100\.118\.99\.70:17778/).length,
			).toBeGreaterThan(0),
		);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it("cleans up the current daemon instance", async () => {
		const user = userEvent.setup();
		apiMocks.getWebDaemonStatus.mockResolvedValue(stoppedStatus);
		apiMocks.cleanupWebDaemon.mockResolvedValue(stoppedStatus);

		render(<WebDaemonPanel />);

		await screen.findByText("Stopped");
		await user.click(screen.getByRole("button", { name: "Cleanup" }));

		await waitFor(() =>
			expect(apiMocks.cleanupWebDaemon).toHaveBeenCalledTimes(1),
		);
		expect(screen.getByText(/clears stale runtime state/i)).toBeInTheDocument();
	});

	it("does not poll status while start is in progress", async () => {
		const user = userEvent.setup();
		let intervalCallback: TimerHandler | null = null;
		vi.spyOn(window, "setInterval").mockImplementation((handler) => {
			intervalCallback = handler;
			return 1 as unknown as ReturnType<typeof window.setInterval>;
		});
		vi.spyOn(window, "clearInterval").mockImplementation(() => {});
		let resolveStart: (status: typeof runningStatus) => void = () => {};
		apiMocks.getWebDaemonStatus.mockResolvedValue(stoppedStatus);
		apiMocks.startWebDaemon.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveStart = resolve;
				}),
		);

		render(<WebDaemonPanel />);

		await screen.findByText("Stopped");
		expect(apiMocks.getWebDaemonStatus).toHaveBeenCalledTimes(1);

		await user.click(screen.getByRole("button", { name: "Start" }));
		await waitFor(() =>
			expect(apiMocks.startWebDaemon).toHaveBeenCalledTimes(1),
		);
		await act(async () => {
			if (typeof intervalCallback === "function") {
				intervalCallback();
			}
		});

		expect(apiMocks.getWebDaemonStatus).toHaveBeenCalledTimes(1);

		resolveStart(runningStatus);
		await screen.findByText("Running");
	});
});
