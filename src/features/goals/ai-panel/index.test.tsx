import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModelOption, AgentStreamEvent } from "@/lib/api";
import { createHelmorQueryClient, helmorQueryKeys } from "@/lib/query-client";
import { DEFAULT_SETTINGS, SettingsContext } from "@/lib/settings";
import { renderWithProviders } from "@/test/render-with-providers";
import { GoalsAiPanel } from "./index";

const apiMockState = vi.hoisted(() => ({
	createGoalChildWorkspaceAndStart: vi.fn(),
	loadWorkspaceForgeActionStatus: vi.fn(),
	loadWorkspaceGitActionStatus: vi.fn(),
	listGoalChildWorkspaces: vi.fn(),
	markWorkspaceLanded: vi.fn(),
	mergeWorkspaceChangeRequest: vi.fn(),
	pushWorkspaceToRemote: vi.fn(),
	reconcileWorkspaceLandingState: vi.fn(),
	refreshWorkspaceChangeRequest: vi.fn(),
	sendKanbanToolResult: vi.fn(),
	sendThreadMessage: vi.fn(),
	syncWorkspaceWithTargetBranch: vi.fn(),
}));

const conversationMockState = vi.hoisted(() => ({
	props: null as {
		preferredDefaultModelId?: string | null;
		buildSendRequestExtras?: (context: {
			model: AgentModelOption;
			workspaceId: string | null;
			sessionId: string;
			prompt: string;
		}) => unknown;
		onKanbanToolCall?: (
			event: Extract<AgentStreamEvent, { kind: "kanbanToolCall" }>,
		) => void;
	} | null,
}));

vi.mock("@/features/conversation", () => ({
	WorkspaceConversationContainer: (
		props: typeof conversationMockState.props,
	) => {
		conversationMockState.props = props;
		return <div data-testid="conversation" />;
	},
}));

vi.mock("@/lib/api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
	return {
		...actual,
		createGoalChildWorkspaceAndStart:
			apiMockState.createGoalChildWorkspaceAndStart,
		loadWorkspaceForgeActionStatus: apiMockState.loadWorkspaceForgeActionStatus,
		loadWorkspaceGitActionStatus: apiMockState.loadWorkspaceGitActionStatus,
		listGoalChildWorkspaces: apiMockState.listGoalChildWorkspaces,
		markWorkspaceLanded: apiMockState.markWorkspaceLanded,
		mergeWorkspaceChangeRequest: apiMockState.mergeWorkspaceChangeRequest,
		pushWorkspaceToRemote: apiMockState.pushWorkspaceToRemote,
		reconcileWorkspaceLandingState: apiMockState.reconcileWorkspaceLandingState,
		refreshWorkspaceChangeRequest: apiMockState.refreshWorkspaceChangeRequest,
		sendKanbanToolResult: apiMockState.sendKanbanToolResult,
		sendThreadMessage: apiMockState.sendThreadMessage,
		syncWorkspaceWithTargetBranch: apiMockState.syncWorkspaceWithTargetBranch,
	};
});

const parentModel: AgentModelOption = {
	id: "pi:azure-openai-responses/gpt-5.5",
	provider: "pi",
	label: "Pi · GPT-5.5",
	cliModel: "azure-openai-responses/gpt-5.5",
	supportsContextUsage: false,
};

const otherModel: AgentModelOption = {
	id: "pi:anthropic/claude-sonnet-4-6",
	provider: "pi",
	label: "Pi · Claude Sonnet 4.6",
	cliModel: "anthropic/claude-sonnet-4-6",
	supportsContextUsage: false,
};

const disallowedModel: AgentModelOption = {
	id: "pi:moonshot/kimi-k2",
	provider: "pi",
	label: "Pi · Kimi K2",
	cliModel: "moonshot/kimi-k2",
	providerKey: "moonshot",
	supportsContextUsage: false,
};

function modelSectionsWithPi(options: AgentModelOption[]) {
	return [
		{
			id: "claude",
			label: "Claude Code",
			options: [
				{
					id: "sonnet",
					provider: "claude" as const,
					label: "Sonnet",
					cliModel: "sonnet",
					supportsContextUsage: true,
				},
			],
		},
		{
			id: "codex",
			label: "Codex",
			options: [
				{
					id: "gpt-5.5",
					provider: "codex" as const,
					label: "GPT-5.5",
					cliModel: "gpt-5.5",
					supportsContextUsage: true,
				},
			],
		},
		{ id: "pi", label: "Pi", options },
	];
}

