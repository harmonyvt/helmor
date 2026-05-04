import { invoke } from "@tauri-apps/api/core";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceGroup, WorkspaceSessionSummary } from "@/lib/api";
import WebApp from "./app";

vi.mock("./shell/web-shell", () => ({
	default: (props: {
		selectedWorkspaceId: string | null;
		selectedSessionId: string | null;
		onWorkspaceSelect: (id: string) => void;
		onSessionSelect: (id: string | null) => void;
		onBackToList: () => void;
	}) => (
		<div>
			<div data-testid="workspace-id">{props.selectedWorkspaceId ?? ""}</div>
			<div data-testid="session-id">{props.selectedSessionId ?? ""}</div>
			<button type="button" onClick={() => props.onWorkspaceSelect("ws-2")}>
				Select workspace
			</button>
			<button type="button" onClick={() => props.onSessionSelect("session-2")}>
				Select session
			</button>
			<button type="button" onClick={props.onBackToList}>
				Back
			</button>
		</div>
	),
}));

const groups: WorkspaceGroup[] = [
	{
		id: "progress",
		label: "In progress",
		tone: "progress",
		rows: [
			workspaceRow("ws-1", "Workspace one"),
			workspaceRow("ws-2", "Workspace two"),
		],
	},
];

const sessionsByWorkspace: Record<string, WorkspaceSessionSummary[]> = {
	"ws-1": [sessionRow("session-1"), sessionRow("session-2")],
	"ws-2": [sessionRow("session-2")],
};

describe("WebApp navigation", () => {
	let baseInvokeImpl:
		| ((command: string, args?: unknown) => Promise<unknown>)
		| undefined;

	beforeEach(() => {
		window.history.replaceState(null, "", "/");
		window.localStorage.clear();

		const invokeMock = vi.mocked(invoke);
		baseInvokeImpl = invokeMock.getMockImplementation() as
			| ((command: string, args?: unknown) => Promise<unknown>)
			| undefined;
		invokeMock.mockImplementation(async (command: string, args?: unknown) => {
			switch (command) {
				case "get_app_settings":
					return { "app.onboarding_completed": "true" };
				case "list_workspace_groups":
					return groups;
				case "list_archived_workspaces":
					return [];
				case "list_workspace_sessions": {
					const workspaceId =
						(args as { workspaceId?: string })?.workspaceId ?? "";
					return sessionsByWorkspace[workspaceId] ?? [];
				}
				default:
					return baseInvokeImpl?.(command, args as undefined);
			}
		});
	});

	afterEach(() => {
		cleanup();
		vi.mocked(invoke).mockImplementation(
			baseInvokeImpl ?? (async () => undefined),
		);
	});

	it("seeds selection from a direct workspace/session URL", async () => {
		window.history.replaceState(
			null,
			"",
			"/workspaces/ws-1/sessions/session-1",
		);

		render(<WebApp />);

		expect(await screen.findByTestId("workspace-id")).toHaveTextContent("ws-1");
		expect(screen.getByTestId("session-id")).toHaveTextContent("session-1");
	});

	it("pushes URL entries for user workspace and session changes", async () => {
		window.history.replaceState(null, "", "/workspaces/ws-1");
		render(<WebApp />);

		fireEvent.click(
			await screen.findByRole("button", { name: "Select workspace" }),
		);
		expect(window.location.pathname).toBe("/workspaces/ws-2");

		fireEvent.click(screen.getByRole("button", { name: "Select session" }));
		expect(window.location.pathname).toBe(
			"/workspaces/ws-2/sessions/session-2",
		);
	});

	it("applies browser back and forward state from popstate", async () => {
		render(<WebApp />);

		window.history.pushState(null, "", "/workspaces/ws-2/sessions/session-2");
		window.dispatchEvent(new PopStateEvent("popstate"));

		await waitFor(() => {
			expect(screen.getByTestId("workspace-id")).toHaveTextContent("ws-2");
			expect(screen.getByTestId("session-id")).toHaveTextContent("session-2");
		});
	});

	it("replaces invalid workspace URLs with the root route", async () => {
		window.history.replaceState(null, "", "/workspaces/missing");

		render(<WebApp />);

		await waitFor(() => {
			expect(window.location.pathname).toBe("/");
			expect(screen.getByTestId("workspace-id")).toHaveTextContent("");
		});
	});

	it("restores saved selection when the URL has no target", async () => {
		vi.mocked(invoke).mockImplementation(
			async (command: string, args?: unknown) => {
				switch (command) {
					case "get_app_settings":
						return {
							"app.onboarding_completed": "true",
							"app.last_workspace_id": "ws-1",
							"app.last_session_id": "session-1",
						};
					case "list_workspace_groups":
						return groups;
					case "list_archived_workspaces":
						return [];
					case "list_workspace_sessions": {
						const workspaceId =
							(args as { workspaceId?: string })?.workspaceId ?? "";
						return sessionsByWorkspace[workspaceId] ?? [];
					}
					default:
						return baseInvokeImpl?.(command, args as undefined);
				}
			},
		);

		render(<WebApp />);

		await waitFor(() => {
			expect(screen.getByTestId("workspace-id")).toHaveTextContent("ws-1");
			expect(screen.getByTestId("session-id")).toHaveTextContent("session-1");
			expect(window.location.pathname).toBe(
				"/workspaces/ws-1/sessions/session-1",
			);
		});
	});
});

function workspaceRow(
	id: string,
	title: string,
): WorkspaceGroup["rows"][number] {
	return {
		id,
		title,
		directoryName: title,
		status: "in-progress",
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		activeSessionId: null,
		hasUnread: false,
		unreadSessionCount: 0,
		workspaceUnread: 0,
		repoName: undefined,
		state: "ready",
	};
}

function sessionRow(id: string): WorkspaceSessionSummary {
	return {
		id,
		workspaceId: "ws-1",
		title: id,
		status: "ready",
		model: "sonnet",
		permissionMode: "default",
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		lastUserMessageAt: "2026-01-01T00:00:00Z",
		active: false,
		unreadCount: 0,
		fastMode: false,
		isHidden: false,
		actionKind: null,
		providerSessionId: null,
	};
}
