/**
 * Capy AI session manager.
 *
 * Implements the `SessionManager` interface by calling the Capy REST API
 * (https://capy.ai/api/v1). Because Capy has no streaming endpoint, this
 * manager polls `GET /v1/threads/{id}/messages` every 3 seconds and emits
 * synthetic Claude-compatible passthrough events so the existing Rust pipeline
 * accumulator can render Capy messages without modification.
 *
 * Provider session ID mapping: the Capy `threadId` is stored as
 * `provider_session_id` in the Helmor DB via a synthetic passthrough event
 * that carries `session_id: threadId` (snake_case — what the Rust
 * `SidecarEvent::session_id()` looks for).
 */

import type { SidecarEmitter } from "./emitter.js";
import { logger } from "./logger.js";
import type {
	GenerateTitleOptions,
	ListSlashCommandsParams,
	ProviderModelInfo,
	SendMessageParams,
	SessionManager,
	SlashCommandInfo,
} from "./session-manager.js";

const CAPY_BASE_URL = "https://capy.ai/api/v1";
const POLL_INTERVAL_MS = 3_000;

interface CapyThread {
	id: string;
	projectId: string;
	title: string;
	status: "active" | "idle" | "archived";
	createdAt: string;
	updatedAt: string;
}

interface CapyMessage {
	id: string;
	source: "user" | "assistant";
	content: string;
	createdAt: string;
}

interface CapyMessagesPage {
	items: CapyMessage[];
	nextCursor: string | null;
	hasMore: boolean;
}

interface ActiveCapySession {
	threadId: string;
	abortController: AbortController;
}

export class CapySessionManager implements SessionManager {
	private activeSessions = new Map<string, ActiveCapySession>();

	// -------------------------------------------------------------------------
	// SessionManager interface
	// -------------------------------------------------------------------------

	async sendMessage(
		requestId: string,
		params: SendMessageParams,
		emitter: SidecarEmitter,
	): Promise<void> {
		const { capyApiKey, capyProjectId, prompt, model, resume } = params;

		if (!capyApiKey) {
			emitter.error(
				requestId,
				"Capy API key is not configured. Add it in Settings → Capy.",
			);
			return;
		}
		if (!capyProjectId) {
			emitter.error(
				requestId,
				"Capy project ID is not configured for this repository. Add it in Settings → Repository.",
			);
			return;
		}

		const abortController = new AbortController();
		let threadId: string;

		try {
			if (resume) {
				// Existing thread — send a follow-up message.
				threadId = resume;
				logger.debug(
					`[${requestId}] capy: sending message to thread ${threadId}`,
				);
				await this.postThreadMessage(
					capyApiKey,
					threadId,
					prompt,
					model,
					abortController.signal,
				);
			} else {
				// New thread.
				logger.debug(
					`[${requestId}] capy: creating thread in project ${capyProjectId}`,
				);
				const thread = await this.createThread(
					capyApiKey,
					capyProjectId,
					prompt,
					model,
					abortController.signal,
				);
				threadId = thread.id;
				logger.debug(`[${requestId}] capy: thread created: ${threadId}`);

				// Emit a passthrough that carries `session_id` (snake_case) so
				// the Rust streaming loop stores the threadId as provider_session_id.
				// For non-Claude providers, is_provider_session_marker = true for
				// every event, and session_id() looks for the "session_id" key.
				emitter.passthrough(requestId, {
					type: "capy_session_start",
					session_id: threadId,
				});
			}

			this.activeSessions.set(requestId, { threadId, abortController });

			// Poll for messages until the thread goes idle/archived.
			await this.pollUntilDone(
				requestId,
				capyApiKey,
				threadId,
				model ?? "capy",
				abortController,
				emitter,
			);
		} catch (err) {
			if (abortController.signal.aborted) {
				emitter.aborted(requestId, "user_requested");
			} else {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error(`[${requestId}] capy: sendMessage error: ${msg}`);
				emitter.error(requestId, `Capy error: ${msg}`);
			}
			return;
		} finally {
			this.activeSessions.delete(requestId);
		}

		if (abortController.signal.aborted) {
			emitter.aborted(requestId, "user_requested");
		} else {
			emitter.end(requestId);
		}
	}