describe("GoalsAiPanel", () => {
	beforeEach(() => {
		apiMockState.createGoalChildWorkspaceAndStart.mockReset();
		apiMockState.loadWorkspaceForgeActionStatus.mockReset();
		apiMockState.loadWorkspaceGitActionStatus.mockReset();
		apiMockState.listGoalChildWorkspaces.mockReset();
		apiMockState.markWorkspaceLanded.mockReset();
		apiMockState.mergeWorkspaceChangeRequest.mockReset();
		apiMockState.pushWorkspaceToRemote.mockReset();
		apiMockState.reconcileWorkspaceLandingState.mockReset();
		apiMockState.refreshWorkspaceChangeRequest.mockReset();
		apiMockState.sendKanbanToolResult.mockReset();
		apiMockState.sendThreadMessage.mockReset();
		apiMockState.syncWorkspaceWithTargetBranch.mockReset();
		conversationMockState.props = null;
	});

	it("prefers the favourited Pi model as the default panel model", () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(helmorQueryKeys.agentModelSections, [
			{ id: "pi", label: "Pi", options: [parentModel, otherModel] },
		]);

		renderWithProviders(
			<SettingsContext.Provider
				value={{
					settings: {
						...DEFAULT_SETTINGS,
						favoriteModelIds: [otherModel.id],
					},
					isLoaded: true,
					updateSettings: vi.fn(),
				}}
			>
				<GoalsAiPanel
					workspaceId="goal-1"
					cards={[]}
					kanbanSnapshot="[]"
					onClose={() => {}}
				/>
			</SettingsContext.Provider>,
			{ queryClient },
		);

		expect(conversationMockState.props?.preferredDefaultModelId).toBe(
			otherModel.id,
		);
	});

	it("uses the assignee model selected by Pi from the user choice", async () => {
		apiMockState.createGoalChildWorkspaceAndStart.mockResolvedValue({
			workspaceId: "child-1",
			sessionId: "session-1",
		});
		apiMockState.listGoalChildWorkspaces.mockResolvedValue([
			{ id: "child-1", title: "Child" },
		]);

		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			modelSectionsWithPi([parentModel, otherModel]),
		);

		renderWithProviders(
			<GoalsAiPanel
				workspaceId="goal-1"
				cards={[]}
				kanbanSnapshot="[]"
				onClose={() => {}}
			/>,
			{ queryClient },
		);

		conversationMockState.props?.buildSendRequestExtras?.({
			model: parentModel,
			workspaceId: "goal-1",
			sessionId: "parent-session",
			prompt: "Plan this goal",
		});

		await act(async () => {
			conversationMockState.props?.onKanbanToolCall?.({
				kind: "kanbanToolCall",
				toolCallId: "tool-1",
				tool: "create_kanban_card",
				workspaceId: "goal-1",
				args: {
					title: "Child",
					lane: "backlog",
					assignedProvider: "claude",
					assignedModelId: otherModel.id,
					prompt: "Do the work",
				},
			});
		});

		expect(apiMockState.createGoalChildWorkspaceAndStart).toHaveBeenCalledWith(
			expect.objectContaining({
				assignedProvider: "pi",
				assignedModelId: otherModel.id,
			}),
		);
		expect(apiMockState.sendKanbanToolResult).toHaveBeenCalledWith(
			"tool-1",
			expect.objectContaining({
				handoffModel: expect.objectContaining({
					requestedModelId: otherModel.id,
					resolvedModelId: otherModel.id,
				}),
			}),
		);
	});

	it("returns assignee model choices for Pi to show the user", async () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			modelSectionsWithPi([otherModel, parentModel, disallowedModel]),
		);

		renderWithProviders(
			<GoalsAiPanel
				workspaceId="goal-1"
				cards={[]}
				kanbanSnapshot="[]"
				onClose={() => {}}
			/>,
			{ queryClient },
		);

		await act(async () => {
			conversationMockState.props?.onKanbanToolCall?.({
				kind: "kanbanToolCall",
				toolCallId: "models-tool",
				tool: "list_assignee_models",
				workspaceId: "goal-1",
				args: {},
			});
		});

		expect(apiMockState.sendKanbanToolResult).toHaveBeenCalledWith(
			"models-tool",
			expect.objectContaining({
				policy: "available-claude-and-codex-backed-pi-models",
				assigneeModels: [
					expect.objectContaining({ id: parentModel.id }),
					expect.objectContaining({ id: otherModel.id }),
				],
				claudeModels: expect.arrayContaining([
					expect.objectContaining({ id: "sonnet" }),
				]),
				codexModels: expect.arrayContaining([
					expect.objectContaining({ id: "gpt-5.5" }),
				]),
			}),
		);
	});

	it("serializes parallel create-card tool calls for the same goal", async () => {
		let resolveFirstCreate:
			| ((value: { workspaceId: string; sessionId: string }) => void)
			| null = null;
		apiMockState.createGoalChildWorkspaceAndStart
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFirstCreate = resolve;
					}),
			)
			.mockResolvedValueOnce({
				workspaceId: "child-2",
				sessionId: "session-2",
			});
		apiMockState.listGoalChildWorkspaces.mockResolvedValue([
			{ id: "child-1", title: "First" },
			{ id: "child-2", title: "Second" },
		]);

		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			modelSectionsWithPi([parentModel]),
		);

		renderWithProviders(
			<GoalsAiPanel
				workspaceId="goal-1"
				cards={[]}
				kanbanSnapshot="[]"
				onClose={() => {}}
			/>,
			{ queryClient },
		);

		const first = conversationMockState.props?.onKanbanToolCall?.({
			kind: "kanbanToolCall",
			toolCallId: "tool-1",
			tool: "create_kanban_card",
			workspaceId: "goal-1",
			args: { title: "First", lane: "backlog" },
		}) as unknown as Promise<void>;
		const second = conversationMockState.props?.onKanbanToolCall?.({
			kind: "kanbanToolCall",
			toolCallId: "tool-2",
			tool: "create_kanban_card",
			workspaceId: "goal-1",
			args: { title: "Second", lane: "backlog" },
		}) as unknown as Promise<void>;

		await waitFor(() => {
			expect(
				apiMockState.createGoalChildWorkspaceAndStart,
			).toHaveBeenCalledTimes(1);
		});

		await act(async () => {
			resolveFirstCreate?.({
				workspaceId: "child-1",
				sessionId: "session-1",
			});
			await first;
		});

		await waitFor(() => {
			expect(
				apiMockState.createGoalChildWorkspaceAndStart,
			).toHaveBeenCalledTimes(2);
		});

		await act(async () => {
			await second;
		});

		expect(
			apiMockState.createGoalChildWorkspaceAndStart,
		).toHaveBeenNthCalledWith(1, expect.objectContaining({ title: "First" }));
		expect(
			apiMockState.createGoalChildWorkspaceAndStart,
		).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: "Second" }));
	});

	it("executes merge and landing tools against the selected child workspace", async () => {
		apiMockState.listGoalChildWorkspaces.mockResolvedValue([]);
		apiMockState.mergeWorkspaceChangeRequest.mockResolvedValue({
			url: "https://example.test/pr/1",
			number: 1,
			state: "MERGED",
			title: "PR",
			isMerged: true,
		});
		apiMockState.markWorkspaceLanded.mockResolvedValue({
			workspaceId: "child-1",
			landingState: "landed",
			landingSource: "manual-repair",
			changed: true,
		});

		renderWithProviders(
			<GoalsAiPanel
				workspaceId="goal-1"
				cards={[]}
				kanbanSnapshot="[]"
				onClose={() => {}}
			/>,
		);

		await act(async () => {
			conversationMockState.props?.onKanbanToolCall?.({
				kind: "kanbanToolCall",
				toolCallId: "merge-tool",
				tool: "merge_change_request",
				workspaceId: "goal-1",
				args: { cardId: "child-1" },
			});
		});
		await act(async () => {
			conversationMockState.props?.onKanbanToolCall?.({
				kind: "kanbanToolCall",
				toolCallId: "land-tool",
				tool: "mark_workspace_landed",
				workspaceId: "goal-1",
				args: { card_id: "child-1" },
			});
		});

		expect(apiMockState.mergeWorkspaceChangeRequest).toHaveBeenCalledWith(
			"child-1",
		);
		expect(apiMockState.markWorkspaceLanded).toHaveBeenCalledWith("child-1");
		expect(apiMockState.sendKanbanToolResult).toHaveBeenCalledWith(
			"merge-tool",
			expect.objectContaining({ state: "MERGED" }),
		);
		expect(apiMockState.sendKanbanToolResult).toHaveBeenCalledWith(
			"land-tool",
			expect.objectContaining({ landingState: "landed" }),
		);
	});

	it("rejects starting an assignee until Pi passes the user-selected model", async () => {
		apiMockState.createGoalChildWorkspaceAndStart.mockResolvedValue({
			workspaceId: "child-1",
			sessionId: "session-1",
		});
		apiMockState.listGoalChildWorkspaces.mockResolvedValue([
			{ id: "child-1", title: "Child" },
		]);

		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			modelSectionsWithPi([otherModel, parentModel, disallowedModel]),
		);

		renderWithProviders(
			<GoalsAiPanel
				workspaceId="goal-1"
				cards={[]}
				kanbanSnapshot="[]"
				onClose={() => {}}
			/>,
			{ queryClient },
		);

		await act(async () => {
			conversationMockState.props?.onKanbanToolCall?.({
				kind: "kanbanToolCall",
				toolCallId: "tool-1",
				tool: "create_kanban_card",
				workspaceId: "goal-1",
				args: {
					title: "Child",
					lane: "backlog",
					prompt: "Do the work",
				},
			});
		});

		expect(
			apiMockState.createGoalChildWorkspaceAndStart,
		).not.toHaveBeenCalled();
		expect(apiMockState.sendKanbanToolResult).toHaveBeenCalledWith(
			"tool-1",
			expect.objectContaining({
				message: expect.stringContaining("Choose an assignee model"),
			}),
			true,
		);
	});

	it("allows every assignee Pi provider when the settings override is enabled", async () => {
		apiMockState.createGoalChildWorkspaceAndStart.mockResolvedValue({
			workspaceId: "child-1",
			sessionId: "session-1",
		});
		apiMockState.listGoalChildWorkspaces.mockResolvedValue([
			{ id: "child-1", title: "Child" },
		]);

		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			modelSectionsWithPi([parentModel, disallowedModel]),
		);

		renderWithProviders(
			<SettingsContext.Provider
				value={{
					settings: {
						...DEFAULT_SETTINGS,
						allowAllGoalAssigneePiModels: true,
					},
					isLoaded: true,
					updateSettings: vi.fn(),
				}}
			>
				<GoalsAiPanel
					workspaceId="goal-1"
					cards={[]}
					kanbanSnapshot="[]"
					onClose={() => {}}
				/>
			</SettingsContext.Provider>,
			{ queryClient },
		);

		conversationMockState.props?.buildSendRequestExtras?.({
			model: disallowedModel,
			workspaceId: "goal-1",
			sessionId: "parent-session",
			prompt: "Plan this goal",
		});

		await act(async () => {
			conversationMockState.props?.onKanbanToolCall?.({
				kind: "kanbanToolCall",
				toolCallId: "tool-1",
				tool: "create_kanban_card",
				workspaceId: "goal-1",
				args: {
					title: "Child",
					lane: "backlog",
					assignedModelId: disallowedModel.id,
					prompt: "Do the work",
				},
			});
		});

		expect(apiMockState.createGoalChildWorkspaceAndStart).toHaveBeenCalledWith(
			expect.objectContaining({
				assignedProvider: "pi",
				assignedModelId: disallowedModel.id,
			}),
		);
		expect(apiMockState.sendKanbanToolResult).toHaveBeenCalledWith(
			"tool-1",
			expect.objectContaining({
				handoffModel: expect.objectContaining({
					resolvedModelId: disallowedModel.id,
					fallbackUsed: false,
					policyApplied: false,
				}),
			}),
		);
	});

	it("keeps targeted thread sends on the thread's configured assignee model", async () => {
		apiMockState.sendThreadMessage.mockResolvedValue({
			queued: true,
			started: true,
			executionState: "spawned",
			sessionId: "thread-1",
			workspaceId: "child-1",
			pendingSendId: "pending-1",
			message: "Continue",
			supervisorMessageId: null,
		});

		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(
			helmorQueryKeys.agentModelSections,
			modelSectionsWithPi([parentModel, otherModel]),
		);

		renderWithProviders(
			<GoalsAiPanel
				workspaceId="goal-1"
				cards={[]}
				kanbanSnapshot="[]"
				onClose={() => {}}
			/>,
			{ queryClient },
		);

		conversationMockState.props?.buildSendRequestExtras?.({
			model: parentModel,
			workspaceId: "goal-1",
			sessionId: "parent-session",
			prompt: "Plan this goal",
		});

		await act(async () => {
			conversationMockState.props?.onKanbanToolCall?.({
				kind: "kanbanToolCall",
				toolCallId: "thread-tool",
				tool: "send_thread_message",
				workspaceId: "goal-1",
				args: {
					workspace_id: "child-1",
					thread_id: "thread-1",
					message: "Continue",
				},
			});
		});

		expect(apiMockState.sendThreadMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				goalWorkspaceId: "goal-1",
				workspaceId: "child-1",
				threadId: "thread-1",
				message: "Continue",
				modelId: null,
			}),
		);
	});
});
