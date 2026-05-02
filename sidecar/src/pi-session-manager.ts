import { basename, extname } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	ModelRegistry,
	SessionManager as PiFileSessionManager,
} from "@mariozechner/pi-coding-agent";
import type { SidecarEmitter } from "./emitter.js";
import { readImageWithResize } from "./image-resize.js";
import { parseImageRefs } from "./images.js";
import { prependLinkedDirectoriesContext } from "./linked-directories-context.js";
import { errorDetails, logger } from "./logger.js";
import { listProviderModels } from "./model-catalog.js";
import { bootstrapPiAuth } from "./pi-auth-bootstrap.js";
import { createPiEventState, normalizePiEvent } from "./pi-event-normalizer.js";
import type {
	GenerateTitleOptions,
	ListSlashCommandsParams,
	ProviderModelInfo,
	SendMessageParams,
	SessionManager,
	SlashCommandInfo,
} from "./session-manager.js";
import {
	buildTitlePrompt,
	parseTitleAndBranch,
	TITLE_GENERATION_TIMEOUT_MS,
} from "./title.js";

type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";
type PiImageContent = { type: "image"; data: string; mimeType: string };

interface LivePiSession {
	readonly session: AgentSession;
	readonly providerSessionId: string;
	readonly requestId: string;
	readonly emitter: SidecarEmitter;
	unsubscribe: (() => void) | null;
	active: boolean;
}

export class PiSessionManager implements SessionManager {
	private readonly sessions = new Map<string, LivePiSession>();

	async sendMessage(
		requestId: string,
		params: SendMessageParams,
		emitter: SidecarEmitter,
	): Promise<void> {
		let live: LivePiSession | undefined;
		try {
			const promptWithContext = prependLinkedDirectoriesContext(
				params.prompt,
				params.additionalDirectories,
			);
			const { text, imagePaths } = parseImageRefs(
				promptWithContext,
				params.images,
			);
			const sessionManager = buildPiFileSessionManager(params);
			const providerSessionId =
				sessionManager.getSessionFile() ?? sessionManager.getSessionId();
			const authStorage = AuthStorage.create();
			bootstrapPiAuth(authStorage);
			const modelRegistry = ModelRegistry.create(authStorage);
			const model = resolvePiModel(modelRegistry, params.model);
			const tools = toolsForPermissionMode(params.permissionMode);
			const { session } = await createAgentSession({
				cwd: params.cwd,
				authStorage,
				modelRegistry,
				sessionManager,
				model,
				thinkingLevel: normalizeThinkingLevel(params.effortLevel),
				tools,
				noTools: tools
					? undefined
					: params.permissionMode === "plan"
						? "builtin"
						: undefined,
			});

			live = {
				session,
				providerSessionId,
				requestId,
				emitter,
				unsubscribe: null,
				active: true,
			};
			this.sessions.set(params.sessionId, live);

			const state = createPiEventState();
			live.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
				for (const normalized of normalizePiEvent(event, state)) {
					emitter.passthrough(requestId, {
						...normalized,
						session_id: providerSessionId,
					});
				}
			});

			emitter.passthrough(requestId, {
				type: "thread/started",
				thread: { id: providerSessionId },
				session_id: providerSessionId,
			});

