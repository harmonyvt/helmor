import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInstallEvent, HelmorAppInstallResult } from "@/lib/api";
import { WorkspaceToastProvider } from "@/lib/workspace-toast-context";

const apiMocks = vi.hoisted(() => ({
	cancelHelmorAppInstall: vi.fn(),
	restartApp: vi.fn(),
	runHelmorAppInstall: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		cancelHelmorAppInstall: apiMocks.cancelHelmorAppInstall,
		restartApp: apiMocks.restartApp,
		runHelmorAppInstall: apiMocks.runHelmorAppInstall,
	};
});

import { LocalAppUpdatePanel } from "./local-app-update";

const installResult = (): HelmorAppInstallResult => ({
	repoRoot: "/Users/harmony/helmor",
	installedAppPath: "/Applications/Helmor.app",
	restartRequired: true,
	pullStdout: "Already up to date.\n",
	pullStderr: "",
	stdout: "0.12.3\nai.helmor.desktop\n150M\n",
	stderr: "",
	version: "0.12.3",
	bundleId: "ai.helmor.desktop",
	size: "150M",
	signingWarning: null,
});

describe("LocalAppUpdatePanel", () => {
	beforeEach(() => {
		apiMocks.cancelHelmorAppInstall.mockReset();
		apiMocks.restartApp.mockReset();
		apiMocks.runHelmorAppInstall.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("shows streamed progress and a persistent restart toast after installing an update", async () => {
		const user = userEvent.setup();
		const pushToast = vi.fn();
		apiMocks.runHelmorAppInstall.mockImplementation(
			async (onEvent: (event: AppInstallEvent) => void) => {
				onEvent({
					type: "started",
					repoRoot: "/Users/harmony/helmor",
					installedAppPath: "/Applications/Helmor.app",
				});
				onEvent({
					type: "stepStarted",
					stepId: "pullRepo",
					label: "Pulling latest changes",
				});
				onEvent({
					type: "output",
					stepId: "pullRepo",
					stream: "stdout",
					data: "Already up to date.\n",
				});
				onEvent({
					type: "stepFinished",
					stepId: "pullRepo",
					status: "ok",
					message: null,
				});
				return installResult();
			},
		);
		apiMocks.restartApp.mockResolvedValue(undefined);

		render(
			<WorkspaceToastProvider value={pushToast}>
				<LocalAppUpdatePanel />
			</WorkspaceToastProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Install Update" }));

		expect(await screen.findByText("Update installed")).toBeInTheDocument();
		expect(screen.getByText(/1 of 9 steps complete/)).toBeInTheDocument();
		expect(screen.getByText("v0.12.3")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Diagnostics log" }));
		expect(screen.getByText(/Already up to date/)).toBeInTheDocument();

		await waitFor(() => {
			expect(pushToast).toHaveBeenCalledWith(
				"The new app has been installed. Restart Helmor to start using it.",
				"Restart required",
				"default",
				expect.objectContaining({
					persistent: true,
					action: expect.objectContaining({ label: "Restart now" }),
				}),
			);
		});

		const toastOptions = pushToast.mock.calls[0]?.[3];
		toastOptions.action.onClick();
		expect(apiMocks.restartApp).toHaveBeenCalledWith(true);
	});

	it("keeps failed update details visible", async () => {
		const user = userEvent.setup();
		apiMocks.runHelmorAppInstall.mockImplementation(
			async (onEvent: (event: AppInstallEvent) => void) => {
				onEvent({
					type: "stepStarted",
					stepId: "buildApp",
					label: "Building production app",
				});
				onEvent({
					type: "error",
					stepId: "buildApp",
					message: "Build failed",
				});
				throw new Error("Build failed");
			},
		);

		render(
			<WorkspaceToastProvider value={vi.fn()}>
				<LocalAppUpdatePanel />
			</WorkspaceToastProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Install Update" }));

		expect(await screen.findByText("Update failed")).toBeInTheDocument();
		expect(screen.getAllByText("Build failed").length).toBeGreaterThan(0);
		expect(
			screen.getByRole("button", { name: "Install Update" }),
		).toBeEnabled();
	});

	it("cancels an in-flight install", async () => {
		const user = userEvent.setup();
		const deferred: {
			resolve?: (result: HelmorAppInstallResult) => void;
		} = {};
		apiMocks.runHelmorAppInstall.mockImplementation(
			(onEvent: (event: AppInstallEvent) => void) => {
				onEvent({
					type: "stepStarted",
					stepId: "buildApp",
					label: "Building production app",
				});
				return new Promise<HelmorAppInstallResult>((resolve) => {
					deferred.resolve = resolve;
				});
			},
		);
		apiMocks.cancelHelmorAppInstall.mockResolvedValue(true);

		render(
			<WorkspaceToastProvider value={vi.fn()}>
				<LocalAppUpdatePanel />
			</WorkspaceToastProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Install Update" }));
		expect(await screen.findAllByText("Building production app")).toHaveLength(
			2,
		);

		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(apiMocks.cancelHelmorAppInstall).toHaveBeenCalledTimes(1);

		expect(deferred.resolve).toBeDefined();
		deferred.resolve?.(installResult());
	});
});
