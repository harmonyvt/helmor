import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RepositoryCreateOption } from "@/lib/api";
import { WorkspaceCreateDialog } from "./workspace-create-dialog";

const repositories: RepositoryCreateOption[] = [
	{
		id: "repo-1",
		name: "helmor",
		defaultBranch: "main",
		repoInitials: "HE",
	},
];

describe("WorkspaceCreateDialog", () => {
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
		);
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});
});
