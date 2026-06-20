/**
 * SessionManager backed by the Cursor TypeScript SDK.
 *
 * The first implementation uses Cursor's local runtime so Helmor keeps its
 * existing local-first workspace semantics. Each Helmor session maps to one
 * durable Cursor agent id; follow-up turns resume that agent through the SDK.
 */

import { extname } from "node:path";
import {
	Agent,
	Cursor,
	type ModelSelection,
	type Run,
	type SDKAgent,
	type SDKImage,
	type SDKMessage,
	type SDKUserMessage,
} from "@cursor/sdk";
import type { SidecarEmitter } from "./emitter.js";
import { readImageWithResize } from "./image-resize.js";
import { parseImageRefs } from "./images.js";
import { errorDetails, logger } from "./logger.js";
import { listProviderModels } from "./model-catalog.js";
import type {
	GenerateTitleOptions,
	ListSlashCommandsParams,
	ProviderModelInfo,
	SendMessageParams,
	SessionManager,
	SlashCommandInfo,
} from "./session-manager.js";
import { parseTitleAndBranch } from "./title.js";

interface LiveCursorSession {
	readonly agent: SDKAgent;
	readonly run: Run;
}

function modelSelection(
	model: string | undefined,
	effortLevel: string | undefined,
): ModelSelection {
	const selection: ModelSelection = {
		id: model?.trim() || "composer-2.5",
	};
	if (effortLevel) {
		selection.params = [{ id: "thinking", value: effortLevel }];
	}
	return selection;
}

function extToMimeType(filePath: string): string {
	switch (extname(filePath).toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".gif":
			return "image/gif";
		case ".webp":
			return "image/webp";
		default:
			return "image/png";
	}
}

async function buildCursorUserMessage(
	text: string,
	imagePaths: readonly string[],
): Promise<string | SDKUserMessage> {
	if (imagePaths.length === 0) return text;
	const images: SDKImage[] = [];
	for (const imagePath of imagePaths) {
		const { buffer } = await readImageWithResize(imagePath);
		images.push({
			data: buffer.toString("base64"),
			mimeType: extToMimeType(imagePath),
		});
	}
	return { text, images };
}

function titleFromUserMessage(userMessage: string): string {
	const trimmed = userMessage.replace(/\s+/g, " ").trim();
	if (!trimmed) return "Cursor session";
	return trimmed.length > 60 ? `${trimmed.slice(0, 57).trimEnd()}...` : trimmed;
}

function branchFromTitle(title: string): string | undefined {
	const branch = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.split("-")
		.slice(0, 4)
		.join("-");
	return branch || undefined;
}

function cursorSessionEvent(
	agent: SDKAgent,
	run: Run,
	event: SDKMessage,
): Record<string, unknown> {
	const common = {
		session_id: agent.agentId,
		cursor_agent_id: agent.agentId,
		cursor_run_id: run.id,
	};
	switch (event.type) {
		case "thinking":
			return {
				type: "assistant",
				...common,
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: event.text }],
				},
			};
		case "tool_call":
			return {
				type: "system",
				subtype: "cursor_tool_call",
				...common,
				tool_name: event.name,
				status: event.status,
			};
		case "status":
			return {
				type: "system",
				subtype: "cursor_status",
				...common,
				status: event.status,
				message: event.message,
			};
		case "task":
			return {
				type: "system",
				subtype: "cursor_task",
				...common,
				status: event.status,
				message: event.text,
			};
		case "request":
			return {
				type: "system",
				subtype: "cursor_request",
				...common,
				request_id: event.request_id,
			};
		default:
			return {
				...event,
				...common,
			};
	}
}

function cursorResultEvent(
	agent: SDKAgent,
	run: Run,
	status: string,
	result: string | undefined,
): Record<string, unknown> {
	return {
		type: "result",
		subtype: status,
		session_id: agent.agentId,
		cursor_agent_id: agent.agentId,
		cursor_run_id: run.id,
		result: result ?? "",
		duration_ms: run.durationMs,
	};
}

export class CursorSessionManager implements SessionManager {
	private readonly sessions = new Map<string, LiveCursorSession>();