	async generateTitle(
		requestId: string,
		_userMessage: string,
		_branchRenamePrompt: string | null,
		emitter: SidecarEmitter,
		_timeoutMs?: number,
		_options?: GenerateTitleOptions,
	): Promise<void> {
		// Capy generates titles automatically; we have no title to emit.
		// Emit a generic title so the session tab isn't stuck at "Untitled".
		emitter.titleGenerated(requestId, "Capy Thread", undefined);
	}

	async listSlashCommands(
		_params: ListSlashCommandsParams,
	): Promise<readonly SlashCommandInfo[]> {
		return [];
	}

	async listModels(): Promise<readonly ProviderModelInfo[]> {
		return [
			{ id: "capy/auto", label: "Auto", cliModel: "auto" },
			{
				id: "capy/claude-opus-4-7",
				label: "Claude Opus 4.7",
				cliModel: "claude-opus-4-7",
			},
			{
				id: "capy/claude-sonnet-4-6",
				label: "Claude Sonnet 4.6",
				cliModel: "claude-sonnet-4-6",
			},
			{ id: "capy/gpt-5.5", label: "GPT-5.5", cliModel: "gpt-5.5" },
			{
				id: "capy/gemini-3.1-pro-preview",
				label: "Gemini 3.1 Pro",
				cliModel: "gemini-3.1-pro-preview",
			},
		];
	}

	async stopSession(sessionId: string): Promise<void> {
		// Look up by threadId across all active sessions.
		for (const [reqId, session] of this.activeSessions) {
			if (session.threadId === sessionId || reqId === sessionId) {
				session.abortController.abort();
				logger.debug(`capy: abort signalled for session ${sessionId}`);
				return;
			}
		}
		// Session may have already finished — that's fine.
		logger.debug(`capy: stopSession for unknown/finished session ${sessionId}`);
	}

	async steer(
		_sessionId: string,
		_prompt: string,
		_files: readonly string[],
		_images: readonly string[],
	): Promise<boolean> {
		// Steer is not supported for Capy in v1. The Rust side will show an
		// informational notice if the user tries mid-stream injection.
		return false;
	}

	async shutdown(): Promise<void> {
		for (const [, session] of this.activeSessions) {
			session.abortController.abort();
		}
		this.activeSessions.clear();
	}

	// -------------------------------------------------------------------------
	// Capy API helpers
	// -------------------------------------------------------------------------

	private async createThread(
		apiKey: string,
		projectId: string,
		prompt: string,
		model: string | undefined,
		signal: AbortSignal,
	): Promise<CapyThread> {
		const body: Record<string, unknown> = {
			projectId,
			prompt,
		};
		if (model && model !== "auto") {
			body.model = model;
		}

		const resp = await fetch(`${CAPY_BASE_URL}/threads`, {
			method: "POST",
			headers: this.headers(apiKey),
			body: JSON.stringify(body),
			signal,
		});

		if (!resp.ok) {
			const text = await resp.text().catch(() => resp.statusText);
			throw new Error(`Capy createThread ${resp.status}: ${text}`);
		}

		return (await resp.json()) as CapyThread;
	}

	private async postThreadMessage(
		apiKey: string,
		threadId: string,
		message: string,
		model: string | undefined,
		signal: AbortSignal,
	): Promise<void> {
		const body: Record<string, unknown> = { message };
		if (model && model !== "auto") {
			body.model = model;
		}

		const resp = await fetch(`${CAPY_BASE_URL}/threads/${threadId}/message`, {
			method: "POST",
			headers: this.headers(apiKey),
			body: JSON.stringify(body),
			signal,
		});

		if (!resp.ok) {
			const text = await resp.text().catch(() => resp.statusText);
			throw new Error(`Capy postMessage ${resp.status}: ${text}`);
		}
	}

