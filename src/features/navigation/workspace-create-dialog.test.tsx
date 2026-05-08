import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RepositoryCreateOption } from "@/lib/api";
import { WorkspaceCreateDialog } from "./workspace-create-dialog";

const apiMocks = vi.hoisted(() => ({
	listGithubPullRequestsForRepo: vi.fn(),
	listRemoteBranches: vi.fn(),
	prefetchRemoteRefs: vi.fn(),
	resolveGithubPullRequestForRepo: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		listGithubPullRequestsForRepo: apiMocks.listGithubPullRequestsForRepo,
		listRemoteBranches: apiMocks.listRemoteBranches,
		prefetchRemoteRefs: apiMocks.prefetchRemoteRefs,
		resolveGithubPullRequestForRepo: apiMocks.resolveGithubPullRequestForRepo,
	};
});

const repositories: RepositoryCreateOption[] = [
	{
		id: "repo-1",
		name: "helmor",
		defaultBranch: "main",
		repoInitials: "HE",
	},
];

describe("WorkspaceCreateDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiMocks.listRemoteBranches.mockResolvedValue([]);
		apiMocks.listGithubPullRequestsForRepo.mockResolvedValue([]);
		apiMocks.prefetchRemoteRefs.mockResolvedValue({ fetched: false });
		apiMocks.resolveGithubPullRequestForRepo.mockResolvedValue(null);
	});

	afterEach(() => {
		cleanup();
	});

	it("keeps the Goal create flow open when finalization fails", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		const onCreateGoalWorkspace = vi
			.fn()
			.mockRejectedValue(new Error("draft PR failed"));

		render(
			<TooltipProvider delayDuration={0}>
				<WorkspaceCreateDialog
					open
					onOpenChange={onOpenChange}
					repositories={repositories}
					creating={false}
					onCreateWorkspace={vi.fn()}
					onCreateGoalWorkspace={onCreateGoalWorkspace}
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByRole("tab", { name: "Goal" }));
		await user.selectOptions(screen.getByLabelText("Repository"), "repo-1");
		await user.type(screen.getByLabelText("Goal title"), "Build API");
		await user.type(screen.getByLabelText("Goal description"), "Ship the API");
		await user.click(screen.getByRole("button", { name: "Create Goal" }));

		expect(onCreateGoalWorkspace).toHaveBeenCalledWith(
			"repo-1",
			"Build API",
			"Ship the API",
			null,
		);
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});

	it("lets a Goal use an existing branch and fills matching PR metadata", async () => {
		const user = userEvent.setup();
		const onCreateGoalWorkspace = vi.fn().mockResolvedValue(undefined);
		apiMocks.listRemoteBranches.mockResolvedValue(["feature/goal-pr"]);
		apiMocks.listGithubPullRequestsForRepo.mockResolvedValue([
			{
				number: 42,
				title: "Existing Goal PR",
				body: "Existing PR body",
				url: "https://github.com/octocat/hello-world/pull/42",
				state: "OPEN",
				isMerged: false,
				headBranch: "feature/goal-pr",
				baseBranch: "main",
				additions: 1,
				deletions: 0,
			},
		]);

		render(
			<TooltipProvider delayDuration={0}>
				<WorkspaceCreateDialog
					open
					onOpenChange={vi.fn()}
					repositories={repositories}
					creating={false}
					onCreateWorkspace={vi.fn()}
					onCreateGoalWorkspace={onCreateGoalWorkspace}
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByRole("tab", { name: "Goal" }));
		await waitFor(() => {
			expect(
				screen.getByRole("option", { name: /PR #42/ }),
			).toBeInTheDocument();
		});
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Branch" }),
			"feature/goal-pr",
		);

		expect(screen.getByLabelText("Goal title")).toHaveValue("Existing Goal PR");
		expect(screen.getByLabelText("Goal description")).toHaveValue(
			"Existing PR body",
		);

		await user.click(screen.getByRole("button", { name: "Create Goal" }));

		expect(onCreateGoalWorkspace).toHaveBeenCalledWith(
			"repo-1",
			"Existing Goal PR",
			"Existing PR body",
			"feature/goal-pr",
		);
	});

	it("lets a Goal select a pull request and reverse-fill its branch", async () => {
		const user = userEvent.setup();
		const onCreateGoalWorkspace = vi.fn().mockResolvedValue(undefined);
		apiMocks.listRemoteBranches.mockResolvedValue(["main"]);
		apiMocks.listGithubPullRequestsForRepo.mockResolvedValue([
			{
				number: 43,
				title: "Reverse Lookup Goal",
				body: "Reverse PR body",
				url: "https://github.com/octocat/hello-world/pull/43",
				state: "OPEN",
				isMerged: false,
				headBranch: "feature/reverse-goal",
				baseBranch: "develop",
				additions: 3,
				deletions: 1,
			},
		]);

		render(
			<TooltipProvider delayDuration={0}>
				<WorkspaceCreateDialog
					open
					onOpenChange={vi.fn()}
					repositories={repositories}
					creating={false}
					onCreateWorkspace={vi.fn()}
					onCreateGoalWorkspace={onCreateGoalWorkspace}
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByRole("tab", { name: "Goal" }));
		await waitFor(() => {
			expect(
				screen.getByRole("option", { name: /Reverse Lookup Goal/ }),
			).toBeInTheDocument();
		});
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Pull request" }),
			"43",
		);

		expect(screen.getByRole("combobox", { name: "Branch" })).toHaveValue(
			"feature/reverse-goal",
		);
		expect(screen.getByLabelText("Goal title")).toHaveValue(
			"Reverse Lookup Goal",
		);
		expect(screen.getByLabelText("Goal description")).toHaveValue(
			"Reverse PR body",
		);
		expect(
			screen.getByText(/Using PR #43: https:\/\/github.com\/octocat/),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Create Goal" }));

		expect(onCreateGoalWorkspace).toHaveBeenCalledWith(
			"repo-1",
			"Reverse Lookup Goal",
			"Reverse PR body",
			"feature/reverse-goal",
		);
	});
});
