import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssigneeSummary, WorkspaceDetail } from "@/lib/api";
import { AssigneesBar } from "./assignees-bar";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-05-18T12:10:00Z"));
});

function workspace(overrides: Partial<WorkspaceDetail>): WorkspaceDetail {
	return {
		id: "card-1",
		title: "Implement assignee list",
		repoId: "repo-1",
		repoName: "Helmor",
		directoryName: "card-1",
		state: "ready",
		hasUnread: false,
		workspaceUnread: 0,
		unreadSessionCount: 0,
		status: "in-progress",
		sessionCount: 1,
		messageCount: 0,
		...overrides,
	};
}

function assignee(overrides: Partial<AssigneeSummary>): AssigneeSummary {
	return {
		cardId: "card-1",
		workspaceId: "card-1",
		sessionId: "session-1",
		title: "Implement assignee list",
		assigneeName: "codex",
		sessionStatus: "idle",
		pendingRunCount: 1,
		activeRunStatus: "queued",
		lastRunError: null,
		latestReport: null,
		latestRun: {
			runId: "run-1",
			status: "queued",
			prompt: "Implement data-backed cards.",
			modelId: "gpt-5.4",
			permissionMode: "default",
			error: null,
			createdAt: "2026-05-18 12:00:00",
			startedAt: null,
			completedAt: null,
			lastEventAt: null,
		},
		...overrides,
	};
}

describe("AssigneesBar", () => {
	it("renders durable run details from the assignee summary", () => {
		render(
			<AssigneesBar
				assignees={[
					assignee({}),
					assignee({
						cardId: "card-2",
						workspaceId: "card-2",
						sessionId: "session-2",
						title: "Fix failing launch",
						activeRunStatus: "failed",
						pendingRunCount: 0,
						lastRunError: "model access denied",
						latestRun: {
							runId: "run-2",
							status: "failed",
							prompt: "Retry the failing launch work.",
							modelId: "claude-sonnet-4-6",
							permissionMode: "default",
							error: "model access denied",
							createdAt: "2026-05-18 11:00:00",
							startedAt: "2026-05-18 11:01:00",
							completedAt: "2026-05-18 11:03:00",
							lastEventAt: "2026-05-18 11:03:00",
						},
					}),
				]}
				cards={[
					workspace({ id: "card-1" }),
					workspace({ id: "card-2", title: "Fix failing launch" }),
				]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Assignees/i }));

		const queuedRow = screen.getByRole("button", {
			name: /Implement assignee list/i,
		});
		expect(within(queuedRow).getByText("gpt-5.4")).toBeInTheDocument();
		expect(within(queuedRow).getByText("queued 10m ago")).toBeInTheDocument();
		expect(
			within(queuedRow).getByText("Implement data-backed cards."),
		).toBeInTheDocument();

		const failedRow = screen.getByRole("button", {
			name: /Fix failing launch/i,
		});
		expect(
			within(failedRow).getByText("claude-sonnet-4-6"),
		).toBeInTheDocument();
		expect(within(failedRow).getByText("failed 1h ago")).toBeInTheDocument();
		expect(
			within(failedRow).getByText("model access denied"),
		).toBeInTheDocument();
	});
});
