import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resetLocalAppInstallStoreForTests } from "@/features/settings/panels/local-app-update-store";
import type { HelmorAppInstallResult, HelmorAppUpdateStatus } from "@/lib/api";
import { WorkspaceToastProvider } from "@/lib/workspace-toast-context";
import { LocalAppUpdateStatusButton } from "./status-button";

const apiMocks = vi.hoisted(() => ({
	getHelmorAppUpdateStatus: vi.fn(),
	restartApp: vi.fn(),
	runHelmorAppInstall: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		getHelmorAppUpdateStatus: apiMocks.getHelmorAppUpdateStatus,
		restartApp: apiMocks.restartApp,
		runHelmorAppInstall: apiMocks.runHelmorAppInstall,
	};
});

function updateStatus(patch: Partial<HelmorAppUpdateStatus> = {}) {
	return {
		repoRoot: "/Users/harmony/helmor",
		installedAppPath: "/Applications/Helmor.app",
		updateAvailable: true,
		behindCount: 2,
		upstream: "origin/main",
		head: "abc1234",
		checkedAt: 1,
		error: null,
		...patch,
	} satisfies HelmorAppUpdateStatus;
}

function installResult() {
	return {
		repoRoot: "/Users/harmony/helmor",
		installedAppPath: "/Applications/Helmor.app",
		restartRequired: true,
		pullStdout: "",
		pullStderr: "",
		stdout: "",
		stderr: "",
		version: "1.2.3",
		bundleId: "ai.helmor.desktop",
		size: "150M",
		signingWarning: null,
	} satisfies HelmorAppInstallResult;
}

describe("LocalAppUpdateStatusButton", () => {
	beforeEach(() => {
		apiMocks.getHelmorAppUpdateStatus.mockReset();
		apiMocks.restartApp.mockReset();
		apiMocks.runHelmorAppInstall.mockReset();
	});

	afterEach(() => {
		cleanup();
		resetLocalAppInstallStoreForTests();
		vi.clearAllMocks();
	});

	it("appears when the checkout is behind and starts the installer", async () => {
		const user = userEvent.setup();
		apiMocks.getHelmorAppUpdateStatus.mockResolvedValue(updateStatus());
		apiMocks.runHelmorAppInstall.mockResolvedValue(installResult());

		render(
			<TooltipProvider>
				<WorkspaceToastProvider value={vi.fn()}>
					<LocalAppUpdateStatusButton />
				</WorkspaceToastProvider>
			</TooltipProvider>,
		);

		await user.click(
			await screen.findByRole("button", {
				name: "Install Helmor update (2 behind)",
			}),
		);

		expect(apiMocks.runHelmorAppInstall).toHaveBeenCalledTimes(1);
		expect(
			await screen.findByRole("button", { name: "Restart Helmor" }),
		).toBeInTheDocument();
	});

	it("restarts after a completed install", async () => {
		const user = userEvent.setup();
		apiMocks.getHelmorAppUpdateStatus.mockResolvedValue(updateStatus());
		apiMocks.runHelmorAppInstall.mockResolvedValue(installResult());
		apiMocks.restartApp.mockResolvedValue(undefined);

		render(
			<TooltipProvider>
				<WorkspaceToastProvider value={vi.fn()}>
					<LocalAppUpdateStatusButton />
				</WorkspaceToastProvider>
			</TooltipProvider>,
		);

		await user.click(
			await screen.findByRole("button", {
				name: "Install Helmor update (2 behind)",
			}),
		);
		await user.click(
			await screen.findByRole("button", { name: "Restart Helmor" }),
		);

		expect(apiMocks.restartApp).toHaveBeenCalledWith(true);
	});
});
