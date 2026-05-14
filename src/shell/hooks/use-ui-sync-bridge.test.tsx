import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadMessageLike, UiMutationEvent } from "@/lib/api";
import { helmorQueryKeys } from "@/lib/query-client";
import { sessionThreadCacheKey } from "@/lib/session-thread-cache";
import { useUiSyncBridge } from "./use-ui-sync-bridge";

const apiMocks = vi.hoisted(() => ({
	subscribeUiMutations: vi.fn(),
}));

let capturedSubscription: ((event: UiMutationEvent) => void) | null = null;

vi.mock("@/lib/api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
	return {
		...actual,
		subscribeUiMutations: apiMocks.subscribeUiMutations.mockImplementation(
			async (callback: (event: UiMutationEvent) => void) => {
				capturedSubscription = callback;
			},
		),
	};
});

function makeClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
}

function makeMessage(
	id: string,
	role: "user" | "assistant",
	text: string,
	streaming = false,
): ThreadMessageLike {
	return {
		id,
		role,
		createdAt: "2026-05-14T00:00:00Z",
		streaming,
		content: [{ type: "text", id: `${id}:txt:0`, text }],
	};
}

describe("useUiSyncBridge", () => {
	beforeEach(() => {
		capturedSubscription = null;
		apiMocks.subscribeUiMutations.mockClear();
	});

	it("invalidates the expected query families for workspace git state changes", async () => {
		const queryClient = makeClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

		renderHook(() =>
			useUiSyncBridge({
				queryClient,
				processPendingCliSends: vi.fn(),
				reloadSettings: vi.fn(),
				refreshGithubIdentity: vi.fn(),
			}),
		);

		expect(apiMocks.subscribeUiMutations).toHaveBeenCalledOnce();
		expect(capturedSubscription).not.toBeNull();

		act(() => {
			capturedSubscription?.({
				type: "workspaceGitStateChanged",
				workspaceId: "workspace-1",
			});
		});

		await waitFor(() => {
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: helmorQueryKeys.workspaceGroups,
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: helmorQueryKeys.workspaceDetail("workspace-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: helmorQueryKeys.workspaceGitActionStatus("workspace-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: helmorQueryKeys.workspaceForgeActionStatus("workspace-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				predicate: expect.any(Function),
			});
		});
	});

	it("replays pending CLI sends immediately instead of waiting for focus", async () => {
		const queryClient = makeClient();
		const processPendingCliSends = vi.fn();

		renderHook(() =>
			useUiSyncBridge({
				queryClient,
				processPendingCliSends,
				reloadSettings: vi.fn(),
				refreshGithubIdentity: vi.fn(),
			}),
		);

		act(() => {
			capturedSubscription?.({
				type: "pendingCliSendQueued",
				pendingSendId: "pending-1",
				workspaceId: "workspace-1",
				sessionId: "session-1",
				prompt: "hello",
				modelId: "gpt-5.4",
				permissionMode: "default",
			});
		});

		await waitFor(() => {
			expect(processPendingCliSends).toHaveBeenCalledOnce();
		});
	});

	it("invalidates goal assignee lists when session messages change", async () => {
		const queryClient = makeClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

		renderHook(() =>
			useUiSyncBridge({
				queryClient,
				processPendingCliSends: vi.fn(),
				reloadSettings: vi.fn(),
				refreshGithubIdentity: vi.fn(),
			}),
		);

		act(() => {
			capturedSubscription?.({
				type: "sessionMessagesChanged",
				workspaceId: "child-workspace-1",
				sessionId: "session-1",
			});
		});

		await waitFor(() => {
			expect(invalidateQueries).toHaveBeenCalledWith({
				predicate: expect.any(Function),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: [...helmorQueryKeys.sessionMessages("session-1"), "thread"],
			});
		});
	});

	it("defers thread refetches that would overwrite active stream cache", async () => {
		const queryClient = makeClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const threadKey = sessionThreadCacheKey("session-1");

		renderHook(() =>
			useUiSyncBridge({
				queryClient,
				processPendingCliSends: vi.fn(),
				reloadSettings: vi.fn(),
				refreshGithubIdentity: vi.fn(),
			}),
		);

		act(() => {
			capturedSubscription?.({
				type: "sessionStreamEvent",
				workspaceId: "child-workspace-1",
				sessionId: "session-1",
				event: {
					kind: "streamingPartial",
					message: makeMessage("assistant-1", "assistant", "partial", true),
				},
			});
		});

		act(() => {
			capturedSubscription?.({
				type: "sessionMessagesChanged",
				workspaceId: "child-workspace-1",
				sessionId: "session-1",
			});
		});

		expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: threadKey });
		expect(queryClient.getQueryData<ThreadMessageLike[]>(threadKey)).toEqual([
			expect.objectContaining({ id: "assistant-1", streaming: true }),
		]);

		act(() => {
			capturedSubscription?.({
				type: "sessionStreamEvent",
				workspaceId: "child-workspace-1",
				sessionId: "session-1",
				event: {
					kind: "update",
					messages: [makeMessage("assistant-1", "assistant", "final", false)],
				},
			});
		});

		await waitFor(() => {
			expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: threadKey });
		});
	});

	it("patches background streaming deltas without invalidating session lists per tick", () => {
		const queryClient = makeClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const threadKey = sessionThreadCacheKey("session-1");
		const workspaceSessionsKey =
			helmorQueryKeys.workspaceSessions("workspace-1");

		renderHook(() =>
			useUiSyncBridge({
				queryClient,
				processPendingCliSends: vi.fn(),
				reloadSettings: vi.fn(),
				refreshGithubIdentity: vi.fn(),
			}),
		);

		act(() => {
			capturedSubscription?.({
				type: "sessionStreamEvent",
				workspaceId: "workspace-1",
				sessionId: "session-1",
				event: {
					kind: "streamingPartial",
					message: makeMessage("assistant-1", "assistant", "partial", true),
				},
			});
		});

		act(() => {
			capturedSubscription?.({
				type: "sessionStreamEvent",
				workspaceId: "workspace-1",
				sessionId: "session-1",
				event: {
					kind: "streamingDelta",
					delta: {
						messageId: "assistant-1",
						partId: "assistant-1:txt:0",
						partType: "text",
						textDelta: " delta",
					},
				},
			});
		});

		const cached = queryClient.getQueryData<ThreadMessageLike[]>(threadKey);
		const latestPart = cached?.[0]?.content[0];
		expect(latestPart?.type).toBe("text");
		if (latestPart?.type === "text") {
			expect(latestPart.text).toBe("partial delta");
		}
		expect(invalidateQueries).not.toHaveBeenCalledWith({
			queryKey: workspaceSessionsKey,
		});
	});

	it("invalidates forge detection when forge state changes", async () => {
		const queryClient = makeClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

		renderHook(() =>
			useUiSyncBridge({
				queryClient,
				processPendingCliSends: vi.fn(),
				reloadSettings: vi.fn(),
				refreshGithubIdentity: vi.fn(),
			}),
		);

		act(() => {
			capturedSubscription?.({
				type: "workspaceForgeChanged",
				workspaceId: "workspace-1",
			});
		});

		await waitFor(() => {
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: helmorQueryKeys.workspaceForge("workspace-1"),
			});
		});
		// Settings → Account stores CLI auth under a separate cache key; the
		// bridge fans the same backend signal out to it so a stale "ready"
		// in Account can't survive an auth flip detected elsewhere.
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: helmorQueryKeys.forgeCliStatusAll,
		});
	});

	it("invalidates baseline + rich on contextUsageChanged", async () => {
		const queryClient = makeClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

		renderHook(() =>
			useUiSyncBridge({
				queryClient,
				processPendingCliSends: vi.fn(),
				reloadSettings: vi.fn(),
				refreshGithubIdentity: vi.fn(),
			}),
		);

		act(() => {
			capturedSubscription?.({
				type: "contextUsageChanged",
				sessionId: "session-7",
			});
		});

		await waitFor(() => {
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: helmorQueryKeys.sessionContextUsage("session-7"),
			});
		});
		// And a predicate-based invalidate for rich entries scoped to
		// this session (any providerSessionId / model).
		expect(invalidateQueries).toHaveBeenCalledWith(
			expect.objectContaining({ predicate: expect.any(Function) }),
		);
		expect(invalidateQueries).toHaveBeenCalledTimes(2);
	});

	it("reloads settings and refreshes auto-close queries on settings changes", async () => {
		const queryClient = makeClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const reloadSettings = vi.fn();

		renderHook(() =>
			useUiSyncBridge({
				queryClient,
				processPendingCliSends: vi.fn(),
				reloadSettings,
				refreshGithubIdentity: vi.fn(),
			}),
		);

		act(() => {
			capturedSubscription?.({
				type: "settingsChanged",
				key: "auto_close_action_kinds",
			});
		});

		await waitFor(() => {
			expect(reloadSettings).not.toHaveBeenCalled();
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: helmorQueryKeys.autoCloseActionKinds,
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: helmorQueryKeys.autoCloseOptInAsked,
			});
		});

		act(() => {
			capturedSubscription?.({
				type: "settingsChanged",
				key: "app.default_model_id",
			});
		});

		await waitFor(() => {
			expect(reloadSettings).toHaveBeenCalledOnce();
		});
	});
});
