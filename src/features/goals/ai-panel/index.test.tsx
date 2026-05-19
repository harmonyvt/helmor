import { describe, expect, it, vi } from "vitest";
import type { AgentModelOption } from "@/lib/api";
import { createHelmorQueryClient, helmorQueryKeys } from "@/lib/query-client";
import { DEFAULT_SETTINGS, SettingsContext } from "@/lib/settings";
import { renderWithProviders } from "@/test/render-with-providers";
import { GoalsAiPanel } from "./index";

const conversationMockState = vi.hoisted(() => ({
	props: null as {
		preferredDefaultModelId?: string | null;
		modelFilter?: (model: AgentModelOption) => boolean;
		buildSendRequestExtras?: (context: {
			model: AgentModelOption;
			workspaceId: string | null;
			sessionId: string;
			prompt: string;
		}) => unknown;
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

const piModel: AgentModelOption = {
	id: "pi:azure-openai-responses/gpt-5.5",
	provider: "pi",
	label: "Pi · GPT-5.5",
	cliModel: "azure-openai-responses/gpt-5.5",
	supportsContextUsage: false,
};

const favouritePiModel: AgentModelOption = {
	id: "pi:anthropic/claude-sonnet-4-6",
	provider: "pi",
	label: "Pi · Claude Sonnet 4.6",
	cliModel: "anthropic/claude-sonnet-4-6",
	supportsContextUsage: false,
};

const codexModel: AgentModelOption = {
	id: "gpt-5.5",
	provider: "codex",
	label: "GPT-5.5",
	cliModel: "gpt-5.5",
	supportsContextUsage: true,
};

describe("GoalsAiPanel", () => {
	it("keeps the Goals AI surface scoped to Pi models", () => {
		renderWithProviders(
			<GoalsAiPanel
				workspaceId="goal-1"
				cards={[]}
				kanbanSnapshot="[]"
				onClose={() => {}}
			/>,
		);

		expect(conversationMockState.props?.modelFilter?.(piModel)).toBe(true);
		expect(conversationMockState.props?.modelFilter?.(codexModel)).toBe(false);
	});

	it("prefers the favourited Pi model as the default panel model", () => {
		const queryClient = createHelmorQueryClient();
		queryClient.setQueryData(helmorQueryKeys.agentModelSections, [
			{ id: "pi", label: "Pi", options: [piModel, favouritePiModel] },
		]);

		renderWithProviders(
			<SettingsContext.Provider
				value={{
					settings: {
						...DEFAULT_SETTINGS,
						favoriteModelIds: [favouritePiModel.id],
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
			favouritePiModel.id,
		);
	});

	it("passes Goal context extras to the conversation send request", () => {
		renderWithProviders(
			<GoalsAiPanel
				workspaceId="goal-1"
				cards={[]}
				kanbanSnapshot='[{"id":"child-1"}]'
				goalTitle="Launch goal"
				goalDescription="Coordinate the child workspaces"
				onClose={() => {}}
			/>,
		);

		expect(
			conversationMockState.props?.buildSendRequestExtras?.({
				model: piModel,
				workspaceId: "goal-1",
				sessionId: "session-1",
				prompt: "Plan this goal",
			}),
		).toEqual({
			kanbanWorkspaceId: "goal-1",
			kanbanSnapshot: '[{"id":"child-1"}]',
			goalTitle: "Launch goal",
			goalDescription: "Coordinate the child workspaces",
		});
	});
});
