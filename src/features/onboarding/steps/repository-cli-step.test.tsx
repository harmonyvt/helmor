import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
	getForgeCliStatus: vi.fn(),
	resizeForgeCliAuthTerminal: vi.fn(),
	spawnForgeCliAuthTerminal: vi.fn(),
	stopForgeCliAuthTerminal: vi.fn(),
	writeForgeCliAuthTerminalStdin: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		getForgeCliStatus: apiMocks.getForgeCliStatus,
		resizeForgeCliAuthTerminal: apiMocks.resizeForgeCliAuthTerminal,
		spawnForgeCliAuthTerminal: apiMocks.spawnForgeCliAuthTerminal,
		stopForgeCliAuthTerminal: apiMocks.stopForgeCliAuthTerminal,
		writeForgeCliAuthTerminalStdin: apiMocks.writeForgeCliAuthTerminalStdin,
	};
});

vi.mock("sonner", () => ({
	toast: Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn(),
	}),
}));

import { RepositoryCliStep } from "./repository-cli-step";

describe("RepositoryCliStep", () => {
	beforeEach(() => {
		apiMocks.getForgeCliStatus.mockReset();
		apiMocks.resizeForgeCliAuthTerminal.mockReset();
		apiMocks.spawnForgeCliAuthTerminal.mockReset();
		apiMocks.stopForgeCliAuthTerminal.mockReset();
		apiMocks.writeForgeCliAuthTerminalStdin.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("shows Ready when a repository CLI is already authenticated", async () => {
		apiMocks.getForgeCliStatus.mockImplementation((provider: string) =>
			Promise.resolve({
				status: "ready",
				provider,
				host: provider === "gitlab" ? "gitlab.com" : "github.com",
				cliName: provider === "gitlab" ? "glab" : "gh",
				login: "octocat",
				version: "test",
				message: `${provider === "gitlab" ? "GitLab" : "GitHub"} CLI ready as octocat.`,
			}),
		);

		render(
			<RepositoryCliStep step="corner" onBack={vi.fn()} onNext={vi.fn()} />,
		);

		const githubItem = await screen.findByRole("group", {
			name: "GitHub CLI (octocat)",
		});

		await waitFor(() => {
			expect(within(githubItem).getByText("Ready")).toBeInTheDocument();
		});
		expect(
			within(githubItem).queryByText(/GitHub CLI ready as octocat/i),
		).not.toBeInTheDocument();
		expect(
			within(githubItem).queryByRole("button", { name: "Set up" }),
		).not.toBeInTheDocument();
	});

	it("opens the embedded auth terminal from Set up when GitHub CLI is unauthenticated", async () => {
		const user = userEvent.setup();
		apiMocks.getForgeCliStatus.mockResolvedValue({
			status: "unauthenticated",
			provider: "github",
			host: "github.com",
			cliName: "gh",
			version: "test",
			message: "Run `gh auth login` to connect GitHub CLI.",
			loginCommand: "gh auth login",
		});
		apiMocks.spawnForgeCliAuthTerminal.mockResolvedValue(undefined);

		render(
			<RepositoryCliStep step="corner" onBack={vi.fn()} onNext={vi.fn()} />,
		);

		const githubItem = screen.getByRole("group", { name: "GitHub CLI" });
		await waitFor(() => {
			expect(
				within(githubItem).getByRole("button", { name: "Set up" }),
			).toBeEnabled();
		});
		expect(
			within(githubItem).queryByText(
				/Run `gh auth login` to connect GitHub CLI/i,
			),
		).not.toBeInTheDocument();

		await user.click(
			within(githubItem).getByRole("button", { name: "Set up" }),
		);

		await waitFor(() => {
			expect(apiMocks.spawnForgeCliAuthTerminal).toHaveBeenCalledWith(
				"github",
				"github.com",
				expect.any(String),
				expect.any(Function),
			);
		});
		expect(screen.getByText("GitHub CLI login")).toBeInTheDocument();
	});

	it("asks for a GitLab domain before opening the embedded auth terminal", async () => {
		const user = userEvent.setup();
		apiMocks.getForgeCliStatus.mockResolvedValue({
			status: "unauthenticated",
			provider: "gitlab",
			host: "gitlab.com",
			cliName: "glab",
			version: "test",
			message: "Run `glab auth login --hostname gitlab.com`.",
			loginCommand: "glab auth login --hostname gitlab.com",
		});
		apiMocks.spawnForgeCliAuthTerminal.mockResolvedValue(undefined);

		render(
			<RepositoryCliStep step="corner" onBack={vi.fn()} onNext={vi.fn()} />,
		);

		const gitlabItem = screen.getByRole("group", { name: "GitLab CLI" });
		await waitFor(() => {
			expect(
				within(gitlabItem).getByRole("button", { name: "Set up" }),
			).toBeEnabled();
		});

		await user.click(
			within(gitlabItem).getByRole("button", { name: "Set up" }),
		);

		const input = screen.getByRole("textbox", { name: "GitLab domain" });
		expect(input).toHaveValue("gitlab.com");

		await user.clear(input);
		await user.type(input, "gitlab.example.com");
		await user.click(screen.getByRole("button", { name: /log in/i }));

		await waitFor(() => {
			expect(apiMocks.spawnForgeCliAuthTerminal).toHaveBeenCalledWith(
				"gitlab",
				"gitlab.example.com",
				expect.any(String),
				expect.any(Function),
			);
		});
		expect(
			screen.getByText("GitLab CLI login · gitlab.example.com"),
		).toBeInTheDocument();
	});
});
