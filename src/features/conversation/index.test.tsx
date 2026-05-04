import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanReviewPart, ThreadMessageLike } from "@/lib/api";
import { createHelmorQueryClient, helmorQueryKeys } from "@/lib/query-client";

const apiMockState = vi.hoisted(() => ({
	createSession: vi.fn(),
}));

const composerMockState = vi.hoisted(() => ({
	lastPlanReview: null as PlanReviewPart | null,
	lastOnImplementPlanInCleanThread: null as
		| ((plan: PlanReviewPart) => void | Promise<void>)
		| null,
}));

vi.mock("@/lib/api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
	return {
		...actual,
		createSession: apiMockState.createSession,
	};
});

vi.mock("./hooks/use-streaming", () => ({
	useConversationStreaming: () => ({
		activeSendError: null,
		handleComposerSubmit: vi.fn(),
		handleDeferredToolResponse: vi.fn(),
		handleElicitationResponse: vi.fn(),
		handlePermissionResponse: vi.fn(),
		handleStopStream: vi.fn(),
		handleSteerQueued: vi.fn(),
		handleRemoveQueued: vi.fn(),
		elicitationResponsePending: false,
		isSending: false,
		pendingElicitation: null,
		pendingDeferredTool: null,
		pendingPermissions: [],
		restoreCustomTags: [],
		restoreDraft: null,
		restoreFiles: [],
		restoreImages: [],
		restoreNonce: 0,
		sendingSessionIds: new Set<string>(),
	}),
}));

vi.mock("@/lib/settings", () => ({
	useSettings: () => ({ settings: { followUpBehavior: "queue" } }),
}));

vi.mock("@/lib/use-submit-queue", () => ({
	EMPTY_QUEUE: [],
	useSubmitQueue: () => ({
		queuesBySessionId: new Map(),
		api: {
			enqueue: vi.fn(),
			remove: vi.fn(),
			shift: vi.fn(),
		},
	}),
}));

vi.mock("@/features/panel/container", () => ({
	WorkspacePanelContainer: () => <div data-testid="panel" />,
}));

vi.mock("@/features/panel/message-components/file-link-context", () => ({
	FileLinkProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/features/composer/container", () => ({
	WorkspaceComposerContainer: (props: {
		planReview?: PlanReviewPart | null;
		onImplementPlanInCleanThread?: (
			plan: PlanReviewPart,
		) => void | Promise<void>;
	}) => {
		composerMockState.lastPlanReview = props.planReview ?? null;
		composerMockState.lastOnImplementPlanInCleanThread =
			props.onImplementPlanInCleanThread ?? null;
		return <div data-testid="composer" />;
	},
}));

import { WorkspaceConversationContainer } from "./index";

function planReviewPart(): PlanReviewPart {
	return {
		type: "plan-review",
		toolUseId: "tool-plan-1",
		toolName: "ExitPlanMode",
		plan: "1. Update the UI",
		planFilePath: "/tmp/plan.md",
		allowedPrompts: [],
	};
}

function planReviewMessage(part = planReviewPart()): ThreadMessageLike {
	return {
		role: "assistant",
		id: "msg-plan",
		content: [part],
	};
}

describe("WorkspaceConversationContainer", () => {
	beforeEach(() => {
		apiMockState.createSession.mockReset();
		apiMockState.createSession.mockResolvedValue({
			sessionId: "session-clean",
		});
		composerMockState.lastPlanReview = null;
		composerMockState.lastOnImplementPlanInCleanThread = null;
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("creates a new session and queues the visible plan prompt for clean-thread implementation", async () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			[...helmorQueryKeys.sessionMessages("session-1"), "thread"],
			[planReviewMessage()],
		);
		const onQueuePendingPromptForSession = vi.fn();
		const onSelectSession = vi.fn();

		render(
			<QueryClientProvider client={queryClient}>
				<WorkspaceConversationContainer
					selectedWorkspaceId="workspace-1"
					displayedWorkspaceId="workspace-1"
					selectedSessionId="session-1"
					displayedSessionId="session-1"
					onSelectSession={onSelectSession}
					onResolveDisplayedSession={vi.fn()}
					onQueuePendingPromptForSession={onQueuePendingPromptForSession}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() => {
			expect(composerMockState.lastPlanReview?.plan).toBe("1. Update the UI");
		});
		await composerMockState.lastOnImplementPlanInCleanThread?.(
			composerMockState.lastPlanReview!,
		);

		expect(apiMockState.createSession).toHaveBeenCalledWith("workspace-1", {
			permissionMode: "bypassPermissions",
		});
		await waitFor(() => {
			expect(onQueuePendingPromptForSession).toHaveBeenCalledWith({
				sessionId: "session-clean",
				prompt:
					"Implement this plan in a clean thread:\n\nPlan file: /tmp/plan.md\n\n1. Update the UI",
				permissionMode: "bypassPermissions",
			});
		});
		expect(onSelectSession).toHaveBeenCalledWith("session-clean");
	});
});
