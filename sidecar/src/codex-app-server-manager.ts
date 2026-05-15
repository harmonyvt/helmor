/**
 * SessionManager backed by the Codex App Server (JSON-RPC over stdin/stdout).
 *
 * Each Helmor session maps to one `codex app-server` child process.
 * Events are stripped of their JSON-RPC envelope and forwarded as flat
 * JSON via `emitter.passthrough()`. All semantic normalization (camelCase,
 * delta accumulation) happens downstream in Rust.
 */

import crypto from "node:crypto";
import {
	CodexAppServer,
	type JsonRpcNotification,
	type JsonRpcRequest,
} from "./codex-app-server.js";
import { ensureCodexGoalsFeatureEnabled } from "./codex-config.js";
import { buildCodexStoredMeta } from "./context-usage.js";
import type { SidecarEmitter } from "./emitter.js";
import { resolveGitAccessDirectories } from "./git-access.js";
import { parseImageRefs } from "./images.js";
import { prependLinkedDirectoriesContext } from "./linked-directories-context.js";
import { errorDetails, logger } from "./logger.js";
import { listProviderModels, modelSupportsFastMode } from "./model-catalog.js";
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

const CODEX_BIN_PATH = process.env.HELMOR_CODEX_BIN_PATH || "codex";

export type GoalCommand =
	| { kind: "set"; objective: string }
	| { kind: "resume" };

export function parseGoalCommand(prompt: string): GoalCommand | null {
	const match = prompt.trim().match(/^\/goal(?:\s+([\s\S]+))?$/);
	if (!match) return null;
	const arg = (match[1] ?? "").trim();
	if (arg === "") return null;
	if (arg === "resume") return { kind: "resume" };
	return { kind: "set", objective: arg };
}

function dispatchGoalCommand(
	server: CodexAppServer,
	threadId: string,
	command: GoalCommand,
): { method: string; promise: Promise<unknown> } {
	if (command.kind === "resume") {
		return {
			method: "thread/goal/set",
			promise: server.sendRequest(
				"thread/goal/set",
				{ threadId, status: "active" },
				20_000,
			),
		};
	}
	return {
		method: "thread/goal/set",
		promise: server.sendRequest(
			"thread/goal/set",
			{ threadId, objective: command.objective },
			20_000,
		),
	};
}

function buildGoalStatusEvent(
	threadId: string | null,
	command: GoalCommand,
	response: unknown,
): Record<string, unknown> {
	return {
		type: "thread/goal/status",
		action: command.kind,
		status: command.kind === "resume" ? "active" : "set",
		...(threadId ? { threadId } : {}),
		...(command.kind === "set" ? { objective: command.objective } : {}),
		response,
	};
}

/** How long after a "Reconnecting…" stderr line we keep emitting
 *  synthetic heartbeats while Codex owns its retry loop. */
const RETRY_SUPPRESSION_MS = 30_000;
const RETRY_NOTICE_DEDUPE_MS = 1_000;
const MISSING_ITEM_COMPACTION_TIMEOUT_MS = 60_000;
const MISSING_ITEM_THREAD_RECOVERY_TIMEOUT_MS = 20_000;

const HELMOR_CLIENT_INFO = {
	clientInfo: {
		name: "helmor_desktop",
		title: "Helmor Desktop",
		version: "0.1.0",
	},
	capabilities: { experimentalApi: true },
} as const;

// Recoverable thread resume errors — fall back to thread/start.
const RECOVERABLE_RESUME_SNIPPETS = [
	"not found",
	"missing thread",
	"no such thread",
	"unknown thread",
	"does not exist",
];

function isRecoverableResumeError(err: unknown): boolean {
	const msg =
		err instanceof Error
			? err.message.toLowerCase()
			: String(err).toLowerCase();
	return RECOVERABLE_RESUME_SNIPPETS.some((s) => msg.includes(s));
}

function codexErrorMessage(params: unknown): string {
	const errObj = deepGet(params, "error");
	const nested =
		typeof errObj === "object" && errObj !== null
			? (errObj as Record<string, unknown>).message
			: undefined;
	return typeof nested === "string" ? nested : "Unknown Codex error";
}

export function isMissingCodexResponseItemError(message: string): boolean {
	const parsed = parseProviderErrorMessage(message);
	if (parsed) {
		const nestedMessage = stringField(parsed, "message");
		return (
			stringField(parsed, "type") === "invalid_request_error" &&
			stringField(parsed, "param") === "input" &&
			isMissingResponseItemMessage(nestedMessage)
		);
	}

	return isMissingResponseItemMessage(message);
}

