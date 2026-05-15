import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceRow } from "@/lib/api";
import type { DeleteGoalDialogProps } from "./delete-goal-dialog";
import { DeleteGoalDialog } from "./delete-goal-dialog";
import type { GoalRowActions, GoalVirtualItem } from "./goal-layout";
import { GoalVirtualItemRenderer } from "./goal-layout";
import type { GoalGroup } from "./sidebar-projection";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeWorkspaceRow(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
	return {
		id: "ws-1",
		title: "Workspace 1",
		state: "ready",
		hasUnread: false,
		...overrides,
	};
}

function makeGoalGroup(childRows: WorkspaceRow[] = []): GoalGroup {
	return {
		goalWorkspaceId: "goal-1",
		goalTitle: "My Goal",
		goalRow: makeWorkspaceRow({ id: "goal-1", title: "My Goal" }),
		childRows,
	};
}

function makeGoalHeaderItem(
	goalGroup: GoalGroup,
): Extract<GoalVirtualItem, { kind: "goal-header" }> {
	return {
		kind: "goal-header",
		goalGroup,
		isOpen: true,
		indent: 8,
	};
}

function makeActions(overrides: Partial<GoalRowActions> = {}): GoalRowActions {
	return {
		onSelect: vi.fn(),
		onPrefetch: vi.fn(),
		onArchiveWorkspace: vi.fn(),
		onDeleteWorkspace: vi.fn(),
		onRestoreWorkspace: vi.fn(),
		onConvertWorkspaceToGoal: vi.fn(),
		onMarkWorkspaceUnread: vi.fn(),
		onOpenInFinder: vi.fn(),
		onTogglePin: vi.fn(),
		onSetWorkspaceStatus: vi.fn(),
		archivingWorkspaceIds: new Set(),
		convertingGoalWorkspaceIds: new Set(),
		markingUnreadWorkspaceId: undefined,
		restoringWorkspaceId: undefined,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// DeleteGoalDialog — unit tests
// ---------------------------------------------------------------------------

describe("DeleteGoalDialog", () => {
	afterEach(() => cleanup());

	function renderDialog(props: Partial<DeleteGoalDialogProps> = {}) {
		const defaults: DeleteGoalDialogProps = {
			open: true,
			onOpenChange: vi.fn(),
			goalTitle: "My Goal",
			childCount: 0,
			onConfirm: vi.fn(),
		};
		return render(<DeleteGoalDialog {...defaults} {...props} />);
	}

	it("renders without crashing when closed", () => {
		renderDialog({ open: false });
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("cancel does not call onConfirm and calls onOpenChange(false)", async () => {
		const user = userEvent.setup();
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();

		renderDialog({ onConfirm, onOpenChange });

		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onConfirm).not.toHaveBeenCalled();
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("simple confirm (no children) calls onConfirm('free') and closes", async () => {
		const user = userEvent.setup();
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();

		renderDialog({ childCount: 0, onConfirm, onOpenChange });

		expect(screen.queryByRole("radio")).toBeNull();

		await user.click(screen.getByRole("button", { name: "Delete goal" }));
		expect(onConfirm).toHaveBeenCalledOnce();
		expect(onConfirm).toHaveBeenCalledWith("free");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("with children: 'free' is selected by default and calls onConfirm('free')", async () => {
		const user = userEvent.setup();
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();

		renderDialog({ childCount: 2, onConfirm, onOpenChange });

		// Radio options are visible
		expect(
			screen.getByRole("radio", { name: /Free sub-workspaces/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("radio", { name: /Archive sub-workspaces/i }),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Delete goal" }));
		expect(onConfirm).toHaveBeenCalledWith("free");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("with children: selecting 'archive' calls onConfirm('archive')", async () => {
		const user = userEvent.setup();
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();

		renderDialog({ childCount: 3, onConfirm, onOpenChange });

		await user.click(
			screen.getByRole("radio", { name: /Archive sub-workspaces/i }),
		);
		await user.click(screen.getByRole("button", { name: "Delete goal" }));
		expect(onConfirm).toHaveBeenCalledWith("archive");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("switching back to 'free' after selecting 'archive' calls onConfirm('free')", async () => {
		const user = userEvent.setup();
		const onConfirm = vi.fn();

		renderDialog({ childCount: 2, onConfirm });

		await user.click(
			screen.getByRole("radio", { name: /Archive sub-workspaces/i }),
		);
		await user.click(
			screen.getByRole("radio", { name: /Free sub-workspaces/i }),
		);
		await user.click(screen.getByRole("button", { name: "Delete goal" }));
		expect(onConfirm).toHaveBeenCalledWith("free");
	});

	it("shows singular sub-workspace copy for childCount=1", () => {
		renderDialog({ childCount: 1 });

		expect(
			screen.getByText(/This goal has 1 sub-workspace\./),
		).toBeInTheDocument();
	});

	it("shows plural sub-workspace copy for childCount>1", () => {
		renderDialog({ childCount: 3 });

		expect(
			screen.getByText(/This goal has 3 sub-workspaces\./),
		).toBeInTheDocument();
	});
});

// ---------------------------------------------------------------------------
// GoalFolderHeader integration via GoalVirtualItemRenderer
// ---------------------------------------------------------------------------

describe("GoalFolderHeader delete dialog (via GoalVirtualItemRenderer)", () => {
	afterEach(() => cleanup());

	function renderGoalHeader(goalGroup: GoalGroup, actions: GoalRowActions) {
		const item = makeGoalHeaderItem(goalGroup);
		return render(
			<GoalVirtualItemRenderer
				item={item}
				actions={actions}
				onToggleSection={vi.fn()}
			/>,
		);
	}

	it("opening context menu 'Delete goal…' does not immediately call onDeleteWorkspace", async () => {
		const actions = makeActions();
		const goalGroup = makeGoalGroup([makeWorkspaceRow({ id: "child-1" })]);

		renderGoalHeader(goalGroup, actions);

		// Trigger context menu on the folder header area
		const trigger = screen.getByText("My Goal");
		fireEvent.contextMenu(trigger);

		const deleteItem = await screen.findByRole("menuitem", {
			name: /Delete goal/,
		});
		expect(deleteItem).toBeInTheDocument();
		expect(actions.onDeleteWorkspace).not.toHaveBeenCalled();

		// Click the context menu item — should open dialog, not delete
		fireEvent.click(deleteItem);
		expect(actions.onDeleteWorkspace).not.toHaveBeenCalled();

		// Dialog appears
		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});

	it("canceling the dialog does not call onDeleteWorkspace or onArchiveWorkspace", async () => {
		const user = userEvent.setup();
		const actions = makeActions();
		const goalGroup = makeGoalGroup([makeWorkspaceRow({ id: "child-1" })]);

		renderGoalHeader(goalGroup, actions);

		fireEvent.contextMenu(screen.getByText("My Goal"));
		fireEvent.click(
			await screen.findByRole("menuitem", { name: /Delete goal/ }),
		);

		await user.click(screen.getByRole("button", { name: "Cancel" }));

		expect(actions.onDeleteWorkspace).not.toHaveBeenCalled();
		expect(actions.onArchiveWorkspace).not.toHaveBeenCalled();
	});

	it("'free sub-workspaces' calls onDeleteWorkspace once with the goal id only", async () => {
		const user = userEvent.setup();
		const actions = makeActions();
		const goalGroup = makeGoalGroup([
			makeWorkspaceRow({ id: "child-1" }),
			makeWorkspaceRow({ id: "child-2" }),
		]);

		renderGoalHeader(goalGroup, actions);

		fireEvent.contextMenu(screen.getByText("My Goal"));
		fireEvent.click(
			await screen.findByRole("menuitem", { name: /Delete goal/ }),
		);

		// "free" is default — confirm immediately
		await user.click(screen.getByRole("button", { name: "Delete goal" }));

		expect(actions.onDeleteWorkspace).toHaveBeenCalledOnce();
		expect(actions.onDeleteWorkspace).toHaveBeenCalledWith("goal-1");
		expect(actions.onArchiveWorkspace).not.toHaveBeenCalled();
	});

	it("'archive sub-workspaces' archives each child then deletes only the goal", async () => {
		const user = userEvent.setup();
		const actions = makeActions();
		const goalGroup = makeGoalGroup([
			makeWorkspaceRow({ id: "child-1" }),
			makeWorkspaceRow({ id: "child-2" }),
		]);

		renderGoalHeader(goalGroup, actions);

		fireEvent.contextMenu(screen.getByText("My Goal"));
		fireEvent.click(
			await screen.findByRole("menuitem", { name: /Delete goal/ }),
		);

		// Switch to archive option
		await user.click(
			screen.getByRole("radio", { name: /Archive sub-workspaces/i }),
		);
		await user.click(screen.getByRole("button", { name: "Delete goal" }));

		// Archive called for each child, NOT for the goal workspace
		expect(actions.onArchiveWorkspace).toHaveBeenCalledTimes(2);
		expect(actions.onArchiveWorkspace).toHaveBeenCalledWith("child-1");
		expect(actions.onArchiveWorkspace).toHaveBeenCalledWith("child-2");
		expect(actions.onArchiveWorkspace).not.toHaveBeenCalledWith("goal-1");

		// Delete called only for the goal workspace
		expect(actions.onDeleteWorkspace).toHaveBeenCalledOnce();
		expect(actions.onDeleteWorkspace).toHaveBeenCalledWith("goal-1");
	});

	it("no-children goal shows simple dialog and calls onDeleteWorkspace once with goal id", async () => {
		const user = userEvent.setup();
		const actions = makeActions();
		const goalGroup = makeGoalGroup([]); // no children

		renderGoalHeader(goalGroup, actions);

		fireEvent.contextMenu(screen.getByText("My Goal"));
		fireEvent.click(
			await screen.findByRole("menuitem", { name: /Delete goal/ }),
		);

		// No radio buttons for no-children case
		expect(screen.queryByRole("radio")).toBeNull();

		await user.click(screen.getByRole("button", { name: "Delete goal" }));

		expect(actions.onDeleteWorkspace).toHaveBeenCalledOnce();
		expect(actions.onDeleteWorkspace).toHaveBeenCalledWith("goal-1");
		expect(actions.onArchiveWorkspace).not.toHaveBeenCalled();
	});

	it("context menu archive item still archives goal and all children (unchanged)", async () => {
		const user = userEvent.setup();
		const actions = makeActions();
		const goalGroup = makeGoalGroup([
			makeWorkspaceRow({ id: "child-1" }),
			makeWorkspaceRow({ id: "child-2" }),
		]);

		renderGoalHeader(goalGroup, actions);

		fireEvent.contextMenu(screen.getByText("My Goal"));
		await user.click(
			await screen.findByRole("menuitem", {
				name: /Archive goal and 2 workspaces/i,
			}),
		);

		// All workspace ids archived (children + goal)
		expect(actions.onArchiveWorkspace).toHaveBeenCalledTimes(3);
		expect(actions.onArchiveWorkspace).toHaveBeenCalledWith("child-1");
		expect(actions.onArchiveWorkspace).toHaveBeenCalledWith("child-2");
		expect(actions.onArchiveWorkspace).toHaveBeenCalledWith("goal-1");
		expect(actions.onDeleteWorkspace).not.toHaveBeenCalled();
	});
});
