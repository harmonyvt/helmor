import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModelOption, AgentStreamEvent } from "@/lib/api";
import { createHelmorQueryClient, helmorQueryKeys } from "@/lib/query-client";
import { DEFAULT_SETTINGS, SettingsContext } from "@/lib/settings";
import { renderWithProviders } from "@/test/render-with-providers";
import { GoalsAiPanel } from "./index";

const apiMockState = vi.hoisted(() => ({
	createGoalChildWorkspaceAndStart: vi.fn(),
	listGoalChildWorkspaces: vi.fn(),
	sendKanbanToolResult: vi.fn(),
}));

const conversationMockState = vi.hoisted(() => ({
	props: null as {
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
		listGoalChildWorkspaces: apiMockState.listGoalChildWorkspaces,
		sendKanbanToolResult: apiMockState.sendKanbanToolResult,
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

describe("GoalsAiPanel", () => {
	beforeEach(() => {
		apiMockState.createGoalChildWorkspaceAndStart.mockReset();
		apiMockState.listGoalChildWorkspaces.mockReset();
		apiMockState.sendKanbanToolResult.mockReset();
		conversationMockState.props = null;
	});

	it("forces child card starts to use the active Pi supervisor model", async () => {
		apiMockState.createGoalChildWorkspaceAndStart.mockResolvedValue({
			workspaceId: "child-1",
			sessionId: "session-1",
		});
		apiMockState.listGoalChildWorkspaces.mockResolvedValue([
			{ id: "child-1", title: "Child" },
		]);

		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(helmorQueryKeys.agentModelSections, [
			{ id: "pi", label: "Pi", options: [parentModel, otherModel] },
		]);

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
				assignedModelId: parentModel.id,
			}),
		);
		expect(apiMockState.sendKanbanToolResult).toHaveBeenCalledWith(
			"tool-1",
			expect.objectContaining({
				handoffModel: expect.objectContaining({
					requestedModelId: otherModel.id,
					resolvedModelId: parentModel.id,
				}),
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
		queryClient.setQueryData(helmorQueryKeys.agentModelSections, [
			{ id: "pi", label: "Pi", options: [parentModel] },
		]);

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

	it("falls back to an allowed assignee model when the active Pi supervisor model is disallowed", async () => {
		apiMockState.createGoalChildWorkspaceAndStart.mockResolvedValue({
			workspaceId: "child-1",
			sessionId: "session-1",
		});
		apiMockState.listGoalChildWorkspaces.mockResolvedValue([
			{ id: "child-1", title: "Child" },
		]);

		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(helmorQueryKeys.agentModelSections, [
			{
				id: "pi",
				label: "Pi",
				options: [otherModel, parentModel, disallowedModel],
			},
		]);

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
					resolvedModelId: otherModel.id,
					fallbackUsed: true,
					policyApplied: true,
					allowedModelIds: [otherModel.id, parentModel.id],
				}),
			}),
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
		queryClient.setQueryData(helmorQueryKeys.agentModelSections, [
			{
				id: "pi",
				label: "Pi",
				options: [parentModel, disallowedModel],
			},
		]);

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
});
