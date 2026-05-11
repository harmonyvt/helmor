import { basename, extname } from "node:path";
import { getSupportedThinkingLevels } from "@mariozechner/pi-ai";
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
import { createDelegationTools } from "./pi-delegation-tools.js";
import { createPiEventState, normalizePiEvent } from "./pi-event-normalizer.js";
import { bindPiExtensionsForHelmor } from "./pi-extension-host.js";
import { writeKanbanContext } from "./pi-kanban-context-writer.js";
import {
	createKanbanTools,
	resolvePendingKanbanCall,
} from "./pi-kanban-tools.js";
import { createPiRuntimeResources } from "./pi-runtime.js";
import { createThreadTools } from "./pi-thread-tools.js";
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
const PI_EFFORT_LEVELS = ["minimal", "low", "medium", "high"] as const;
const PI_EFFORT_LEVELS_WITH_XHIGH = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

type PiModel = {
	readonly id: string;
	readonly name: string;
	readonly provider: string;
	readonly reasoning: boolean;
	readonly thinkingLevelMap?: Record<string, string | null>;
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
			const promptForMode = applyPermissionModePrompt(
				promptWithContext,
				params.permissionMode,
			);
			const { text, imagePaths } = parseImageRefs(promptForMode, params.images);
			const sessionManager = buildPiFileSessionManager(params);
			const providerSessionId =
				sessionManager.getSessionFile() ?? sessionManager.getSessionId();
			const { authStorage, modelRegistry, resourceLoader } =
				await createPiRuntimeResources(params.cwd);
			const model = resolvePiModel(modelRegistry, params.model);
			const trace = createPiTrace(requestId, params.model, params.cwd ?? "");
			const tools = toolsForPermissionMode(params.permissionMode);

			// Write Pi extension file + board snapshot before the agent starts
			// so the helmor-kanban extension can inject current state into the
			// system prompt via `before_agent_start`. Cards are child workspaces;
			// writeKanbanContext normalizes the snapshot defensively.
			if (params.kanbanWorkspaceId && params.cwd) {
				let cards: unknown[] = [];
				if (params.kanbanSnapshot) {
					try {
						const parsed = JSON.parse(params.kanbanSnapshot);
						cards = Array.isArray(parsed) ? parsed : [];
					} catch {
						// malformed snapshot — proceed with empty list
					}
				}
				const goalMeta =
					(params.goalTitle ?? params.goalDescription)
						? {
								title: params.goalTitle ?? undefined,
								description: params.goalDescription ?? undefined,
							}
						: undefined;
				await writeKanbanContext(params.cwd, cards, goalMeta);
			}

			const kanbanCustomTools = params.kanbanWorkspaceId
				? createKanbanTools(params.kanbanWorkspaceId, emitter, requestId)
				: [];

			const threadCustomTools = params.kanbanWorkspaceId
				? createThreadTools(params.kanbanWorkspaceId, emitter, requestId)
				: [];

			const delegationCustomTools = params.helmorSessionId
				? createDelegationTools(params.helmorSessionId, emitter, requestId)
				: [];

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
				customTools: [
					...kanbanCustomTools,
					...threadCustomTools,
					...delegationCustomTools,
				],
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
			await bindPiExtensionsForHelmor(session, emitter, requestId, () =>
				trace.recordVisibleActivity("extension_card"),
			);

			const state = createPiEventState(requestId, {
				capturePlanReview: params.permissionMode === "plan",
			});
			live.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
				trace.record(event);
				for (const normalized of normalizePiEvent(event, state)) {
					trace.recordPipelineEvent(normalized);
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
			await session.prompt(text || promptForMode, {
				images,
				source: "interactive",
			});
			if (!live.active) return;
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
			if (live && !live.active) return;
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
		logger.info("PiSessionManager.listModels starting", {
			cwd: process.cwd(),
			piPackageDir: process.env.PI_PACKAGE_DIR ?? null,
			piBinDir: process.env.HELMOR_PI_BIN_DIR ?? null,
			pathHasPiBin: process.env.PATH?.includes(
				process.env.HELMOR_PI_BIN_DIR ?? "\u0000",
			),
		});
		const { modelRegistry } = await createPiRuntimeResources(process.cwd());
		const loadError = modelRegistry.getError();
		if (loadError) {
			logger.info("Pi model registry reported errors", { error: loadError });
		}

		const available = modelRegistry.getAvailable().sort((left, right) => {
			const providerDelta = left.provider.localeCompare(right.provider);
			return providerDelta || left.id.localeCompare(right.id);
		});
		const providerCounts = countPiModelProviders(available);
		logger.info("PiSessionManager.listModels completed", {
			modelCount: available.length,
			providerCount: Object.keys(providerCounts).length,
			providerCounts,
			firstModel: available[0]
				? `${available[0].provider}/${available[0].id}`
				: null,
			lastModel: available.at(-1)
				? `${available.at(-1)?.provider}/${available.at(-1)?.id}`
				: null,
			loadError: loadError ? String(loadError) : null,
		});

		return available.map(piModelInfo);
	}

	async stopSession(sessionId: string): Promise<void> {
		const live = this.sessions.get(sessionId);
		if (!live) return;
		live.active = false;
		this.sessions.delete(sessionId);
		live.unsubscribe?.();
		live.emitter.aborted(live.requestId, "user_requested");
		try {
			await live.session.abort();
		} finally {
			live.session.dispose();
		}
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
		await live.session.steer(text || prompt, piImages);
		const event: {
			type: "user_prompt";
			text: string;
			steer: true;
			files?: string[];
			images?: string[];
		} = { type: "user_prompt", text: prompt, steer: true };
		if (files.length > 0) event.files = [...files];
		if (imagePaths.length > 0) event.images = [...imagePaths];
		live.emitter.passthrough(live.requestId, event);
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

	/**
	 * Resolve a pending Kanban tool call. Called by the sidecar stdin handler
	 * when `{ method: "kanbanToolResult" }` arrives from the frontend.
	 */
	resolveKanbanToolCall(
		toolCallId: string,
		result: unknown,
		isError: boolean,
	): void {
		resolvePendingKanbanCall(toolCallId, result, isError);
	}
}

function createPiTrace(
	requestId: string,
	model: string | undefined,
	cwd: string,
) {
	const counts = new Map<string, number>();
	let visibleActivityCount = 0;
	let errorEventCount = 0;
	return {
		record(event: AgentSessionEvent) {
			counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
			if (event.type === "message_update") {
				const assistantEvent = asRecord(event.assistantMessageEvent);
				const assistantEventType = assistantEvent?.type;
				if (
					assistantEventType === "text_delta" ||
					assistantEventType === "thinking_delta" ||
					assistantEventType === "toolcall_delta"
				) {
					const delta = assistantEvent?.delta;
					if (typeof delta === "string" && delta.length > 0) {
						visibleActivityCount += 1;
					}
				}
			}
			if (
				event.type === "tool_execution_start" ||
				event.type === "tool_execution_update" ||
				event.type === "tool_execution_end"
			) {
				visibleActivityCount += 1;
			}
			if (event.type === "message_end") {
				const message = asRecord(event.message);
				if (
					message?.role === "assistant" &&
					assistantHasVisibleContent(message)
				) {
					visibleActivityCount += 1;
				}
				if (
					message?.role === "assistant" &&
					typeof message.errorMessage === "string"
				) {
					errorEventCount += 1;
				}
			}
		},
		recordPipelineEvent(event: {
			readonly type: string;
			readonly [key: string]: unknown;
		}) {
			if (isVisiblePiPipelineEvent(event)) visibleActivityCount += 1;
			if (event.type === "error") errorEventCount += 1;
		},
		recordVisibleActivity(kind: string) {
			counts.set(kind, (counts.get(kind) ?? 0) + 1);
			visibleActivityCount += 1;
		},
		finish(errorMessage: string | undefined) {
			logger.debug("Pi prompt event summary", {
				requestId,
				model,
				cwd,
				events: Object.fromEntries(counts),
				visibleActivityCount,
				errorEventCount,
				errorMessage,
			});
		},
		shouldEmitEmptyTurnNotice() {
			return visibleActivityCount === 0 && errorEventCount === 0;
		},
	};
}

function assistantHasVisibleContent(message: Record<string, unknown>): boolean {
	const content = message.content;
	if (!Array.isArray(content)) return false;
	return content.some((item) => {
		const block = asRecord(item);
		if (!block) return false;
		if (block.type === "text") {
			return typeof block.text === "string" && block.text.trim().length > 0;
		}
		if (block.type === "thinking") {
			return (
				typeof block.thinking === "string" && block.thinking.trim().length > 0
			);
		}
		return block.type === "toolCall";
	});
}

function isVisiblePiPipelineEvent(event: {
	readonly type: string;
	readonly [key: string]: unknown;
}): boolean {
	if (event.type === "item/agentMessage/delta") {
		return typeof event.text === "string" && event.text.length > 0;
	}
	if (event.type === "item/reasoning/textDelta") {
		return typeof event.text === "string" && event.text.length > 0;
	}
	if (event.type === "item/commandExecution/outputDelta") {
		return typeof event.output === "string" && event.output.length > 0;
	}
	if (event.type === "item/started" || event.type === "item/completed") {
		const item = asRecord(event.item);
		const itemType = item?.type;
		if (itemType === "agent_message") {
			const text = item?.text;
			return typeof text === "string" && text.trim().length > 0;
		}
		return (
			itemType === "reasoning" ||
			itemType === "command_execution" ||
			itemType === "file_change" ||
			itemType === "mcp_tool_call" ||
			itemType === "generic_card"
		);
	}
	return false;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function countPiModelProviders(
	models: readonly PiModel[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const model of models) {
		counts[model.provider] = (counts[model.provider] ?? 0) + 1;
	}
	return counts;
}

function piModelInfo(model: PiModel): ProviderModelInfo {
	return {
		id: `pi:${model.provider}/${model.id}`,
		label: `Pi · ${model.name || model.id}`,
		cliModel: `${model.provider}/${model.id}`,
		providerKey: model.provider,
		effortLevels: piModelEffortLevels(model),
		supportsFastMode: false,
	};
}

function piModelEffortLevels(model: PiModel): readonly string[] {
	if (!model.reasoning) return [];
	try {
		return getSupportedThinkingLevels(model as never).filter(
			(level) => level !== "off",
		);
	} catch {
		return model.provider === "anthropic"
			? PI_EFFORT_LEVELS
			: PI_EFFORT_LEVELS_WITH_XHIGH;
	}
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

function applyPermissionModePrompt(
	prompt: string,
	permissionMode: string | undefined,
): string {
	if (permissionMode !== "plan") return prompt;
	return `${PI_PLAN_MODE_PROMPT}\n\nUser request:\n${prompt}`;
}

const PI_PLAN_MODE_PROMPT = `<helmor_plan_mode>
You are running inside Helmor plan mode for Pi.

Plan mode is read-only. Use available read-only tools to inspect the workspace, but do not modify files, run write commands, install packages, or make commits. If you need to verify behavior, use safe inspection commands only.

When you have enough context, finish with a concise implementation plan. Start the final answer with "Plan:" and use numbered steps. Do not implement the plan in this turn. Helmor will render your final answer as a reviewable plan card with Implement and Request Changes actions.
</helmor_plan_mode>`;

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
