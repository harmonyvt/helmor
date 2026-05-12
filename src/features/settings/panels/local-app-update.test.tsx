import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceToastProvider } from "@/lib/workspace-toast-context";

const apiMocks = vi.hoisted(() => ({
	restartApp: vi.fn(),
	runHelmorAppInstall: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		restartApp: apiMocks.restartApp,
		runHelmorAppInstall: apiMocks.runHelmorAppInstall,
	};
});

import { LocalAppUpdatePanel } from "./local-app-update";

describe("LocalAppUpdatePanel", () => {
	beforeEach(() => {
		apiMocks.restartApp.mockReset();
		apiMocks.runHelmorAppInstall.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("shows a persistent restart toast after installing an update", async () => {
		const user = userEvent.setup();
		const pushToast = vi.fn();
		apiMocks.runHelmorAppInstall.mockResolvedValue({
			repoRoot: "/Users/harmony/helmor",
			scriptPath:
				"/Users/harmony/helmor/.codex/skills/helmor-app-install/scripts/install_app.sh",
			installedAppPath: "/Applications/Helmor.app",
			restartRequired: true,
			pullStdout: "",
			pullStderr: "",
			stdout: "",
			stderr: "",
		});
		apiMocks.restartApp.mockResolvedValue(undefined);

		render(
			<WorkspaceToastProvider value={pushToast}>
				<LocalAppUpdatePanel />
			</WorkspaceToastProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Install Update" }));

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
});
