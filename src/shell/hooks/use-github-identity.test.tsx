import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGithubIdentity } from "./use-github-identity";

const apiMocks = vi.hoisted(() => ({
	loadGithubCliStatus: vi.fn(),
	openForgeCliAuthTerminal: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		loadGithubCliStatus: apiMocks.loadGithubCliStatus,
		openForgeCliAuthTerminal: apiMocks.openForgeCliAuthTerminal,
	};
});

const toastMocks = vi.hoisted(() => {
	const toast = vi.fn();
	const error = vi.fn();
	const success = vi.fn();
	const dismiss = vi.fn();
	Object.assign(toast, { error, success, dismiss });
	return { toast, error, success, dismiss };
});

vi.mock("sonner", () => ({
	toast: toastMocks.toast,
}));

const githubUnauth = {
	status: "unauthenticated" as const,
	host: "github.com",
	version: "2.88.1",
	message: "Run `gh auth login` to connect GitHub CLI.",
};

const githubReady = {
	status: "ready" as const,
	host: "github.com",
	login: "octocat",
	version: "2.88.1",
	message: "GitHub CLI ready as octocat.",
};

describe("useGithubIdentity — gh CLI state", () => {
	beforeEach(() => {
		toastMocks.toast.mockClear();
		apiMocks.loadGithubCliStatus.mockReset();
		apiMocks.openForgeCliAuthTerminal.mockReset();
		apiMocks.loadGithubCliStatus.mockResolvedValue(githubUnauth);
		apiMocks.openForgeCliAuthTerminal.mockResolvedValue(undefined);
	});

	it("maps ready gh status to connected identity state", async () => {
		apiMocks.loadGithubCliStatus.mockResolvedValue(githubReady);

		const { result } = renderHook(() => useGithubIdentity());

		await waitFor(() => {
			expect(result.current.githubIdentityState.status).toBe("connected");
		});
		expect(result.current.isIdentityConnected).toBe(true);
	});

	it("falls back to sonner toast when no pushWorkspaceToast is provided", async () => {
		const { result } = renderHook(() => useGithubIdentity());

		await waitFor(() => {
			expect(apiMocks.loadGithubCliStatus).toHaveBeenCalled();
		});

		await act(async () => {
			await result.current.handleDisconnectGithubIdentity();
		});

		expect(toastMocks.toast).toHaveBeenCalledWith(
			"Run `gh auth logout` in Terminal to disconnect GitHub CLI.",
		);
	});

	it("routes through the explicit pushWorkspaceToast when provided", async () => {
		const pushWorkspaceToast = vi.fn();
		const { result } = renderHook(() => useGithubIdentity(pushWorkspaceToast));

		await waitFor(() => {
			expect(apiMocks.loadGithubCliStatus).toHaveBeenCalled();
		});

		await act(async () => {
			await result.current.handleDisconnectGithubIdentity();
		});

		expect(pushWorkspaceToast).toHaveBeenCalledWith(
			"Run `gh auth logout` in Terminal to disconnect GitHub CLI.",
		);
		expect(toastMocks.toast).not.toHaveBeenCalled();
	});
});