			const images = await buildPiImages(imagePaths);
			await session.prompt(text || params.prompt, {
				images,
				source: "interactive",
			});
			emitter.end(requestId);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			if (reason.toLowerCase().includes("abort")) {
				emitter.aborted(requestId, reason);
			} else {
				emitter.error(requestId, reason, true);
			}
			logger.error("Pi sendMessage failed", errorDetails(err));
		} finally {
			if (live) {
				live.active = false;
				live.unsubscribe?.();
				this.sessions.delete(params.sessionId);
			}
		}
	}

	async generateTitle(
		requestId: string,
		userMessage: string,
		branchRenamePrompt: string | null,
		emitter: SidecarEmitter,
		timeoutMs = TITLE_GENERATION_TIMEOUT_MS,
		_options?: GenerateTitleOptions,
	): Promise<void> {
		const authStorage = AuthStorage.create();
		bootstrapPiAuth(authStorage);
		const modelRegistry = ModelRegistry.create(authStorage);
		const model = resolvePiModel(modelRegistry, "anthropic/claude-haiku-4-5");
		const { session } = await createAgentSession({
			authStorage,
			modelRegistry,
			model,
			sessionManager: PiFileSessionManager.inMemory(process.cwd()),
			tools: [],
			noTools: "builtin",
		});
		let text = "";
		const unsubscribe = session.subscribe((event) => {
			if (event.type !== "message_update") return;
			const update = event.assistantMessageEvent;
			if (update.type === "text_delta") text += update.delta;
		});
		try {
			await withTimeout(
				session.prompt(buildTitlePrompt(userMessage, branchRenamePrompt), {
					source: "interactive",
				}),
				timeoutMs,
			);
			const parsed = parseTitleAndBranch(text);
			emitter.titleGenerated(
				requestId,
				parsed.title || "New chat",
				parsed.branchName,
			);
		} finally {
			unsubscribe();
			session.dispose();
		}
	}

	async listSlashCommands(
		_params: ListSlashCommandsParams,
	): Promise<readonly SlashCommandInfo[]> {
		return [];
	}

	async listModels(): Promise<readonly ProviderModelInfo[]> {
		return listProviderModels("pi");
	}

	async stopSession(sessionId: string): Promise<void> {
		const live = this.sessions.get(sessionId);
		if (!live) return;
		await live.session.abort();
		live.emitter.stopped(live.requestId, sessionId);
	}

	async steer(
		sessionId: string,
		prompt: string,
		files: readonly string[],
		images: readonly string[],
	): Promise<boolean> {
		const live = this.sessions.get(sessionId);
		if (!live?.active) return false;
		const { text, imagePaths } = parseImageRefs(prompt, images);
		const piImages = await buildPiImages(imagePaths);
		const event: {
			type: "user_prompt";
			message: { role: "user"; content: string };
			files?: string[];
			images?: string[];
		} = {
			type: "user_prompt",
			message: { role: "user", content: prompt },
		};
		if (files.length > 0) event.files = [...files];
		if (imagePaths.length > 0) event.images = [...imagePaths];
		live.emitter.passthrough(live.requestId, event);
		await live.session.steer(text || prompt, piImages);
		return true;
	}

	async shutdown(): Promise<void> {
		for (const live of this.sessions.values()) {
			try {
				await live.session.abort();
				live.session.dispose();
			} catch (err) {
				logger.debug("Pi shutdown abort failed", errorDetails(err));
			}
		}
		this.sessions.clear();
	}
}

function buildPiFileSessionManager(
	params: SendMessageParams,
): PiFileSessionManager {
	if (params.resume) {
		try {
			return PiFileSessionManager.open(params.resume, undefined, params.cwd);
		} catch (err) {
			logger.info(
				"Pi resume failed; starting a new session",
				errorDetails(err),
			);
		}
	}
	return PiFileSessionManager.create(params.cwd || process.cwd());
}

function resolvePiModel(
	modelRegistry: ModelRegistry,
	modelId: string | undefined,
) {
	const { provider, model } = parsePiModelId(modelId);
	return modelRegistry.find(provider, model) ?? modelRegistry.getAvailable()[0];
}

function parsePiModelId(modelId: string | undefined): {
	provider: string;
	model: string;
} {
	const raw = (modelId || "anthropic/claude-opus-4-7").replace(/^pi:/, "");
	const slash = raw.indexOf("/");
	if (slash > 0) {
		const provider = raw.slice(0, slash);
		return {
			provider:
				provider === "openai-codex" ? "azure-openai-responses" : provider,
			model: raw.slice(slash + 1),
		};
	}
	if (raw.startsWith("gpt-")) {
		return { provider: "azure-openai-responses", model: raw };
	}
	return { provider: "anthropic", model: raw };
}

function normalizeThinkingLevel(
	level: string | undefined,
): ThinkingLevel | undefined {
	if (
		level === "low" ||
		level === "medium" ||
		level === "high" ||
		level === "xhigh"
	) {
		return level;
	}
	if (level === "max") return "xhigh";
	return undefined;
}

function toolsForPermissionMode(
	permissionMode: string | undefined,
): string[] | undefined {
	if (permissionMode === "plan") return ["read", "grep", "find", "ls"];
	return undefined;
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
		} catch (err) {
			logger.error("Failed to read Pi image attachment", {
				imageName: basename(imagePath),
				...errorDetails(err),
			});
		}
	}
	return images;
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function extToMediaType(filePath: string): ImageMediaType {
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

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Pi title generation timed out")),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
