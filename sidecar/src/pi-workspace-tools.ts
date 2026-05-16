/**
 * Pi custom tools for Goal child workspace operations that normally live in
 * the inspector/commit controls: refresh PR/MR state, sync/push, merge, and
 * landing reconciliation. They reuse the Kanban tool bridge so the frontend
 * remains the Tauri IPC executor.
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { SidecarEmitter } from "./emitter.js";
import { callPiTool } from "./pi-kanban-tools.js";

function toResult(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		details: data,
	};
}

export function createWorkspaceOperationTools(
	goalWorkspaceId: string,
	emitter: SidecarEmitter,
	requestId: string,
) {
	const inspectWorkspace = defineTool({
		name: "inspect_workspace_merge_state",
		label: "Inspect Workspace Merge State",
		description:
			"Inspect a Goal child workspace before merging or marking landed. Returns local Git status, forge PR/MR status, refreshed change-request metadata, and the workspace's landing state. `card_id` is the child workspace id from list_kanban_cards.",
		promptSnippet:
			"inspect_workspace_merge_state({ card_id }) → git, forge, changeRequest, landing",
		parameters: Type.Object({
			card_id: Type.String({ description: "Child workspace id / card id" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"inspect_workspace_merge_state",
				goalWorkspaceId,
				{ goalWorkspaceId, cardId: params.card_id },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const refreshChangeRequest = defineTool({
		name: "refresh_change_request",
		label: "Refresh Change Request",
		description:
			"Refresh the PR/MR metadata for a Goal child workspace and update Helmor's cached status. Use before deciding whether a workspace can be merged or has already merged.",
		promptSnippet:
			"refresh_change_request({ card_id }) → current PR/MR metadata or null",
		parameters: Type.Object({
			card_id: Type.String({ description: "Child workspace id / card id" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"refresh_change_request",
				goalWorkspaceId,
				{ goalWorkspaceId, cardId: params.card_id },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const syncTargetBranch = defineTool({
		name: "sync_workspace_target_branch",
		label: "Sync Target Branch",
		description:
			"Pull the workspace's target branch into the child workspace using Helmor's safe sync operation. Use this to prepare a branch for manual conflict resolution before pushing or merging.",
		promptSnippet: "sync_workspace_target_branch({ card_id }) → sync outcome",
		parameters: Type.Object({
			card_id: Type.String({ description: "Child workspace id / card id" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"sync_workspace_target_branch",
				goalWorkspaceId,
				{ goalWorkspaceId, cardId: params.card_id },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const pushWorkspaceBranch = defineTool({
		name: "push_workspace_branch",
		label: "Push Workspace Branch",
		description:
			"Push a Goal child workspace branch to its configured remote. Use after local merge/conflict resolution work has produced commits that need to update the PR/MR.",
		promptSnippet: "push_workspace_branch({ card_id }) → push outcome",
		parameters: Type.Object({
			card_id: Type.String({ description: "Child workspace id / card id" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"push_workspace_branch",
				goalWorkspaceId,
				{ goalWorkspaceId, cardId: params.card_id },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const mergeChangeRequest = defineTool({
		name: "merge_change_request",
		label: "Merge Change Request",
		description:
			"Merge the open PR/MR for a Goal child workspace through the configured forge. Only use when the user has asked you to merge or the current task explicitly requires merging an already-reviewed change request.",
		promptSnippet:
			"merge_change_request({ card_id }) → merged PR/MR metadata or null",
		promptGuidelines: [
			"Inspect merge state first when you do not already know the PR/MR is open and mergeable.",
			"Do not use this for manual landings with no PR/MR; use check_workspace_landed or mark_workspace_landed instead.",
		],
		parameters: Type.Object({
			card_id: Type.String({ description: "Child workspace id / card id" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"merge_change_request",
				goalWorkspaceId,
				{ goalWorkspaceId, cardId: params.card_id },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const checkWorkspaceLanded = defineTool({
		name: "check_workspace_landed",
		label: "Check Workspace Landed",
		description:
			"Reconcile whether a Goal child workspace has landed in the goal branch. Use after manual merges, replacement PR branches, or direct branch ancestry checks before reporting work as merged.",
		promptSnippet: "check_workspace_landed({ card_id }) → landing state",
		parameters: Type.Object({
			card_id: Type.String({ description: "Child workspace id / card id" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"check_workspace_landed",
				goalWorkspaceId,
				{ goalWorkspaceId, cardId: params.card_id },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	const markWorkspaceLanded = defineTool({
		name: "mark_workspace_landed",
		label: "Mark Workspace Landed",
		description:
			"Manually mark a Goal child workspace as landed after the user or supervisor has confirmed the goal branch contains the work. This is a repair/override tool for cases Helmor cannot verify automatically.",
		promptSnippet: "mark_workspace_landed({ card_id }) → landing state",
		promptGuidelines: [
			"Prefer check_workspace_landed first.",
			"Only use this after explicit confirmation or strong evidence that the target branch contains the child work.",
		],
		parameters: Type.Object({
			card_id: Type.String({ description: "Child workspace id / card id" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"mark_workspace_landed",
				goalWorkspaceId,
				{ goalWorkspaceId, cardId: params.card_id },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	return [
		inspectWorkspace,
		refreshChangeRequest,
		syncTargetBranch,
		pushWorkspaceBranch,
		mergeChangeRequest,
		checkWorkspaceLanded,
		markWorkspaceLanded,
	];
}
