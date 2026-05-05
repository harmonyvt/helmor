import { expect, test } from "@playwright/test";

test.describe("model picker regressions", () => {
	test("opens the large Pi model list in WebKit without a React update loop", async ({
		page,
	}) => {
		test.setTimeout(60_000);
		const pageErrors: string[] = [];
		page.on("pageerror", (error) => {
			pageErrors.push(error.message);
		});

		await page.addInitScript(() => {
			const piModels = Array.from({ length: 506 }, (_, index) => ({
				id: `pi:openai/model-${index}`,
				provider: "pi",
				label: `Pi · OpenAI: Model ${index}`,
				cliModel: `openai/model-${index}`,
				providerKey: "openai",
				effortLevels: ["low", "medium", "high"],
				supportsFastMode: false,
				supportsContextUsage: false,
			}));
			window.__HELMOR_E2E__ = {
				invokeOverrides: {
					get_app_settings: () => ({
						"app.onboarding_completed": "true",
						"app.default_model_id": "gpt-5.5",
						"app.favorite_model_ids": JSON.stringify(["gpt-5.5"]),
						"app.last_workspace_id": "workspace-model-picker",
						"app.last_session_id": "session-model-picker",
					}),
					list_agent_model_sections: () => [
						{
							id: "codex",
							label: "Codex",
							options: [
								{
									id: "gpt-5.5",
									provider: "codex",
									label: "GPT-5.5",
									cliModel: "gpt-5.5",
									effortLevels: ["low", "medium", "high", "xhigh"],
									supportsFastMode: true,
								},
							],
						},
						{
							id: "pi",
							label: "Pi",
							options: piModels,
						},
					],
					check_pi_models: () => ({
						status: "ok",
						models: piModels,
						providers: [{ key: "openai", label: "OpenAI", modelCount: 506 }],
						error: null,
					}),
					list_workspace_groups: () => [
						{
							id: "in-progress",
							label: "In Progress",
							tone: "progress",
							rows: [
								{
									id: "workspace-model-picker",
									title: "Model picker workspace",
									directoryName: "model-picker-workspace",
									repoName: "helmor",
									state: "ready",
									hasUnread: false,
									workspaceUnread: 0,
									sessionUnreadTotal: 0,
									unreadSessionCount: 0,
									derivedStatus: "in-progress",
									manualStatus: null,
									branch: "model-picker",
									activeSessionId: "session-model-picker",
									activeSessionTitle: "Model picker session",
									activeSessionAgentType: "codex",
									activeSessionStatus: "idle",
									sessionCount: 1,
									messageCount: 0,
								},
							],
						},
					],
					list_archived_workspaces: () => [],
					get_workspace: () => ({
						id: "workspace-model-picker",
						title: "Model picker workspace",
						repoId: "repo-model-picker",
						repoName: "helmor",
						repoIconSrc: null,
						repoInitials: "H",
						remote: "origin",
						remoteUrl: "git@github.com:example/helmor.git",
						defaultBranch: "main",
						rootPath: "/tmp/model-picker-workspace",
						directoryName: "model-picker-workspace",
						state: "ready",
						hasUnread: false,
						workspaceUnread: 0,
						sessionUnreadTotal: 0,
						unreadSessionCount: 0,
						derivedStatus: "in-progress",
						manualStatus: null,
						activeSessionId: "session-model-picker",
						activeSessionTitle: "Model picker session",
						activeSessionAgentType: "codex",
						activeSessionStatus: "idle",
						branch: "model-picker",
						initializationParentBranch: "main",
						intendedTargetBranch: "main",
						pinnedAt: null,
						prTitle: null,
						archiveCommit: null,
						sessionCount: 1,
						messageCount: 0,
					}),
					list_workspace_sessions: () => [
						{
							id: "session-model-picker",
							workspaceId: "workspace-model-picker",
							title: "Model picker session",
							agentType: "codex",
							status: "idle",
							model: "gpt-5.5",
							permissionMode: "bypassPermissions",
							providerSessionId: null,
							effortLevel: "high",
							unreadCount: 0,
							fastMode: false,
							createdAt: "2026-05-05T00:00:00.000Z",
							updatedAt: "2026-05-05T00:00:00.000Z",
							lastUserMessageAt: null,
							isHidden: false,
							actionKind: null,
							active: true,
						},
					],
					list_session_thread_messages: () => [],
					get_app_update_status: () => ({ status: "idle" }),
					update_app_settings: () => null,
					sync_global_hotkey: () => null,
					subscribe_ui_mutations: () => null,
					trigger_workspace_fetch: () => null,
					prewarm_slash_commands_for_workspace: () => null,
					load_repo_scripts: () => null,
					list_workspace_linked_directories: () => [],
					list_workspace_candidate_directories: () => [],
					get_codex_rate_limits: () => null,
					get_session_context_usage: () => null,
					get_workspace_pr_comments: () => ({
						comments: [],
						prNumber: null,
						prUrl: null,
					}),
					mark_session_read: () => null,
					get_auto_close_action_kinds: () => [],
					get_auto_close_opt_in_asked: () => false,
					load_auto_close_action_kinds: () => [],
					load_auto_close_opt_in_asked: () => [],
					list_slash_commands: () => [],
				},
			};
		});

		await page.goto("/");
		await expect(
			page.getByRole("tab", {
				name: "Model picker session",
				selected: true,
			}),
		).toBeVisible();

		await page.getByRole("button", { name: "Model: GPT-5.5" }).click();
		await expect(
			page.getByRole("listbox", { name: "Select model" }),
		).toBeVisible();
		await expect(page.getByText("Pi · OpenAI")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Pi · OpenAI: Model 0" }),
		).toBeVisible();

		expect(pageErrors).toEqual([]);
	});
});
