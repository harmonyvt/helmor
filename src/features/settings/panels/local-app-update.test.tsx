import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInstallEvent, HelmorAppInstallResult } from "@/lib/api";
import { WorkspaceToastProvider } from "@/lib/workspace-toast-context";

const apiMocks = vi.hoisted(() => ({
	cancelHelmorAppInstall: vi.fn(),
	getHelmorAppUpdateStatus: vi.fn(),
	runHelmorAppInstall: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		cancelHelmorAppInstall: apiMocks.cancelHelmorAppInstall,
		getHelmorAppUpdateStatus: apiMocks.getHelmorAppUpdateStatus,
		runHelmorAppInstall: apiMocks.runHelmorAppInstall,
	};
});

import { LocalAppUpdatePanel } from "./local-app-update";
import { resetLocalAppInstallStoreForTests } from "./local-app-update-store";

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
		apiMocks.getHelmorAppUpdateStatus.mockReset();
		apiMocks.runHelmorAppInstall.mockReset();
	});

	afterEach(() => {
		cleanup();
		resetLocalAppInstallStoreForTests();
		vi.clearAllMocks();
	});

	it("shows streamed progress and an inline restart notice after installing an update", async () => {
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
		render(
			<WorkspaceToastProvider value={pushToast}>
				<LocalAppUpdatePanel />
			</WorkspaceToastProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Install Update" }));

		expect(await screen.findByText("Update installed")).toBeInTheDocument();
		expect(screen.getByText(/1 of 10 steps complete/)).toBeInTheDocument();
		expect(screen.getByText("v0.12.3")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Diagnostics log" }));
		expect(screen.getByText(/Already up to date/)).toBeInTheDocument();
		expect(
			screen.getByText("Restart Helmor to start using the installed update."),
		).toBeInTheDocument();
		expect(pushToast).not.toHaveBeenCalled();
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

	it("treats either cancellation spelling as cancelled", async () => {
		const user = userEvent.setup();
		apiMocks.runHelmorAppInstall.mockImplementation(
			async (onEvent: (event: AppInstallEvent) => void) => {
				onEvent({
					type: "error",
					stepId: "buildApp",
					message: "Install canceled by user",
				});
				throw new Error("Install cancelled by user");
			},
		);

		render(
			<WorkspaceToastProvider value={vi.fn()}>
				<LocalAppUpdatePanel />
			</WorkspaceToastProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Install Update" }));

		expect(await screen.findByText("Update cancelled")).toBeInTheDocument();
		expect(screen.queryByText("Update failed")).not.toBeInTheDocument();
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

	it("keeps in-flight progress visible after the settings panel remounts", async () => {
		const user = userEvent.setup();
		const pushToast = vi.fn();
		const deferred: {
			resolve?: (result: HelmorAppInstallResult) => void;
		} = {};
		let emitInstallEvent: ((event: AppInstallEvent) => void) | undefined;
		apiMocks.runHelmorAppInstall.mockImplementation(
			(onEvent: (event: AppInstallEvent) => void) => {
				emitInstallEvent = onEvent;
				onEvent({
					type: "stepStarted",
					stepId: "buildApp",
					label: "Building production app",
				});
				onEvent({
					type: "output",
					stepId: "buildApp",
					stream: "stdout",
					data: "Compiling frontend bundle\n",
				});
				return new Promise<HelmorAppInstallResult>((resolve) => {
					deferred.resolve = resolve;
				});
			},
		);

		const firstRender = render(
			<WorkspaceToastProvider value={pushToast}>
				<LocalAppUpdatePanel />
			</WorkspaceToastProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Install Update" }));
		expect(
			await screen.findByText("Compiling frontend bundle"),
		).toBeInTheDocument();
		firstRender.unmount();

		render(
			<WorkspaceToastProvider value={pushToast}>
				<LocalAppUpdatePanel />
			</WorkspaceToastProvider>,
		);

		expect(
			screen.getAllByText("Building production app").length,
		).toBeGreaterThan(0);
		expect(screen.getByText("Compiling frontend bundle")).toBeInTheDocument();
		expect(apiMocks.runHelmorAppInstall).toHaveBeenCalledTimes(1);

		expect(emitInstallEvent).toBeDefined();
		emitInstallEvent?.({
			type: "stepFinished",
			stepId: "buildApp",
			status: "ok",
			message: null,
		});
		deferred.resolve?.(installResult());

		expect(await screen.findByText("Update installed")).toBeInTheDocument();
	});
});