	async sendMessage(
		requestId: string,
		params: SendMessageParams,
		emitter: SidecarEmitter,
	): Promise<void> {
		const cwd = params.cwd?.trim() || process.cwd();
		const localCwd =
			params.additionalDirectories && params.additionalDirectories.length > 0
				? [cwd, ...params.additionalDirectories]
				: cwd;
		const model = modelSelection(params.model, params.effortLevel);
		const agent = params.resume
			? await Agent.resume(params.resume, { model, local: { cwd: localCwd } })
			: await Agent.create({
					model,
					local: { cwd: localCwd },
					mode: params.permissionMode === "plan" ? "plan" : "agent",
				} as Parameters<typeof Agent.create>[0] & {
					mode?: "plan" | "agent";
				});

		const { text, imagePaths } = parseImageRefs(params.prompt, params.images);
		const message = await buildCursorUserMessage(text, imagePaths);
		const run = await agent.send(message, {
			model,
			mode: params.permissionMode === "plan" ? "plan" : "agent",
			local: { force: true },
		} as Parameters<SDKAgent["send"]>[1] & { mode?: "plan" | "agent" });
		this.sessions.set(params.sessionId, { agent, run });

		try {
			emitter.passthrough(requestId, {
				type: "system",
				subtype: "init",
				session_id: agent.agentId,
				cursor_agent_id: agent.agentId,
				cursor_run_id: run.id,
				model,
			});
			for await (const event of run.stream()) {
				logger.sdkEvent(requestId, event);
				emitter.passthrough(requestId, cursorSessionEvent(agent, run, event));
			}
			const result = run.result
				? {
						status: run.status === "running" ? "finished" : run.status,
						result: run.result,
					}
				: await run.wait();
			if (result.status === "error") {
				emitter.error(requestId, result.result ?? "Cursor run failed");
				return;
			}
			if (result.status === "cancelled") {
				emitter.aborted(requestId, "user_requested");
				return;
			}
			emitter.passthrough(
				requestId,
				cursorResultEvent(agent, run, result.status, result.result),
			);
			emitter.end(requestId);
		} finally {
			this.sessions.delete(params.sessionId);
			agent.close();
		}
	}

	generateTitle(
		requestId: string,
		userMessage: string,
		_branchRenamePrompt: string | null,
		emitter: SidecarEmitter,
		_timeoutMs?: number,
		_options?: GenerateTitleOptions,
	): Promise<void> {
		const title = titleFromUserMessage(userMessage);
		const parsed = parseTitleAndBranch(
			[`title: ${title}`, `branch: ${branchFromTitle(title) ?? ""}`]
				.filter(Boolean)
				.join("\n"),
		);
		emitter.titleGenerated(requestId, parsed.title, parsed.branchName);
		return Promise.resolve();
	}

	listSlashCommands(
		_params: ListSlashCommandsParams,
	): Promise<readonly SlashCommandInfo[]> {
		return Promise.resolve([]);
	}

	async listModels(): Promise<readonly ProviderModelInfo[]> {
		try {
			const models = await Cursor.models.list();
			return models.map((model) => ({
				id: `cursor:${model.id}`,
				label: model.displayName || model.id,
				cliModel: model.id,
				effortLevels: model.parameters?.some(
					(parameter) => parameter.id === "thinking",
				)
					? model.parameters
							.find((parameter) => parameter.id === "thinking")
							?.values.map((value) => value.value)
					: undefined,
			}));
		} catch (error) {
			logger.info("Cursor model list failed; falling back to static catalog", {
				...errorDetails(error),
			});
			return listProviderModels("cursor");
		}
	}

	async stopSession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		try {
			await session.run.cancel();
		} finally {
			session.agent.close();
			this.sessions.delete(sessionId);
		}
	}

	steer(
		_sessionId: string,
		_prompt: string,
		_files: readonly string[],
		_images: readonly string[],
	): Promise<boolean> {
		return Promise.resolve(false);
	}

	async shutdown(): Promise<void> {
		const sessions = [...this.sessions.entries()];
		this.sessions.clear();
		await Promise.allSettled(
			sessions.map(async ([_sessionId, session]) => {
				try {
					await session.run.cancel();
				} finally {
					session.agent.close();
				}
			}),
		);
	}
}
