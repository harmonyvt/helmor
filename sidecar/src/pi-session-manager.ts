import { basename, extname } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	createAgentSession,
	type ModelRegistry,
	SessionManager as PiFileSessionManager,
	type SlashCommandInfo as PiSlashCommandInfo,
} from "@mariozechner/pi-coding-agent";
import type { SidecarEmitter } from "./emitter.js";
import { readImageWithResize } from "./image-resize.js";
import { parseImageRefs } from "./images.js";
import { prependLinkedDirectoriesContext } from "./linked-directories-context.js";
import { errorDetails, logger } from "./logger.js";
import { createPiEventState, normalizePiEvent } from "./pi-event-normalizer.js";
import { bindPiExtensionsForHelmor } from "./pi-extension-host.js";
import { createPiRuntimeResources } from "./pi-runtime.js";
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
const PI_EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const;

type PiModel = {
	readonly id: string;
	readonly name?: string;
	readonly provider: string;
	readonly reasoning?: boolean;
};

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
			const { authStorage, modelRegistry, resourceLoader } =
				await createPiRuntimeResources(params.cwd);
			const model = resolvePiModel(modelRegistry, params.model);
			const tools = toolsForPermissionMode(params.permissionMode);
			const { session } = await createAgentSession({
				cwd: params.cwd,
				authStorage,
				modelRegistry,
				resourceLoader,
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
			await bindPiExtensionsForHelmor(session, emitter, requestId);

			const state = createPiEventState(requestId);
			const trace = createPiTrace(requestId, params.model, params.cwd ?? "");
			live.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
				trace.record(event);
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
			trace.finish(session.agent.state.errorMessage);
			if (trace.shouldEmitEmptyTurnNotice()) {
				emitter.passthrough(requestId, {
					type: "error",
					message:
						session.agent.state.errorMessage ??
						"Pi completed without returning a visible assistant message.",
				});
			}
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
		const { authStorage, modelRegistry, resourceLoader } =
			await createPiRuntimeResources(process.cwd());
		const model = resolvePiModel(modelRegistry, "anthropic/claude-haiku-4-5");
		const { session } = await createAgentSession({
			authStorage,
			modelRegistry,
			resourceLoader,
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
		params: ListSlashCommandsParams,
	): Promise<readonly SlashCommandInfo[]> {
		const cwd = params.cwd || process.cwd();
		const { authStorage, modelRegistry, resourceLoader } =
			await createPiRuntimeResources(cwd);
		const { session, extensionsResult } = await createAgentSession({
			cwd,
			authStorage,
			modelRegistry,
			resourceLoader,
			sessionManager: PiFileSessionManager.inMemory(cwd),
			tools: [],
			noTools: "builtin",
		});
		try {
			await session.bindExtensions({});
			return normalizePiSlashCommands(extensionsResult.runtime.getCommands());
		} finally {
			session.dispose();
		}
	}

	async listModels(): Promise<readonly ProviderModelInfo[]> {
		const { modelRegistry } = await createPiRuntimeResources(process.cwd());
		const loadError = modelRegistry.getError();
		if (loadError) {
			logger.info("Pi model registry reported errors", { error: loadError });
		}

		const mapped = modelRegistry
			.getAvailable()
			.sort((left, right) => {
				const providerDelta = left.provider.localeCompare(right.provider);
				return providerDelta || left.id.localeCompare(right.id);
			})
			.map(piModelInfo);

		// The Pi registry can return multiple raw entries that normalize to the
		// same output id (e.g. both "openrouter/auto" and "pi:openrouter/auto"
		// map to "pi:openrouter/auto"). Deduplicate by normalized id, keeping
		// the first occurrence from the sorted order.
		const seen = new Set<string>();
		return mapped.filter((model) => {
			if (seen.has(model.id)) return false;
			seen.add(model.id);
			return true;
		});
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

function createPiTrace(
	requestId: string,
	model: string | undefined,
	cwd: string,
) {
	const counts = new Map<string, number>();
	let visibleAssistantMessageCount = 0;
	let errorEventCount = 0;
	return {
		record(event: AgentSessionEvent) {
			counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
			if (event.type === "message_end") {
				const message = asRecord(event.message);
				if (
					message?.role === "assistant" &&
					assistantHasVisibleContent(message)
				) {
					visibleAssistantMessageCount += 1;
				}
			}
			if (event.type === "message_end") {
				const message = asRecord(event.message);
				if (
					message?.role === "assistant" &&
					typeof message.errorMessage === "string"
				) {
					errorEventCount += 1;
				}
			}
		},
		finish(errorMessage: string | undefined) {
			logger.debug("Pi prompt event summary", {
				requestId,
				model,
				cwd,
				events: Object.fromEntries(counts),
				visibleAssistantMessageCount,
				errorEventCount,
				errorMessage,
			});
		},
		shouldEmitEmptyTurnNotice() {
			return visibleAssistantMessageCount === 0 && errorEventCount === 0;
		},
	};
}

function assistantHasVisibleContent(message: Record<string, unknown>): boolean {
	return extractAssistantText(message).trim().length > 0;
}

function extractAssistantText(message: Record<string, unknown>): string {
	const content = message.content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) => asRecord(item))
		.filter((item) => item?.type === "text" && typeof item.text === "string")
		.map((item) => item?.text as string)
		.join("");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function piModelInfo(model: PiModel): ProviderModelInfo {
	const provider = normalizePiProvider(model.provider, model.id);
	const id = normalizePiModelId(model.id, provider);
	const cliModel = `${provider}/${id}`;
	return {
		id: `pi:${cliModel}`,
		label: `Pi · ${normalizePiModelLabel(model.name, id)}`,
		cliModel,
		providerKey: provider,
		effortLevels: model.reasoning === true ? [...PI_EFFORT_LEVELS] : [],
		supportsFastMode: piModelSupportsFastMode(model),
	};
}

function piModelSupportsFastMode(model: PiModel): boolean {
	const provider = normalizePiProvider(model.provider, model.id);
	return provider === "azure-openai-responses" || provider === "openai-codex";
}

function normalizePiProvider(provider: string | undefined, id: string): string {
	const trimmed = provider?.trim();
	if (trimmed) return trimmed;
	const raw = id.replace(/^pi:/, "");
	const slash = raw.indexOf("/");
	if (slash > 0) return raw.slice(0, slash);
	if (raw.startsWith("gpt-")) return "azure-openai-responses";
	return "anthropic";
}

function normalizePiModelId(id: string, provider: string): string {
	const raw = id.replace(/^pi:/, "").trim();
	const prefix = `${provider}/`;
	return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

function normalizePiModelLabel(name: string | undefined, id: string): string {
	return name?.trim() || id;
}

export function normalizePiSlashCommands(
	commands: readonly PiSlashCommandInfo[],
): SlashCommandInfo[] {
	const seen = new Set<string>();
	const out: SlashCommandInfo[] = [];
	for (const command of commands) {
		if (!command.name || seen.has(command.name)) continue;
		seen.add(command.name);
		out.push({
			name: command.name,
			description: command.description ?? "",
			argumentHint: piArgumentHint(command),
			source: command.source,
			sourceInfo: normalizeSourceInfo(command.sourceInfo),
		});
	}
	return out;
}

function piArgumentHint(command: PiSlashCommandInfo): string | undefined {
	const sourceInfo = command.sourceInfo as unknown as
		| Record<string, unknown>
		| undefined;
	const frontmatter = sourceInfo?.frontmatter;
	if (frontmatter && typeof frontmatter === "object") {
		const hint = (frontmatter as Record<string, unknown>)["argument-hint"];
		if (typeof hint === "string" && hint.trim()) return hint;
	}
	return undefined;
}

function normalizeSourceInfo(
	sourceInfo: PiSlashCommandInfo["sourceInfo"],
): Record<string, unknown> | undefined {
	if (!sourceInfo || typeof sourceInfo !== "object") return undefined;
	return { ...sourceInfo } as Record<string, unknown>;
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
