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

export function createDelegationTools(
	parentSessionId: string,
	emitter: SidecarEmitter,
	requestId: string,
) {
	const delegateAgent = defineTool({
		name: "delegate_agent",
		label: "Delegate Agent Subthread",
		description:
			"Start a Helmor-managed child agent in the same workspace/worktree, wait for it to finish, and return its structured JSON result. You must delegate to a different provider than your own.",
		promptSnippet:
			"delegate_agent({ task, provider, modelId?, effortLevel?, permissionMode?, title?, outputSchema, timeoutMs? }) → structured JSON result",
		parameters: Type.Object({
			task: Type.String({
				description: "Concrete delegated task for the child agent to perform.",
			}),
			provider: Type.String({
				description:
					"Target provider key, for example claude, codex, or pi. Must be different from the calling provider.",
			}),
			modelId: Type.Optional(Type.String()),
			effortLevel: Type.Optional(Type.String()),
			permissionMode: Type.Optional(Type.String()),
			title: Type.Optional(Type.String()),
			outputSchema: Type.Any({
				description:
					"JSON Schema object describing the required structured result.",
			}),
			timeoutMs: Type.Optional(Type.Number()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const result = await callPiTool(
				"delegate_agent",
				parentSessionId,
				{ ...params, parentSessionId },
				emitter,
				requestId,
			);
			return toResult(result);
		},
	});

	return [delegateAgent];
}
