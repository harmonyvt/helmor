import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import { renderWithProviders } from "@/test/render-with-providers";
import { TabsZoomContext } from "../layout";
import { _resetForTesting } from "../script-store";
import { RunTab } from "./run";

// ── Mocks ────────────────────────────────────────────────────────────────────

const apiMocks = vi.hoisted(() => ({
	executeRepoScript: vi.fn(),
	stopRepoScript: vi.fn(),
	writeRepoScriptStdin: vi.fn(),
	resizeRepoScript: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		executeRepoScript: apiMocks.executeRepoScript,
		stopRepoScript: apiMocks.stopRepoScript,
		writeRepoScriptStdin: apiMocks.writeRepoScriptStdin,
		resizeRepoScript: apiMocks.resizeRepoScript,
	};
});

vi.mock("@/components/terminal-output", () => ({
	TerminalOutput: ({ className }: { className?: string }) => (
		<div data-testid="terminal" className={className} />
	),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaults = {
	repoId: "repo-1",
	workspaceId: "ws-1",
	runScript: "npm test" as string | null,
	isActive: true,
	onOpenSettings: vi.fn(),
};

// The floating Stop/Rerun button only renders while the tabs panel is
// hover-zoomed. Tests exercising that button wrap their tree with this
// provider to simulate the zoomed state; the empty/idle state tests leave
// it off to confirm the default-collapsed behavior.
function ZoomedProvider({ children }: { children: ReactNode }) {
	return (
		<TabsZoomContext.Provider
			value={{ isZoomPresented: true, isHoverExpanded: true }}
		>
			{children}
		</TabsZoomContext.Provider>
	);
}

function renderRun(
	overrides: Partial<typeof defaults> = {},
	{ zoomed = false }: { zoomed?: boolean } = {},
) {
	const props = { ...defaults, ...overrides };
	const tree = (
		<Tabs defaultValue="run">
			<RunTab {...props} />
		</Tabs>
	);
	return renderWithProviders(
		zoomed ? <ZoomedProvider>{tree}</ZoomedProvider> : tree,
	);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("RunTab", () => {
	beforeEach(() => {
		apiMocks.executeRepoScript.mockReset().mockResolvedValue(undefined);
		apiMocks.stopRepoScript.mockReset().mockResolvedValue(true);
		apiMocks.writeRepoScriptStdin.mockReset().mockResolvedValue(true);
		apiMocks.resizeRepoScript.mockReset().mockResolvedValue(true);
	});

	afterEach(() => {
		_resetForTesting();
		vi.restoreAllMocks();
		cleanup();
	});

	// ── Empty / idle states ────────────────────────────────────────────────

	it("shows empty state when no script is configured", () => {
		renderRun({ runScript: null });

		expect(
			screen.getByRole("button", { name: /add run script/i }),
		).toBeInTheDocument();
	});

	it("shows 'Run' button when script exists but hasn't run yet", () => {
		renderRun();

		expect(screen.getByRole("button", { name: /^run$/i })).toBeInTheDocument();
	});

	// ── Run / stop / rerun ─────────────────────────────────────────────────

	it("clicking 'Run' calls executeRepoScript with workspace id", async () => {
		const user = userEvent.setup();
		renderRun();

		await user.click(screen.getByRole("button", { name: /^run$/i }));

		expect(apiMocks.executeRepoScript).toHaveBeenCalledWith(
			"repo-1",
			"run",
			expect.any(Function),
			"ws-1",
			"ws-1",
			undefined,
		);
	});

	it("shows Stop button while running (when zoomed)", async () => {
		const user = userEvent.setup();
		renderRun({}, { zoomed: true });

		await user.click(screen.getByRole("button", { name: /^run$/i }));

		expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
	});

	it("Stop button calls stopRepoScript with workspace id", async () => {
		const user = userEvent.setup();
		renderRun({}, { zoomed: true });

		await user.click(screen.getByRole("button", { name: /^run$/i }));
		await user.click(screen.getByRole("button", { name: /stop/i }));

		expect(apiMocks.stopRepoScript).toHaveBeenCalledWith(
			"repo-1",
			"run",
			"ws-1",
			"ws-1",
		);
	});

	it("shows 'Rerun' button after script exits (when zoomed)", async () => {
		const user = userEvent.setup();

		let onEvent: (e: unknown) => void = () => {};
		apiMocks.executeRepoScript.mockImplementation(
			(_r: string, _t: string, cb: (e: unknown) => void) => {
				onEvent = cb;
				return Promise.resolve();
			},
		);

		renderRun({}, { zoomed: true });
		await user.click(screen.getByRole("button", { name: /^run$/i }));

		onEvent({ type: "exited", code: 0 });

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /rerun/i }),
			).toBeInTheDocument();
		});
	});

	it("does not show any floating button when idle and not yet run", () => {
		renderRun();

		expect(
			screen.queryByRole("button", { name: /stop/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /rerun/i }),
		).not.toBeInTheDocument();
	});

	it("hides the floating Stop button until the panel is zoomed", async () => {
		const user = userEvent.setup();
		renderRun();

		await user.click(screen.getByRole("button", { name: /^run$/i }));

		expect(screen.getByTestId("terminal")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /stop/i }),
		).not.toBeInTheDocument();
	});
});