	private async fetchMessages(
		apiKey: string,
		threadId: string,
		cursor: string | null,
		signal: AbortSignal,
	): Promise<CapyMessagesPage> {
		const url = new URL(`${CAPY_BASE_URL}/threads/${threadId}/messages`);
		url.searchParams.set("limit", "100");
		if (cursor) url.searchParams.set("cursor", cursor);

		const resp = await fetch(url.toString(), {
			headers: this.headers(apiKey),
			signal,
		});

		if (!resp.ok) {
			const text = await resp.text().catch(() => resp.statusText);
			throw new Error(`Capy fetchMessages ${resp.status}: ${text}`);
		}

		return (await resp.json()) as CapyMessagesPage;
	}

	private async getThread(
		apiKey: string,
		threadId: string,
		signal: AbortSignal,
	): Promise<CapyThread> {
		const resp = await fetch(`${CAPY_BASE_URL}/threads/${threadId}`, {
			headers: this.headers(apiKey),
			signal,
		});

		if (!resp.ok) {
			const text = await resp.text().catch(() => resp.statusText);
			throw new Error(`Capy getThread ${resp.status}: ${text}`);
		}

		return (await resp.json()) as CapyThread;
	}

	private headers(apiKey: string): Record<string, string> {
		return {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		};
	}

	// -------------------------------------------------------------------------
	// Polling loop
	// -------------------------------------------------------------------------

	private async pollUntilDone(
		requestId: string,
		apiKey: string,
		threadId: string,
		resolvedModel: string,
		abortController: AbortController,
		emitter: SidecarEmitter,
	): Promise<void> {
		const signal = abortController.signal;
		let lastCursor: string | null = null;
		let messageIndex = 0;

		while (!signal.aborted) {
			// Wait before polling (also gives Capy time to start processing).
			await sleep(POLL_INTERVAL_MS);
			if (signal.aborted) break;

			// Fetch new messages since the last cursor.
			const page = await this.fetchMessages(
				apiKey,
				threadId,
				lastCursor,
				signal,
			);

			for (const msg of page.items) {
				if (msg.source === "assistant" && msg.content) {
					this.emitAssistantMessage(
						requestId,
						msg,
						resolvedModel,
						messageIndex,
						emitter,
					);
					messageIndex++;
				}
			}

			if (page.nextCursor) {
				lastCursor = page.nextCursor;
			}

			// Check thread status to decide whether to stop polling.
			if (!page.hasMore) {
				const thread = await this.getThread(apiKey, threadId, signal);
				logger.debug(
					`[${requestId}] capy: thread status=${thread.status} cursor=${lastCursor ?? "none"}`,
				);
				if (thread.status === "idle" || thread.status === "archived") {
					break;
				}
			}
		}
	}

	/**
	 * Emit a single Capy assistant message as synthetic Claude passthrough
	 * events so the existing pipeline accumulator processes it correctly.
	 *
	 * The sequence matches what the Claude SDK emits for a complete text
	 * block: message_start → content_block_start → content_block_delta →
	 * content_block_stop → message_delta → message_stop.
	 */
	private emitAssistantMessage(
		requestId: string,
		msg: CapyMessage,
		resolvedModel: string,
		_index: number,
		emitter: SidecarEmitter,
	): void {
		const msgId = `capy-${msg.id}`;

		emitter.passthrough(requestId, {
			type: "message_start",
			message: {
				id: msgId,
				type: "message",
				role: "assistant",
				content: [],
				model: resolvedModel,
				usage: { input_tokens: 0, output_tokens: 0 },
			},
		});
		emitter.passthrough(requestId, {
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		});
		emitter.passthrough(requestId, {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: msg.content },
		});
		emitter.passthrough(requestId, {
			type: "content_block_stop",
			index: 0,
		});
		emitter.passthrough(requestId, {
			type: "message_delta",
			delta: { stop_reason: "end_turn", stop_sequence: null },
			usage: { output_tokens: 0 },
		});
		emitter.passthrough(requestId, { type: "message_stop" });
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
