import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentModelOption, AgentStreamEvent } from "@/lib/api";
import { createHelmorQueryClient, helmorQueryKeys } from "@/lib/query-client";
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

describe("GoalsAiPanel", () => {
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
});