function parseProviderErrorMessage(
	message: string,
): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(message) as unknown;
		if (!parsed || typeof parsed !== "object") return null;
		const error = (parsed as Record<string, unknown>).error;
		return error && typeof error === "object"
			? (error as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function stringField(
	object: Record<string, unknown>,
	field: string,
): string | null {
	const value = object[field];
	return typeof value === "string" ? value : null;
}

function isMissingResponseItemMessage(message: string | null): boolean {
	if (!message) return false;
	return /Item with id ['"]rs_[A-Za-z0-9_-]+['"] not found\.?/.test(message);
}

function reconnectSuffix(message: string): string | null {
	const trimmed = message.trimStart();
	const prefix = trimmed.startsWith("Reconnecting...")
		? "Reconnecting..."
		: trimmed.startsWith("Reconnecting…")
			? "Reconnecting…"
			: null;
	if (!prefix) return null;

	return trimmed.slice(prefix.length).trimStart();
}

function isLegacyReconnectNotice(message: string): boolean {
	const suffix = reconnectSuffix(message);
	return suffix !== null && (suffix === "" || /^\d+\s*\/\s*\d+/.test(suffix));
}

function parseReconnectCounts(message: string): {
	attempt: number;
	max: number;
} {
	const suffix = reconnectSuffix(message);
	const match = suffix?.match(/^(\d+)\s*\/\s*(\d+)/);
	return {
		attempt: match ? Number(match[1]) : 0,
		max: match ? Number(match[2]) : 0,
	};
}

// ---------------------------------------------------------------------------
// Per-session context
// ---------------------------------------------------------------------------

interface PendingApproval {
	jsonRpcId: string | number;
	sessionId: string;
}

interface AppServerContext {
	server: CodexAppServer;
	providerThreadId: string | null;
	activeTurnId: string | null;
	turnResolve: (() => void) | null;
	turnReject: ((err: Error) => void) | null;
	/** Request id for the currently streaming sendMessage invocation —
	 *  used by `steer()` to route a synthetic user passthrough event into
	 *  the right Channel so the pipeline renders the steer bubble at the
	 *  correct streaming position (not at the tail). */
	activeRequestId: string | null;
	/** Emitter owning the active stream — `steer()` uses it to fan a
	 *  synthetic `user` passthrough alongside the RPC. */
	activeEmitter: SidecarEmitter | null;
	/** When non-null, BOTH `handleNotification` and `handleRequest` await
	 *  this promise before dispatching. `steer()` installs one for the
	 *  duration of the `turn/steer` RPC so any post-steer deltas OR
	 *  server-initiated tool/user-input requests that arrive before the
	 *  RPC reply are queued at the dispatch boundary and don't reach
	 *  the frontend pipeline/UI until after the synthetic user_prompt
	 *  event lands. Microtask FIFO preserves their relative ordering. */
	notificationGate: Promise<void> | null;
	/** Last send's model id; Codex usage notifications omit it. */
	lastSentModel: string;
	/** Wall-clock ms of the most recent "Reconnecting…" line on the
	 *  Codex child process's stderr. Used to suppress the transient
	 *  {method:"error"} notifications that Codex emits during its own
	 *  SSE retry loop — Codex will recover on its own, so terminating
	 *  the turn would be premature. */
	lastRetryAt: number | null;
	/** Last reconnect notice forwarded to the pipeline. Dedupe stderr +
	 *  JSON-RPC echoes so the user sees liveness without duplicate rows. */
	lastRetryNotice: { key: string; at: number } | null;
}

// ---------------------------------------------------------------------------
// Approval request methods
// ---------------------------------------------------------------------------

const APPROVAL_METHODS = new Set([
	"item/commandExecution/requestApproval",
	"item/fileChange/requestApproval",
	"item/fileRead/requestApproval",
]);

/** Map Codex approval method → Claude-compatible toolName for the frontend. */
function approvalToolName(method: string): string {
	switch (method) {
		case "item/commandExecution/requestApproval":
			return "Bash";
		case "item/fileChange/requestApproval":
			return "apply_patch";
		case "item/fileRead/requestApproval":
			return "Read";
		default:
			return method;
	}
}

/** Extract a human-readable description from approval params. */
function approvalDescription(
	method: string,
	params: Record<string, unknown>,
): string {
	if (method === "item/commandExecution/requestApproval") {
		return typeof params.command === "string" ? params.command : "Run command";
	}
	if (method === "item/fileChange/requestApproval") {
		return typeof params.reason === "string"
			? params.reason
			: "Apply file changes";
	}
	if (method === "item/fileRead/requestApproval") {
		return typeof params.reason === "string" ? params.reason : "Read file";
	}
	return "";
}

/** Build toolInput from approval params — mirrors Claude's permissionRequest shape. */
function approvalToolInput(
	method: string,
	params: Record<string, unknown>,
): Record<string, unknown> {
	if (method === "item/commandExecution/requestApproval") {
		return { command: params.command ?? "" };
	}
	return { ...params };
}

// ---------------------------------------------------------------------------
// CodexAppServerManager
// ---------------------------------------------------------------------------

export class CodexAppServerManager implements SessionManager {
	private sessions = new Map<string, AppServerContext>();
	private pendingApprovals = new Map<string, PendingApproval>();
	private pendingUserInputs = new Map<string, PendingApproval>();

	/** Called by index.ts when frontend responds to a permission prompt. */
	resolvePermission(permissionId: string, behavior: "allow" | "deny"): void {
		const pending = this.pendingApprovals.get(permissionId);
		if (!pending) return;
		this.pendingApprovals.delete(permissionId);

		const ctx = this.sessions.get(pending.sessionId);
		if (!ctx) return;

		const decision = behavior === "allow" ? "accept" : "decline";
		ctx.server.sendResponse(pending.jsonRpcId, { decision });
		logger.debug(`Codex approval resolved`, { permissionId, decision });
	}

	/** Called by index.ts when Rust responds to a user-input request. */
	resolveUserInput(userInputId: string, answers: unknown): void {
		const pending = this.pendingUserInputs.get(userInputId);
		if (!pending) return;
		this.pendingUserInputs.delete(userInputId);

		const ctx = this.sessions.get(pending.sessionId);
		if (!ctx) return;

		ctx.server.sendResponse(pending.jsonRpcId, { answers });
		logger.debug(`Codex user-input resolved`, { userInputId });
	}

	// ── sendMessage ──────────────────────────────────────────────────────

	async sendMessage(
		requestId: string,
		params: SendMessageParams,
		emitter: SidecarEmitter,
	): Promise<void> {
		const {
			sessionId,
			prompt,
			model,
			cwd,
			resume,
			effortLevel,
			permissionMode,
			fastMode,
			additionalDirectories,
			images,
		} = params;
		const workDir = cwd ?? process.cwd();
		const effectiveFastMode =
			fastMode === true && modelSupportsFastMode("codex", model);
		const resolvedAdditionalDirectories = await mergeAdditionalDirectories(
			workDir,
			additionalDirectories,
		);

		logger.debug(`[${requestId}] codex sendMessage`, {
			sessionId,
			model: model ?? "(default)",
			cwd: workDir,
			resume: resume ?? "(none)",
			promptLen: prompt.length,
		});

		const goalCommand = parseGoalCommand(prompt);
		let effectiveResume = resume;
		if (goalCommand) {
			effectiveResume = await this.ensureCodexGoalsReady(
				sessionId,
				effectiveResume,
			);
			effectiveResume = this.recycleIdleContextForGoal(
				sessionId,
				effectiveResume,
			);
		}

		const ctx = await this.ensureContext(
			sessionId,
			workDir,
			effectiveResume,
			model,
			permissionMode,
			effectiveFastMode,
		);
		// Codex usage notifications do not include a model id.
		if (model) ctx.lastSentModel = model;

		// Codex, unlike Claude, has no `additionalDirectoriesForClaudeMd`
		// equivalent — `sandboxPolicy.writableRoots` only grants write
		// permission, it doesn't tell the agent "these paths are part of
		// your working context". To close that gap we prepend a small
		// context preamble to the user's prompt when there are linked
		// directories, so Codex knows it can reach into them without the
		// user re-stating paths every turn. Claude doesn't need this
		// because `--add-dir` covers both facets in the CLI.
		const promptWithContext = prependLinkedDirectoriesContext(
			prompt,
			resolvedAdditionalDirectories,
		);
		const isCompactCommand = !goalCommand && prompt.trim() === "/compact";
		const input = buildTurnInput(promptWithContext, images);
		const turnStartParams: Record<string, unknown> = {
			threadId: ctx.providerThreadId,
			input,
		};
		if (model) turnStartParams.model = model;
		if (effortLevel) turnStartParams.effort = effortLevel;
		if (effectiveFastMode) turnStartParams.serviceTier = "fast";
		const codexMode = toCodexCollaborationMode(permissionMode, model);
		if (codexMode) turnStartParams.collaborationMode = codexMode;
		const codexApproval = toCodexApprovalPolicy(permissionMode);
		if (codexApproval) turnStartParams.approvalPolicy = codexApproval;
		// Always send an explicit per-turn sandbox policy. Codex applies
		// turn-level overrides as the new default for later turns on the
		// thread, which lets us switch cleanly between plan mode
		// (`workspaceWrite`) and normal execution (`dangerFullAccess`)
		// without reopening the thread.
		const sandboxPolicy = buildTurnSandboxPolicy(
			permissionMode,
			workDir,
			resolvedAdditionalDirectories,
		);
		turnStartParams.sandboxPolicy = sandboxPolicy;

		let aborted = false;

		// Stash the active stream's routing info so `steer()` can fire a
		// synthetic user passthrough on the correct request id / emitter.
		ctx.activeRequestId = requestId;
		ctx.activeEmitter = emitter;
		let recoveryCompactionTimeout: ReturnType<typeof setTimeout> | null = null;

		return new Promise<void>((resolve, reject) => {
			let missingItemRecoveryAttempts = 0;
			let recoveryCompactionResolve: (() => void) | null = null;

			ctx.turnResolve = resolve;
			ctx.turnReject = (err) => {
				aborted = true;
				reject(err);
			};

			const emit = (event: object) => {
				emitter.passthrough(requestId, event);
			};

			const finishWithError = (msg: string) => {
				emitter.error(requestId, msg);
				ctx.activeTurnId = null;
				ctx.turnResolve?.();
				ctx.turnResolve = null;
				ctx.turnReject = null;
			};

			const waitForRecoveryCompaction = () =>
				new Promise<void>((compactionResolve, compactionReject) => {
					recoveryCompactionResolve = () => {
						if (recoveryCompactionTimeout) {
							clearTimeout(recoveryCompactionTimeout);
							recoveryCompactionTimeout = null;
						}
						recoveryCompactionResolve = null;
						compactionResolve();
					};
					recoveryCompactionTimeout = setTimeout(() => {
						recoveryCompactionResolve = null;
						recoveryCompactionTimeout = null;
						compactionReject(
							new Error("Timed out waiting for Codex context compaction"),
						);
					}, MISSING_ITEM_COMPACTION_TIMEOUT_MS);
				});

			const startTurn = (label: string) => {
				if (!ctx.providerThreadId) {
					reject(new Error("Cannot start a Codex turn without a thread id"));
					return;
				}
				turnStartParams.threadId = ctx.providerThreadId;
				ctx.server
					.sendRequest("turn/start", turnStartParams)
					.then((response) => {
						const turnId = deepGet(response, "turn", "id");
						if (typeof turnId === "string") {
							ctx.activeTurnId = turnId;
						}
					})
					.catch((err) => {
						logger.error(`${label} failed`, errorDetails(err));
						reject(err);
					});
			};

			const dispatchPrompt = (): {
				method: string;
				promise: Promise<unknown>;
			} => {
				if (isCompactCommand) {
					return {
						method: "thread/compact/start",
						promise: ctx.server.sendRequest(
							"thread/compact/start",
							{ threadId: ctx.providerThreadId },
							20_000,
						),
					};
				}
				if (goalCommand) {
					return dispatchGoalCommand(
						ctx.server,
						ctx.providerThreadId as string,
						goalCommand,
					);
				}
				turnStartParams.threadId = ctx.providerThreadId;
				return {
					method: "turn/start",
					promise: ctx.server.sendRequest("turn/start", turnStartParams),
				};
			};

			const forkThreadForRecovery = async () => {
				if (!ctx.providerThreadId) {
					throw new Error("Cannot fork a Codex thread without a thread id");
				}
				const response = await ctx.server.sendRequest<Record<string, unknown>>(
					"thread/fork",
					buildThreadRecoveryParams(
						ctx.providerThreadId,
						workDir,
						permissionMode,
						model,
						effectiveFastMode,
					),
					MISSING_ITEM_THREAD_RECOVERY_TIMEOUT_MS,
				);
				const threadId = deepGet(response, "thread", "id");
				if (typeof threadId !== "string" || !threadId) {
					throw new Error("thread/fork did not return a thread id");
				}
				ctx.providerThreadId = threadId;
			};

			const compactThreadForRecovery = async () => {
				const compacted = waitForRecoveryCompaction();
				await ctx.server.sendRequest(
					"thread/compact/start",
					{ threadId: ctx.providerThreadId },
					MISSING_ITEM_THREAD_RECOVERY_TIMEOUT_MS,
				);
				await compacted;
			};

			const startFreshThreadForRecovery = async () => {
				const response = await ctx.server.sendRequest<Record<string, unknown>>(
					"thread/start",
					buildThreadStartParams(
						workDir,
						permissionMode,
						model,
						effectiveFastMode,
					),
					MISSING_ITEM_THREAD_RECOVERY_TIMEOUT_MS,
				);
				const threadId = deepGet(response, "thread", "id");
				if (typeof threadId !== "string" || !threadId) {
					throw new Error("thread/start did not return a thread id");
				}
				ctx.providerThreadId = threadId;
			};

			const recoverMissingResponseItem = async (originalMessage: string) => {
				const recoveryAttempt = missingItemRecoveryAttempts++;
				ctx.activeTurnId = null;
				emitMissingResponseItemRecoveryNotice(ctx, requestId);

				try {
					if (recoveryAttempt === 0) {
						try {
							await forkThreadForRecovery();
							logger.info(
								"Codex missing response item recovered via thread fork",
								{
									requestId,
									sessionId,
									threadId: ctx.providerThreadId,
								},
							);
						} catch (forkError) {
							logger.info(
								"Codex missing response item fork recovery failed; trying compaction",
								errorDetails(forkError),
							);
							try {
								await compactThreadForRecovery();
								logger.info(
									"Codex missing response item recovered via compaction",
									{
										requestId,
										sessionId,
										threadId: ctx.providerThreadId,
									},
								);
							} catch (compactError) {
								logger.info(
									"Codex missing response item compaction recovery failed; starting fresh thread",
									errorDetails(compactError),
								);
								await startFreshThreadForRecovery();
								logger.info(
									"Codex missing response item recovered via fresh thread fallback",
									{
										requestId,
										sessionId,
										threadId: ctx.providerThreadId,
									},
								);
							}
						}
						startTurn("turn/start retry after context recovery");
						return;
					}

					await startFreshThreadForRecovery();
					logger.info(
						"Codex missing response item recovered via fresh thread",
						{
							requestId,
							sessionId,
							threadId: ctx.providerThreadId,
						},
					);
					startTurn("turn/start retry after fresh thread recovery");
				} catch (err) {
					if (recoveryCompactionTimeout) {
						clearTimeout(recoveryCompactionTimeout);
						recoveryCompactionTimeout = null;
					}
					recoveryCompactionResolve = null;
					logger.error(
						"Codex missing response item recovery failed",
						errorDetails(err),
					);
					finishWithError(originalMessage);
				}
			};

			const handleNotification = async (n: JsonRpcNotification) => {
				// Steer gate: if `steer()` is mid-RPC, hold this
				// notification until the RPC resolves and the synthetic
				// user_prompt event has been emitted. JS microtask FIFO
				// keeps concurrent notifications in their arrival order,
				// and the gate guarantees they all land AFTER the
				// synthetic event — fixes the delta-before-RPC-reply race
				// flagged in review.
				if (ctx.notificationGate) {
					await ctx.notificationGate;
				}

				// Codex sends errors as {method:"error", params:{error:{message:"..."}}}.
				// Reconnect progress notices are not terminal: the app-server keeps
				// the turn alive and may emit more deltas after reconnecting.
				if (n.method === "error") {
					const msg = codexErrorMessage(n.params);
					// App-server protocol marks retryable stream errors with
					// params.willRetry=true. Older builds omit the structured bit,
					// so only suppress their explicit reconnect progress messages.
					// A recent stderr reconnect line is liveness context, not proof
					// that an arbitrary later error is retryable.
					if (
						!isCompactCommand &&
						missingItemRecoveryAttempts < 2 &&
						ctx.providerThreadId &&
						isMissingCodexResponseItemError(msg)
					) {
						void recoverMissingResponseItem(msg);
						return;
					}
					const willRetry = deepGet(n.params, "willRetry");
					const lastRetry = ctx.lastRetryAt ?? 0;
					const suppressForProtocolRetry = willRetry === true;
					const suppressForLegacyRetryWindow =
						typeof willRetry !== "boolean" &&
						isLegacyReconnectNotice(msg) &&
						(lastRetry === 0 || Date.now() - lastRetry < RETRY_SUPPRESSION_MS);
					if (suppressForProtocolRetry || suppressForLegacyRetryWindow) {
						emitRetryNotice(ctx, requestId, msg);
						logger.info(
							"suppressing retryable Codex error; awaiting recovery",
							{
								requestId,
								msg,
								willRetry,
								msSinceRetry: Date.now() - lastRetry,
							},
						);
						return;
					}
					finishWithError(msg);
					return;
				}

				const flat = flattenNotification(n, ctx.providerThreadId);
				emit(flat);

				if (n.method === "thread/started") {
					const threadId = deepGet(n.params, "thread", "id");
					if (typeof threadId === "string") {
						ctx.providerThreadId = threadId;
					}
				}

				if (n.method === "turn/started") {
					const turnId = deepGet(n.params, "turn", "id");
					if (typeof turnId === "string") {
						ctx.activeTurnId = turnId;
					}
				}

				// Forward Codex token usage to the context-usage ring.
				if (n.method === "thread/tokenUsage/updated") {
					const tokenUsage = deepGet(n.params, "tokenUsage");
					if (tokenUsage && typeof tokenUsage === "object") {
						try {
							const meta = buildCodexStoredMeta(tokenUsage, ctx.lastSentModel);
							if (meta) {
								emitter.contextUsageUpdated(
									requestId,
									sessionId,
									JSON.stringify(meta),
								);
							}
						} catch (err) {
							logger.debug("contextUsageUpdated emit failed", {
								sessionId,
								...errorDetails(err),
							});
						}
					}
				}

				if (n.method === "turn/completed") {
					const completedTurnId =
						deepGet(n.params, "turn", "id") ?? deepGet(n.params, "turnId");
					// Only resolve if this is our active turn (not a child/collab turn)
					if (!ctx.activeTurnId || completedTurnId === ctx.activeTurnId) {
						ctx.activeTurnId = null;
						// Clean up any pending user inputs for this session
						for (const [id, p] of this.pendingUserInputs) {
							if (p.sessionId === sessionId) this.pendingUserInputs.delete(id);
						}
						for (const [id, p] of this.pendingApprovals) {
							if (p.sessionId === sessionId) this.pendingApprovals.delete(id);
						}
						ctx.turnResolve?.();
						ctx.turnResolve = null;
						ctx.turnReject = null;
					}
				}

				if (n.method === "thread/compacted") {
					if (recoveryCompactionResolve) {
						recoveryCompactionResolve();
						return;
					}
					ctx.activeTurnId = null;
					ctx.turnResolve?.();
					ctx.turnResolve = null;
					ctx.turnReject = null;
				}
			};

			const handleRequest = async (req: JsonRpcRequest) => {
				// Same gate as handleNotification: server-initiated
				// requests (tool approvals, user-input prompts) that
				// arrive during a `steer()` RPC window must not reach
				// the frontend UI before the synthetic user_prompt
				// event lands. Otherwise the permission/input panel
				// could pop before the steer bubble shows up, making
				// the interaction order look inconsistent.
				if (ctx.notificationGate) {
					await ctx.notificationGate;
				}

				if (APPROVAL_METHODS.has(req.method)) {
					const p = (req.params ?? {}) as Record<string, unknown>;
					const permissionId = `codex-${crypto.randomUUID()}`;

					this.pendingApprovals.set(permissionId, {
						jsonRpcId: req.id,
						sessionId,
					});

					emitter.permissionRequest(
						requestId,
						permissionId,
						approvalToolName(req.method),
						approvalToolInput(req.method, p),
						undefined,
						approvalDescription(req.method, p),
					);
					logger.debug(`Codex approval request`, {
						permissionId,
						method: req.method,
					});
					return;
				}
				if (req.method === "item/tool/requestUserInput") {
					const p = (req.params ?? {}) as Record<string, unknown>;
					const userInputId = `codex-input-${crypto.randomUUID()}`;
					const questions = Array.isArray(p.questions) ? p.questions : [];

					this.pendingUserInputs.set(userInputId, {
						jsonRpcId: req.id,
						sessionId,
					});

					emitter.userInputRequest(requestId, userInputId, questions);
					logger.debug(`Codex user-input request`, { userInputId });
					return;
				}
				// Unknown server request — auto-reject
				ctx.server.sendResponse(req.id, undefined);
			};

			ctx.server.setHandlers(handleNotification, handleRequest);
			ctx.server.setActiveRequestId(requestId);

			if ((isCompactCommand || goalCommand) && !ctx.providerThreadId) {
				reject(
					new Error(
						`Cannot run /${isCompactCommand ? "compact" : "goal"} before a Codex thread has started`,
					),
				);
				return;
			}

			if (!isCompactCommand && !goalCommand) {
				startTurn("turn/start");
			} else {
				const { method, promise } = dispatchPrompt();
				promise
					.then((response) => {
						if (goalCommand) {
							emit(
								buildGoalStatusEvent(
									ctx.providerThreadId,
									goalCommand,
									response,
								),
							);
						}
						const turnId = deepGet(response, "turn", "id");
						if (typeof turnId === "string") {
							ctx.activeTurnId = turnId;
						}
					})
					.catch((err) => {
						logger.error(`${method} failed`, errorDetails(err));
						reject(err);
					});
			}
		}).finally(() => {
			if (recoveryCompactionTimeout) {
				clearTimeout(recoveryCompactionTimeout);
			}
			if (aborted) {
				emitter.aborted(requestId, "user_requested");
			} else {
				emitter.end(requestId);
			}
		});
	}

	// ── generateTitle ────────────────────────────────────────────────────

	async generateTitle(
		requestId: string,
		userMessage: string,
		branchRenamePrompt: string | null,
		emitter: SidecarEmitter,
		timeoutMs = TITLE_GENERATION_TIMEOUT_MS,
		_options?: GenerateTitleOptions,
	): Promise<void> {
		const cwd = process.cwd();
		const server = new CodexAppServer({
			binaryPath: CODEX_BIN_PATH,
			cwd,
			onNotification: () => {},
			onRequest: (req) => {
				if (APPROVAL_METHODS.has(req.method)) {
					server.sendResponse(req.id, { decision: "accept" });
				}
			},
			onExit: () => {},
			onError: () => {},
		});

		const timeout = setTimeout(() => server.kill(), timeoutMs);

		try {
			await server.sendRequest("initialize", HELMOR_CLIENT_INFO);
			server.writeNotification("initialized");

			const threadResponse = await server.sendRequest<Record<string, unknown>>(
				"thread/start",
				{},
			);
			const threadId = deepGet(threadResponse, "thread", "id") as
				| string
				| undefined;
			if (!threadId) throw new Error("thread/start did not return thread id");

			let raw = "";
			const done = new Promise<void>((resolve) => {
				server.setHandlers(
					(n) => {
						if (n.method === "item/agentMessage/delta") {
							const delta = deepGet(n.params, "delta");
							if (typeof delta === "string") raw += delta;
						}
						if (n.method === "turn/completed") resolve();
					},
					(req) => {
						if (APPROVAL_METHODS.has(req.method)) {
							server.sendResponse(req.id, { decision: "accept" });
						}
					},
				);
			});

			await server.sendRequest("turn/start", {
				threadId,
				input: [
					{
						type: "text",
						text: buildTitlePrompt(userMessage, branchRenamePrompt),
						text_elements: [],
					},
				],
			});

			await done;
			const { title, branchName } = parseTitleAndBranch(raw);
			emitter.titleGenerated(requestId, title, branchName);
		} finally {
			clearTimeout(timeout);
			server.kill();
		}
	}

	// ── listSlashCommands ────────────────────────────────────────────────

	async listSlashCommands(
		params: ListSlashCommandsParams,
	): Promise<readonly SlashCommandInfo[]> {
		const cwd = params.cwd ?? process.cwd();
		const server = new CodexAppServer({
			binaryPath: CODEX_BIN_PATH,
			cwd,
			onNotification: () => {},
			onRequest: () => {},
			onExit: () => {},
			onError: () => {},
		});

		try {
			await server.sendRequest("initialize", HELMOR_CLIENT_INFO);
			server.writeNotification("initialized");

			// 20s — mirrors the Claude sidecar slash-command timeout so both
			// providers fail the same way when their CLI is missing/slow.
			const result = await server.sendRequest<Record<string, unknown>>(
				"skills/list",
				{ cwds: [cwd] },
				20_000,
			);

			return parseSkillsResponse(result, cwd);
		} finally {
			server.kill();
		}
	}

	// ── listModels ───────────────────────────────────────────────────────

	async listModels(): Promise<readonly ProviderModelInfo[]> {
		return listProviderModels("codex");
	}

	// ── stopSession / shutdown ───────────────────────────────────────────

	async stopSession(sessionId: string): Promise<void> {
		const ctx = this.sessions.get(sessionId);
		if (!ctx) return;
		logger.info(`stopSession ${sessionId}`, {
			threadId: ctx.providerThreadId ?? "(none)",
		});

		for (const [id, p] of this.pendingApprovals) {
			if (p.sessionId === sessionId) this.pendingApprovals.delete(id);
		}
		for (const [id, p] of this.pendingUserInputs) {
			if (p.sessionId === sessionId) this.pendingUserInputs.delete(id);
		}

		const pendingReject = ctx.turnReject;
		const turnToInterrupt = ctx.activeTurnId;
		ctx.turnResolve = null;
		ctx.turnReject = null;
		ctx.activeTurnId = null;

		if (ctx.providerThreadId && turnToInterrupt) {
			try {
				await ctx.server.sendRequest(
					"turn/interrupt",
					{ threadId: ctx.providerThreadId, turnId: turnToInterrupt },
					5_000,
				);
			} catch {
				// best-effort
			}
		}

		ctx.server.kill();
		this.sessions.delete(sessionId);

		// Use AbortError so the index catch can distinguish user-stop from real errors
		const abortErr = new DOMException("Session stopped by user", "AbortError");
		pendingReject?.(abortErr);
	}

	/**
	 * Real mid-turn steer via Codex's native `turn/steer` RPC — appends
	 * user input to the active turn without starting a new one. Emits a
	 * `user_prompt` passthrough so the accumulator places the bubble at
	 * the current position AND streaming.rs persists it once (same DB
	 * shape as initial prompts; adapter reads it identically on reload).
	 *
	 * Two correctness properties this method enforces:
	 *
	 *   1. **No ghost steer on rejection.** RPC goes first; the synthetic
	 *      event is only emitted after the RPC resolves successfully. A
	 *      thrown RPC error (expectedTurnId mismatch, timeout, server
	 *      error) propagates up WITHOUT ever touching the pipeline.
	 *
	 *   2. **Strict ordering with post-steer notifications.** We install
	 *      a `notificationGate` promise for the RPC window. Any
	 *      server-side deltas that arrive before the RPC reply (possible
	 *      if the server buffers the reply and streams tokens first) hit
	 *      `handleNotification`, await the gate, and only flow into the
	 *      pipeline AFTER the synthetic user_prompt event is emitted.
	 *      JS microtask FIFO preserves their relative order.
	 *
	 * Returns `true` when accepted, `false` when no active turn exists.
	 */
	async steer(
		sessionId: string,
		prompt: string,
		files: readonly string[],
		// Codex's `turn/steer` RPC forwards text only; the SDK has no
		// hook to attach images mid-turn. We still carry `images` on the
		// synthetic `user_prompt` event below so the persisted shape
		// matches the optimistic render — the badges remain visible on
		// reload — but the model itself never sees the bytes. The
		// frontend should warn the user before they steer with images
		// attached on a Codex session.
		images: readonly string[],
	): Promise<boolean> {
		const ctx = this.sessions.get(sessionId);
		if (!ctx?.providerThreadId || !ctx.activeTurnId) {
			return false;
		}
		if (images.length > 0) {
			// `info` rather than a richer log level — the sidecar's
			// `Logger` only exposes debug/info/error. Surface the
			// limitation prominently so the user can correlate "Codex
			// didn't see my image" with this line in the JSONL log.
			logger.info(
				`steer ${sessionId}: ${images.length} image(s) dropped (codex turn/steer is text-only)`,
				{
					note: "images are persisted to the DB so the bubble keeps its badge after reload, but the model itself does not see them",
				},
			);
		}
		logger.info(`steer ${sessionId}`, {
			threadId: ctx.providerThreadId,
			turnId: ctx.activeTurnId,
			preview: prompt.slice(0, 60),
			fileCount: files.length,
			imageCount: images.length,
		});

		let releaseGate: () => void = () => {};
		ctx.notificationGate = new Promise<void>((resolve) => {
			releaseGate = resolve;
		});

		try {
			// RPC first. Thrown errors (reject, timeout, expectedTurnId
			// mismatch) propagate WITHOUT emitting the synthetic event.
			await ctx.server.sendRequest(
				"turn/steer",
				{
					threadId: ctx.providerThreadId,
					input: [{ type: "text", text: prompt }],
					expectedTurnId: ctx.activeTurnId,
				},
				5_000,
			);

			// Provider accepted. Emit the synthetic event BEFORE releasing
			// the gate so queued notifications land after it in FIFO.
			// `images` rides on the event purely for persistence/reload
			// fidelity (see the steer() doc above) — Codex's turn/steer
			// already returned without seeing them.
			if (ctx.activeEmitter && ctx.activeRequestId) {
				const event: {
					type: "user_prompt";
					text: string;
					steer: true;
					files?: string[];
					images?: string[];
				} = { type: "user_prompt", text: prompt, steer: true };
				if (files.length > 0) event.files = [...files];
				if (images.length > 0) event.images = [...images];
				ctx.activeEmitter.passthrough(ctx.activeRequestId, event);
			}
			return true;
		} finally {
			// Always release the gate — rejection path lets queued
			// notifications flow through normally (no synthetic ahead of
			// them; Codex shouldn't have sent deltas for a rejected
			// steer anyway, and if it did, treating them as main-stream
			// events is the conservative choice).
			ctx.notificationGate = null;
			releaseGate();
		}
	}

	async shutdown(): Promise<void> {
		for (const [_id, ctx] of this.sessions) {
			try {
				ctx.turnReject?.(new Error("Sidecar shutdown"));
				ctx.turnResolve = null;
				ctx.turnReject = null;
				ctx.server.kill();
			} catch (err) {
				logger.error("shutdown: kill failed", errorDetails(err));
			}
		}
		this.sessions.clear();
		this.pendingApprovals.clear();
		this.pendingUserInputs.clear();
	}

	// ── Private ──────────────────────────────────────────────────────────

	private async ensureCodexGoalsReady(
		sessionId: string,
		callerResume: string | undefined,
	): Promise<string | undefined> {
		let result: Awaited<ReturnType<typeof ensureCodexGoalsFeatureEnabled>>;
		try {
			result = await ensureCodexGoalsFeatureEnabled();
		} catch (err) {
			logger.error("ensureCodexGoalsFeatureEnabled failed", errorDetails(err));
			return callerResume;
		}
		if (result.kind !== "modified") return callerResume;

		const stale = this.sessions.get(sessionId);
		if (!stale) {
			logger.info("Enabled codex goals feature", {
				sessionId,
				path: result.path,
			});
			return callerResume;
		}

		logger.info("Enabled codex goals feature; recycling stale session", {
			sessionId,
			path: result.path,
			providerThreadId: stale.providerThreadId ?? "(none)",
		});
		const reuseThread = stale.providerThreadId ?? undefined;
		stale.server.kill();
		this.sessions.delete(sessionId);
		this.clearPendingSessionState(sessionId);
		return callerResume ?? reuseThread;
	}

	private clearPendingSessionState(sessionId: string): void {
		for (const [id, pending] of this.pendingApprovals) {
			if (pending.sessionId === sessionId) this.pendingApprovals.delete(id);
		}
		for (const [id, pending] of this.pendingUserInputs) {
			if (pending.sessionId === sessionId) this.pendingUserInputs.delete(id);
		}
	}

	private recycleIdleContextForGoal(
		sessionId: string,
		callerResume: string | undefined,
	): string | undefined {
		const stale = this.sessions.get(sessionId);
		if (!stale || stale.server.killed) return callerResume;
		if (stale.turnResolve || stale.turnReject || stale.activeTurnId) {
			logger.info("Skipping /goal context recycle while turn is active", {
				sessionId,
				providerThreadId: stale.providerThreadId ?? "(none)",
				activeTurnId: stale.activeTurnId ?? "(none)",
			});
			return callerResume;
		}

		const reuseThread = stale.providerThreadId ?? undefined;
		logger.info("Recycling idle Codex context before /goal", {
			sessionId,
			providerThreadId: reuseThread ?? "(none)",
		});
		stale.server.kill();
		this.sessions.delete(sessionId);
		this.clearPendingSessionState(sessionId);
		return callerResume ?? reuseThread;
	}

	/**
	 * Get an existing session context or create a new one. When `resume`
	 * is set (provider thread ID from a previous session), attempts
	 * `thread/resume` first, falling back to `thread/start` on
	 * recoverable errors.
	 */
	private async ensureContext(
		sessionId: string,
		cwd: string,
		resume?: string,
		model?: string,
		permissionMode?: string,
		fastMode?: boolean,
	): Promise<AppServerContext> {
		const existing = this.sessions.get(sessionId);
		if (existing && !existing.server.killed) return existing;

		// Forward-reference holder so the `onRetry` closure can reach the
		// context that's constructed below — the callback only fires once
		// the CodexAppServer is running, by which point `ctxRef.current`
		// has been populated.
		const ctxRef: { current: AppServerContext | null } = { current: null };

		const server = new CodexAppServer({
			binaryPath: CODEX_BIN_PATH,
			cwd,
			onNotification: () => {},
			onRequest: () => {},
			onExit: () => {
				this.sessions.delete(sessionId);
			},
			onError: (err) => {
				logger.error("codex app-server error", errorDetails(err));
			},
			onRetry: (message) => {
				const c = ctxRef.current;
				if (!c) return;
				c.lastRetryAt = Date.now();
				// Pulse a synthetic heartbeat so Rust's 45s watchdog doesn't
				// declare the sidecar dead while Codex is silently retrying
				// against an upstream provider (e.g. Azure OpenAI mini-outage).
				if (c.activeRequestId) {
					emitRetryNotice(c, c.activeRequestId, message);
				}
				logger.debug("codex retry detected; suppression window armed", {
					sessionId,
					activeRequestId: c.activeRequestId,
				});
			},
		});

		await server.sendRequest("initialize", HELMOR_CLIENT_INFO);
		server.writeNotification("initialized");

		let threadId: string | null = null;

		if (resume) {
			try {
				logger.info(`Attempting thread/resume`, { threadId: resume });
				const response = await server.sendRequest<Record<string, unknown>>(
					"thread/resume",
					{ threadId: resume },
				);
				threadId = (deepGet(response, "thread", "id") as string) ?? resume;
				logger.info(`Resumed Codex thread`, { threadId });
			} catch (err) {
				if (isRecoverableResumeError(err)) {
					logger.debug(
						`thread/resume failed (recoverable), falling back to thread/start: ${err instanceof Error ? err.message : String(err)}`,
					);
				} else {
					server.kill();
					throw err;
				}
			}
		}

		if (!threadId) {
			logger.info("Starting new Codex thread", {
				cwd,
				model: model ?? "(default)",
			});
			const response = await server.sendRequest<Record<string, unknown>>(
				"thread/start",
				buildThreadStartParams(cwd, permissionMode, model, fastMode === true),
			);
			threadId = (deepGet(response, "thread", "id") as string) ?? null;
			logger.info("Codex thread started", { threadId: threadId ?? "(none)" });
		}

		const ctx: AppServerContext = {
			server,
			providerThreadId: threadId,
			activeTurnId: null,
			turnResolve: null,
			turnReject: null,
			activeRequestId: null,
			activeEmitter: null,
			notificationGate: null,
			lastSentModel: model ?? "",
			lastRetryAt: null,
			lastRetryNotice: null,
		};

		this.sessions.set(sessionId, ctx);
		ctxRef.current = ctx;
		return ctx;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function retryNoticeKey(message: string): string {
	return message.replace(/…/g, "...").replace(/\s+/g, " ").trim();
}

function emitRetryNotice(
	ctx: AppServerContext,
	requestId: string,
	message: string,
): void {
	if (!ctx.activeEmitter) return;

	try {
		ctx.activeEmitter.heartbeat(requestId);
	} catch {
		return;
	}

	const now = Date.now();
	const key = retryNoticeKey(message);
	if (
		ctx.lastRetryNotice?.key === key &&
		now - ctx.lastRetryNotice.at < RETRY_NOTICE_DEDUPE_MS
	) {
		return;
	}
	ctx.lastRetryNotice = { key, at: now };

	const { attempt, max } = parseReconnectCounts(message);
	ctx.activeEmitter.passthrough(requestId, {
		type: "system",
		subtype: "codex_reconnecting",
		attempt,
		max_retries: max,
		retry_delay_ms: 0,
		error: message,
	});
}

function emitMissingResponseItemRecoveryNotice(
	ctx: AppServerContext,
	requestId: string,
): void {
	ctx.activeEmitter?.passthrough(requestId, {
		type: "system",
		subtype: "codex_missing_response_item_recovery",
	});
}

function buildThreadStartParams(
	cwd: string,
	permissionMode: string | undefined,
	model: string | undefined,
	fastMode: boolean,
): Record<string, unknown> {
	const params: Record<string, unknown> = {
		cwd,
		approvalPolicy: toCodexApprovalPolicy(permissionMode) ?? "never",
		sandbox:
			permissionMode === "plan" ? "workspace-write" : "danger-full-access",
	};
	if (model) params.model = model;
	if (fastMode) params.serviceTier = "fast";
	return params;
}

function buildThreadRecoveryParams(
	threadId: string,
	cwd: string,
	permissionMode: string | undefined,
	model: string | undefined,
	fastMode: boolean,
): Record<string, unknown> {
	return {
		threadId,
		...buildThreadStartParams(cwd, permissionMode, model, fastMode),
	};
}

function flattenNotification(
	n: JsonRpcNotification,
	sessionId: string | null,
): Record<string, unknown> {
	const params =
		n.params && typeof n.params === "object"
			? (n.params as Record<string, unknown>)
			: {};
	return {
		type: n.method,
		...params,
		...(sessionId ? { session_id: sessionId } : {}),
	};
}

function buildTurnInput(
	prompt: string,
	images: readonly string[],
): Array<Record<string, unknown>> {
	const { text, imagePaths } = parseImageRefs(prompt, images);
	const parts: Array<Record<string, unknown>> = [];
	if (text) {
		parts.push({ type: "text", text, text_elements: [] });
	}
	for (const p of imagePaths) {
		parts.push({ type: "localImage", path: p });
	}
	if (parts.length === 0) {
		parts.push({ type: "text", text: prompt, text_elements: [] });
	}
	return parts;
}

function deepGet(obj: unknown, ...keys: string[]): unknown {
	let current = obj;
	for (const key of keys) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function parseSkillsResponse(result: unknown, cwd: string): SlashCommandInfo[] {
	if (!result || typeof result !== "object") return [];
	const r = result as Record<string, unknown>;

	let skills: unknown[] = [];
	const dataBuckets = Array.isArray(r.data) ? r.data : [];
	const bucket = dataBuckets.find(
		(b: unknown) =>
			typeof b === "object" &&
			b !== null &&
			(b as Record<string, unknown>).cwd === cwd,
	);
	if (bucket && typeof bucket === "object") {
		const s = (bucket as Record<string, unknown>).skills;
		if (Array.isArray(s)) skills = s;
	}
	if (skills.length === 0 && Array.isArray(r.skills)) {
		skills = r.skills;
	}

	return skills.flatMap((s) => {
		if (!s || typeof s !== "object") return [];
		const skill = s as Record<string, unknown>;
		const name = typeof skill.name === "string" ? skill.name : null;
		if (!name) return [];

		const desc =
			typeof skill.shortDescription === "string"
				? skill.shortDescription
				: typeof skill.description === "string"
					? skill.description
					: "";

		return [
			{
				name,
				description: desc,
				argumentHint: undefined,
				source: "skill" as const,
				sourceInfo: undefined,
			},
		];
	});
}

/**
 * Map Helmor's permissionMode to Codex's collaborationMode.
 * Returns undefined when no override is needed (i.e. default mode).
 */
function toCodexCollaborationMode(
	permissionMode: string | undefined,
	model: string | undefined,
): Record<string, unknown> | undefined {
	if (permissionMode === "plan") {
		return {
			mode: "plan",
			settings: {
				...(model ? { model } : {}),
			},
		};
	}
	// Explicitly switch to default mode — Codex stays in plan mode
	// across turns unless told otherwise.
	if (
		permissionMode === "bypassPermissions" ||
		permissionMode === "acceptEdits"
	) {
		return {
			mode: "default",
			settings: {
				...(model ? { model } : {}),
			},
		};
	}
	return undefined;
}

/**
 * Map Helmor's permissionMode to Codex's approvalPolicy.
 * "never" = full auto (no approval popups).
 * Only override on non-plan modes — plan mode is read-only by design.
 */
function toCodexApprovalPolicy(
	permissionMode: string | undefined,
): string | undefined {
	if (permissionMode === "bypassPermissions") return "never";
	if (permissionMode === "acceptEdits") return "untrusted";
	// plan mode: don't override — Codex plan mode is inherently read-only
	return undefined;
}

async function mergeAdditionalDirectories(
	cwd: string | undefined,
	userDirectories: readonly string[] | undefined,
): Promise<string[]> {
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const raw of userDirectories ?? []) {
		const trimmed = raw.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		merged.push(trimmed);
	}
	const gitDirs = await resolveGitAccessDirectories(cwd);
	for (const dir of gitDirs) {
		if (seen.has(dir)) continue;
		seen.add(dir);
		merged.push(dir);
	}
	return merged;
}

/**
 * Build the explicit per-turn sandbox policy for Codex. We always send a
 * policy so a thread that previously ran in plan mode can switch back to
 * full access on the next turn without being recreated.
 *
 * For plan mode we keep Codex in `workspaceWrite` and include cwd plus any
 * linked directories in `writableRoots`. For all other modes we explicitly
 * restore `dangerFullAccess`.
 */
export function buildTurnSandboxPolicy(
	permissionMode: string | undefined,
	cwd: string | undefined,
	additionalDirectories: readonly string[] | undefined,
):
	| {
			type: "dangerFullAccess";
	  }
	| {
			type: "workspaceWrite";
			writableRoots: string[];
			networkAccess: false;
	  } {
	if (permissionMode !== "plan") {
		return { type: "dangerFullAccess" };
	}
	const seen = new Set<string>();
	const out: string[] = [];
	const cwdTrimmed = cwd?.trim();
	if (cwdTrimmed) {
		seen.add(cwdTrimmed);
		out.push(cwdTrimmed);
	}
	for (const raw of additionalDirectories ?? []) {
		const trimmed = raw.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return {
		type: "workspaceWrite",
		writableRoots: out,
		networkAccess: false,
	};
}
