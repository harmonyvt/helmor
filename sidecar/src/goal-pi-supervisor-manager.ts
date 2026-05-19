import {
	createGoalSupervisorTurn,
	type GoalSupervisorTurn,
	type PiImageContent,
} from "@helmor/pi-goal-supervisor";
import type { SidecarEmitter } from "./emitter.js";
import { readImageWithResize } from "./image-resize.js";
import { parseImageRefs } from "./images.js";
import { prependLinkedDirectoriesContext } from "./linked-directories-context.js";
import { errorDetails, logger } from "./logger.js";
import { createPiEventState, normalizePiEvent } from "./pi-event-normalizer.js";
import {
	PiNoProgressTimeoutError,
	PiProgressWatchdog,
	resolvePiNoProgressTimeoutMs,
} from "./pi-session-manager.js";
import type {
	ProviderModelInfo,
	SendMessageParams,
} from "./session-manager.js";

type PendingToolCall = {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
};

type LiveGoalPiSupervisor = {
	readonly turn: GoalSupervisorTurn;
	readonly requestId: string;
	readonly emitter: SidecarEmitter;
	active: boolean;
};

export class GoalPiSupervisorManager {
	private readonly sessions = new Map<string, LiveGoalPiSupervisor>();
	private readonly pendingTools = new Map<string, PendingToolCall>();

	async sendMessage(
		requestId: string,
		params: SendMessageParams,
		emitter: SidecarEmitter,
	): Promise<void> {
		if (!params.kanbanWorkspaceId) {
			throw new Error("Goal Pi supervisor requires kanbanWorkspaceId");
		}

		let live: LiveGoalPiSupervisor | undefined;
		let progressWatchdog: PiProgressWatchdog | undefined;
		try {
			const promptWithContext = prependLinkedDirectoriesContext(
				params.prompt,
				params.additionalDirectories,
			);
			const { text, imagePaths } = parseImageRefs(
				promptWithContext,
				params.images,
			);
			const state = createPiEventState(requestId, {
				capturePlanReview: params.permissionMode === "plan",
			});
			const turn = await createGoalSupervisorTurn({
				requestId,
				params: {
					sessionId: params.sessionId,
					prompt: text || promptWithContext,
					model: params.model,
					cwd: params.cwd,
					resume: params.resume,
					permissionMode: params.permissionMode,
					effortLevel: params.effortLevel,
					additionalDirectories: params.additionalDirectories,
					kanbanWorkspaceId: params.kanbanWorkspaceId,
					kanbanSnapshot: params.kanbanSnapshot,
					goalTitle: params.goalTitle,
					goalDescription: params.goalDescription,
				},
				images: await buildPiImages(imagePaths),
				bridge: {
					callTool: (call) => {
						progressWatchdog?.markProgress();
						const promise = new Promise<unknown>((resolve, reject) => {
							this.pendingTools.set(call.toolCallId, { resolve, reject });
						});
						emitter.kanbanToolCall(
							requestId,
							call.toolCallId,
							call.tool,
							call.workspaceId,
							call.args,
						);
						return promise;
					},
				},
				onEvent: (event) => {
					progressWatchdog?.markProgress();
					for (const normalized of normalizePiEvent(event as never, state)) {
						emitter.passthrough(requestId, {
							...normalized,
							session_id: turn.providerSessionId,
						});
					}
				},
				logger,
			});

			live = { turn, requestId, emitter, active: true };
			const existing = this.sessions.get(params.sessionId);
			if (existing) {
				existing.active = false;
				this.sessions.delete(params.sessionId);
				existing.emitter.aborted(existing.requestId, "replaced_by_new_turn");
				void abortAndDispose(existing.turn);
			}
			this.sessions.set(params.sessionId, live);

			emitter.passthrough(requestId, {
				type: "thread/started",
				thread: { id: turn.providerSessionId },
				session_id: turn.providerSessionId,
			});

			const noProgressTimeoutMs = resolvePiNoProgressTimeoutMs();
			progressWatchdog = new PiProgressWatchdog(
				noProgressTimeoutMs,
				`Goal Pi supervisor did not produce any stream events for ${formatDuration(
					noProgressTimeoutMs,
				)}. The request was stopped; retry it if needed.`,
			);
			progressWatchdog.start();
			await Promise.race([
				turn.prompt(text || promptWithContext),
				progressWatchdog.promise,
			]);
			if (!live.active) return;
			emitter.end(requestId);
		} catch (error) {
			if (live && !live.active) return;
			if (error instanceof PiNoProgressTimeoutError) {
				if (live) {
					live.active = false;
					void abortAndDispose(live.turn);
				}
				emitter.error(requestId, error.message, true);
				logger.error("Goal Pi supervisor timed out without stream progress", {
					requestId,
					model: params.model,
					timeoutMs: progressWatchdog?.timeoutMs,
				});
				return;
			}
			const reason = error instanceof Error ? error.message : String(error);
			if (reason.toLowerCase().includes("abort")) {
				emitter.aborted(requestId, reason);
			} else {
				emitter.error(requestId, reason, true);
			}
			logger.error(
				"Goal Pi supervisor sendMessage failed",
				errorDetails(error),
			);
		} finally {
			progressWatchdog?.stop();
			if (live) {
				live.active = false;
				this.sessions.delete(params.sessionId);
				live.turn.dispose();
			}
		}
	}

