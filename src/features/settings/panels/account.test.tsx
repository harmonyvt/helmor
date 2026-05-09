import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryCreateOption } from "@/lib/api";
import { renderWithProviders } from "@/test/render-with-providers";

const apiMocks = vi.hoisted(() => ({
	getForgeCliStatus: vi.fn(),
	openForgeCliAuthTerminal: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		getForgeCliStatus: apiMocks.getForgeCliStatus,
		openForgeCliAuthTerminal: apiMocks.openForgeCliAuthTerminal,
	};
});

import { AccountPanel } from "./account";

function gitlabRepo(host: string): RepositoryCreateOption {
	return {
		id: `repo-${host}`,
		name: `repo-${host}`,
		remoteUrl: `git@${host}:acme/repo.git`,
		forgeProvider: "gitlab",
	};
}

const githubReady = {
	status: "ready" as const,
	provider: "github" as const,
	host: "github.com",
	cliName: "gh",
	login: "natllian",
	version: "2.65.0",
	message: "GitHub CLI ready as natllian.",
};

const githubUnauth = {
	status: "unauthenticated" as const,
	provider: "github" as const,
	host: "github.com",
	cliName: "gh",
	version: "2.65.0",
	message: "Run `gh auth login` to connect GitHub CLI.",
	loginCommand: "gh auth login",
};

describe("AccountPanel", () => {
	beforeEach(() => {
		apiMocks.getForgeCliStatus.mockReset();
		apiMocks.openForgeCliAuthTerminal.mockReset();
		apiMocks.openForgeCliAuthTerminal.mockResolvedValue(undefined);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("shows the login inline (no Connect button) when CLI is ready", async () => {
		apiMocks.getForgeCliStatus.mockResolvedValue(githubReady);

		renderWithProviders(<AccountPanel repositories={[]} />);

		expect(
			await screen.findByText("GitHub CLI integration"),
		).toBeInTheDocument();
		// Login appears next to the green check mark
		expect(await screen.findByText("natllian")).toBeInTheDocument();
		// Ready state has no Connect button on its row
		expect(
			screen.queryByRole("button", { name: "Connect" }),
		).not.toBeInTheDocument();
	});

	it("shows a Connect button (and no verbose backend message) when not connected", async () => {
		apiMocks.getForgeCliStatus.mockResolvedValue(githubUnauth);

		renderWithProviders(<AccountPanel repositories={[]} />);

		expect(
			await screen.findByRole("button", { name: "Connect" }),
		).toBeInTheDocument();
		expect(screen.queryByText(/Run `gh auth login`/)).not.toBeInTheDocument();
		expect(screen.queryByText("Not connected.")).not.toBeInTheDocument();
	});

	it("renders one GitLab row per detected GitLab host", async () => {
		apiMocks.getForgeCliStatus.mockImplementation(async (provider, host) => {
			if (provider === "github") return githubUnauth;
			return {
				status: "unauthenticated" as const,
				provider: "gitlab" as const,
				host: host ?? "",
				cliName: "glab",
				version: "1.50.0",
				message: `Run \`glab auth login --hostname ${host}\``,
				loginCommand: `glab auth login --hostname ${host}`,
			};
		});

		renderWithProviders(
			<AccountPanel
				repositories={[
					gitlabRepo("gitlab.com"),
					gitlabRepo("gitlab.example.com"),
				]}
			/>,
		);

		expect(
			await screen.findByText(/GitLab CLI integration · gitlab\.com/),
		).toBeInTheDocument();
		expect(
			screen.getByText(/GitLab CLI integration · gitlab\.example\.com/),
		).toBeInTheDocument();
		await waitFor(() =>
			expect(apiMocks.getForgeCliStatus).toHaveBeenCalledWith(
				"gitlab",
				"gitlab.com",
			),
		);
		expect(apiMocks.getForgeCliStatus).toHaveBeenCalledWith(
			"gitlab",
			"gitlab.example.com",
		);
	});

	it("clicking Connect on an unauthenticated row opens the auth terminal", async () => {
		apiMocks.getForgeCliStatus.mockResolvedValue(githubUnauth);

		renderWithProviders(<AccountPanel repositories={[]} />);

		// Wait for the query to settle so the Connect button is enabled.
		const button = await screen.findByRole("button", { name: "Connect" });
		await waitFor(() => expect(button).not.toBeDisabled());
		fireEvent.click(button);

		await waitFor(() =>
			expect(apiMocks.openForgeCliAuthTerminal).toHaveBeenCalledWith(
				"github",
				"github.com",
			),
		);
	});

	it("disables the Connect button while the auth flow is in flight", async () => {
		apiMocks.getForgeCliStatus.mockResolvedValue(githubUnauth);
		let resolveOpen: () => void = () => {};
		apiMocks.openForgeCliAuthTerminal.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveOpen = resolve;
				}),
		);

		renderWithProviders(<AccountPanel repositories={[]} />);

		const button = await screen.findByRole("button", { name: "Connect" });
		await waitFor(() => expect(button).not.toBeDisabled());
		fireEvent.click(button);

		await waitFor(() => {
			expect(
				(screen.getByRole("button", { name: /connect/i }) as HTMLButtonElement)
					.disabled,
			).toBe(true);
		});

		resolveOpen();
	});
});
