import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	EditorFilesWithContentResponse,
	WorkspaceDetail,
} from "@/lib/api";
import type { InspectorFileItem } from "@/lib/editor-session";
import { renderWithProviders } from "@/test/render-with-providers";
import { GoalChangesView } from "./changes-view";

const apiMocks = vi.hoisted(() => ({
	listWorkspaceChangesWithContent: vi.fn(),
	listRemoteBranches: vi.fn(),
	updateIntendedTargetBranch: vi.fn(),
	renameWorkspaceBranch: vi.fn(),
}));

vi.mock("file-extension-icon-js", () => ({
	getMaterialFileIcon: () => "icon.svg",
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		listWorkspaceChangesWithContent: apiMocks.listWorkspaceChangesWithContent,
		listRemoteBranches: apiMocks.listRemoteBranches,
		updateIntendedTargetBranch: apiMocks.updateIntendedTargetBranch,
		renameWorkspaceBranch: apiMocks.renameWorkspaceBranch,
	};
});

function workspace(
	overrides: Partial<WorkspaceDetail> & Pick<WorkspaceDetail, "id" | "title">,
): WorkspaceDetail {
	return {
		...overrides,
		id: overrides.id,
		title: overrides.title,
		repoId: "repo-1",
		repoName: "Repo",
		directoryName: overrides.directoryName ?? overrides.id,
		state: "ready",
		hasUnread: false,
		workspaceUnread: 0,
		unreadSessionCount: 0,
		status: overrides.status ?? "backlog",
		sessionCount: 0,
		messageCount: 0,
		remote: overrides.remote ?? "origin",
		defaultBranch: overrides.defaultBranch ?? "main",
		intendedTargetBranch: overrides.intendedTargetBranch ?? "main",
	};
}

function change(
	workspaceRoot: string,
	path: string,
	overrides: Partial<InspectorFileItem> = {},
): InspectorFileItem {
	const name = path.split("/").at(-1) ?? path;
	return {
		path,
		absolutePath: `${workspaceRoot}/${path}`,
		name,
		status: "M",
		insertions: 4,
		deletions: 1,
		committedStatus: "M",
		stagedStatus: null,
		unstagedStatus: null,
		...overrides,
	};
}

function response(items: InspectorFileItem[]): EditorFilesWithContentResponse {
	return { items, prefetched: [] };
}

describe("GoalChangesView", () => {
	beforeEach(() => {
		apiMocks.listWorkspaceChangesWithContent.mockReset();
		apiMocks.listRemoteBranches.mockReset();
		apiMocks.listRemoteBranches.mockResolvedValue(["main", "develop"]);
		apiMocks.updateIntendedTargetBranch.mockReset();
		apiMocks.updateIntendedTargetBranch.mockResolvedValue({ reset: false });
		apiMocks.renameWorkspaceBranch.mockReset();
		apiMocks.renameWorkspaceBranch.mockResolvedValue(undefined);
	});

	it("shows goal and card branch changes with card trace labels", async () => {
		const goal = workspace({
			id: "goal-1",
			title: "Launch",
			workspaceKind: "goal",
			rootPath: "/tmp/goal",
			branch: "helmor/goal/launch",
		});
		const card = workspace({
			id: "card-1",
			title: "Auth card",
			rootPath: "/tmp/card",
			branch: "helmor/card/auth",
			status: "in-progress",
		});
		apiMocks.listWorkspaceChangesWithContent.mockImplementation(
			async (rootPath: string) =>
				rootPath === "/tmp/goal"
					? response([change("/tmp/goal", "src/auth.ts")])
					: response([change("/tmp/card", "src/auth.ts")]),
		);

		renderWithProviders(
			<GoalChangesView goalWorkspace={goal} workspaces={[card]} />,
		);

		await waitFor(() => {
			expect(screen.getByText("Goal branch")).toBeInTheDocument();
			expect(screen.getByText("Auth card")).toBeInTheDocument();
		});

		expect(
			screen.getAllByRole("button", { name: "Compare against origin/main" }),
		).toHaveLength(2);
		expect(
			screen.getAllByRole("button", { name: "Rename branch" }),
		).toHaveLength(2);

		await waitFor(() => {
			expect(screen.getAllByText("auth.ts")).toHaveLength(2);
			expect(screen.getAllByText("From Auth card")).toHaveLength(2);
		});
	});

	it("opens card branch diffs with the card workspace root", async () => {
		const onOpenEditorFile = vi.fn();
		const card = workspace({
			id: "card-1",
			title: "Trace card",
			rootPath: "/tmp/card",
			branch: "helmor/card/trace",
			remote: "upstream",
			intendedTargetBranch: "develop",
		});
		apiMocks.listWorkspaceChangesWithContent.mockResolvedValue(
			response([
				change("/tmp/card", "src/logic.ts", {
					status: "A",
					committedStatus: "A",
				}),
			]),
		);

		renderWithProviders(
			<GoalChangesView
				workspaces={[card]}
				onOpenEditorFile={onOpenEditorFile}
			/>,
		);

		const row = await screen.findByText("logic.ts");
		fireEvent.click(row);

		expect(onOpenEditorFile).toHaveBeenCalledWith(
			"/tmp/card/src/logic.ts",
			expect.objectContaining({
				fileStatus: "A",
				originalRef: "upstream/develop",
				modifiedRef: "HEAD",
				workspaceRootPath: "/tmp/card",
				workspaceId: "card-1",
			}),
		);
	});
});