	async stopSession(sessionId: string): Promise<boolean> {
		const live = this.sessions.get(sessionId);
		if (!live) return false;
		live.active = false;
		this.sessions.delete(sessionId);
		live.emitter.aborted(live.requestId, "user_requested");
		await abortAndDispose(live.turn);
		return true;
	}

	async steer(
		sessionId: string,
		prompt: string,
		_files: readonly string[],
		images: readonly string[],
	): Promise<boolean> {
		const live = this.sessions.get(sessionId);
		if (!live?.active) return false;
		const { text, imagePaths } = parseImageRefs(prompt, images);
		const piImages = await buildPiImages(imagePaths);
		await live.turn.steer(text || prompt, piImages);
		const event: {
			type: "user_prompt";
			text: string;
			steer: true;
			images?: string[];
		} = { type: "user_prompt", text: prompt, steer: true };
		if (imagePaths.length > 0) event.images = [...imagePaths];
		live.emitter.passthrough(live.requestId, event);
		return true;
	}

	async shutdown(): Promise<void> {
		for (const live of this.sessions.values()) {
			try {
				live.active = false;
				await live.turn.abort();
				live.turn.dispose();
			} catch (error) {
				logger.debug(
					"Goal Pi supervisor shutdown abort failed",
					errorDetails(error),
				);
			}
		}
		this.sessions.clear();
	}

	resolveKanbanToolCall(
		toolCallId: string,
		result: unknown,
		isError: boolean,
	): boolean {
		const pending = this.pendingTools.get(toolCallId);
		if (!pending) return false;
		this.pendingTools.delete(toolCallId);
		if (isError) {
			pending.reject(
				new Error(typeof result === "string" ? result : JSON.stringify(result)),
			);
		} else {
			pending.resolve(result);
		}
		return true;
	}

	async listModels(): Promise<readonly ProviderModelInfo[]> {
		const { listGoalSupervisorModels } = await import(
			"@helmor/pi-goal-supervisor"
		);
		return listGoalSupervisorModels();
	}
}

function formatDuration(ms: number): string {
	if (ms % 1000 === 0) return `${ms / 1000}s`;
	return `${ms}ms`;
}

async function abortAndDispose(turn: GoalSupervisorTurn): Promise<void> {
	try {
		await turn.abort();
	} catch (error) {
		logger.debug("Goal Pi supervisor abort failed", errorDetails(error));
	} finally {
		turn.dispose();
	}
}

async function buildPiImages(
	imagePaths: readonly string[],
): Promise<PiImageContent[]> {
	const images: PiImageContent[] = [];
	for (const imagePath of imagePaths) {
		try {
			const { buffer } = await readImageWithResize(imagePath);
			images.push({
				type: "image",
				data: buffer.toString("base64"),
				mimeType: extToMediaType(imagePath),
			});
		} catch (error) {
			logger.error("Failed to read Goal Pi image attachment", {
				imagePath,
				...errorDetails(error),
			});
		}
	}
	return images;
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function extToMediaType(filePath: string): ImageMediaType {
	const lower = filePath.toLowerCase();
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".webp")) return "image/webp";
	return "image/png";
}
