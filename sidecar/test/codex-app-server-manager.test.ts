import { beforeEach, describe, expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createSidecarEmitter, type SidecarEmitter } from "../src/emitter.js";

process.env.HELMOR_LOG_DIR = resolve(tmpdir(), "helmor-sidecar-test-logs");

type RequestRecord = {
	method: string;
	params: unknown;
};

const serverState = {
	requests: [] as RequestRecord[],
	onNotification: null as
		| null
		| ((notification: { method: string; params?: unknown }) => void),
	/** Optional hook tests use to inject extra notifications between
	 *  `turn/started` and `turn/completed` (e.g. `thread/tokenUsage/updated`). */
	beforeTurnCompleted: null as null | (() => void),
	goalStatusNotifications: [] as Array<Record<string, unknown>>,
	goalSetError: null as null | Error,
	instances: [] as MockCodexAppServer[],
};
const gitAccessState = {
	directories: [] as string[],
};
const codexConfigState = {
	result: {
		kind: "alreadyEnabled" as "alreadyEnabled" | "modified",
		path: "/fake/.codex/config.toml",
	},
	calls: 0,
};

class MockCodexAppServer {
	killed = false;

	constructor() {
		serverState.instances.push(this);
	}

	async sendRequest(method: string, params: unknown): Promise<unknown> {
		serverState.requests.push({ method, params });

		if (method === "initialize") return {};
		if (method === "thread/start") {
			return { thread: { id: "thread-1" } };
		}
		if (method === "thread/resume") {
			return {
				thread: {
					id:
						(params as { threadId?: string } | undefined)?.threadId ??
						"thread-resumed",
				},
			};
		}
		if (method === "thread/goal/set") {
			if (serverState.goalSetError) throw serverState.goalSetError;
			queueMicrotask(() => {
				serverState.onNotification?.({
					method: "turn/started",
					params: { turn: { id: "turn-goal-1" } },
				});
				for (const params of serverState.goalStatusNotifications) {
					serverState.onNotification?.({
						method: "thread/goal/status",
						params,
					});
				}
				serverState.onNotification?.({
					method: "turn/completed",
					params: { turn: { id: "turn-goal-1" } },
				});
			});
			return {};
		}
		if (method === "turn/start") {
			queueMicrotask(() => {
				serverState.onNotification?.({
					method: "turn/started",
					params: { turn: { id: "turn-1" } },
				});
				serverState.beforeTurnCompleted?.();
				serverState.onNotification?.({
					method: "turn/completed",
					params: { turn: { id: "turn-1" } },
				});
			});
			return {};
		}
		return {};
	}

	writeNotification(_method: string, _params?: unknown): void {}
	setHandlers(
		onNotification: (notification: {
			method: string;
			params?: unknown;
		}) => void,
		_onRequest: unknown,
	): void {
		serverState.onNotification = onNotification;
	}

	setActiveRequestId(_id: string): void {}

	sendResponse(_requestId: string | number, _result: unknown): void {}
	kill(): void {
		this.killed = true;
	}
}

mock.module("../src/codex-app-server.js", () => ({
	CodexAppServer: MockCodexAppServer,
}));

mock.module("../src/git-access.js", () => ({
	resolveGitAccessDirectories: async () => [...gitAccessState.directories],
}));

mock.module("../src/codex-config.js", () => ({
	ensureCodexGoalsFeatureEnabled: async () => {
		codexConfigState.calls += 1;
		return { ...codexConfigState.result };
	},
}));

const { CodexAppServerManager } = await import(
	"../src/codex-app-server-manager.js"
);
const { MAX_CODEX_GOAL_OBJECTIVE_CHARS } = await import(
	"../src/codex-app-server-manager.js"
);

describe("CodexAppServerManager", () => {
	let emitter: SidecarEmitter;

	beforeEach(() => {
		serverState.requests = [];
		serverState.onNotification = null;
		serverState.beforeTurnCompleted = null;
		serverState.goalStatusNotifications = [];
		serverState.goalSetError = null;
		serverState.instances = [];
		gitAccessState.directories = [];
		codexConfigState.result = {
			kind: "alreadyEnabled",
			path: "/fake/.codex/config.toml",
		};
		codexConfigState.calls = 0;
		emitter = createSidecarEmitter(() => {});
	});

	test("returns the hardcoded model list", async () => {
		const manager = new CodexAppServerManager();

		const models = await manager.listModels();

		expect(models).toHaveLength(6);
		expect(models).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "gpt-5.5",
					supportsFastMode: true,
				}),
				expect.objectContaining({
					id: "gpt-5.4",
					supportsFastMode: true,
				}),
				expect.objectContaining({
					id: "gpt-5.4-mini",
					supportsFastMode: true,
				}),
			]),
		);
		expect(serverState.requests).toEqual([]);
	});

	test("forwards service tier when fast mode is enabled for a codex model", async () => {
		const manager = new CodexAppServerManager();

		await manager.sendMessage(
			"REQ-fast-codex",
			{
				sessionId: "session-1",
				prompt: "hello",
				model: "gpt-5.4",
				cwd: "/tmp",
				resume: undefined,
				permissionMode: undefined,
				effortLevel: "high",
				fastMode: true,
				images: [],
			},
			emitter,
		);

		const threadStart = serverState.requests.find(
			(request) => request.method === "thread/start",
		);
		const turnStart = serverState.requests.find(
			(request) => request.method === "turn/start",
		);

		expect(threadStart?.params).toEqual(
			expect.objectContaining({ serviceTier: "fast" }),
		);
		expect(turnStart?.params).toEqual(
			expect.objectContaining({ serviceTier: "fast" }),
		);
	});

	test("dispatches /goal prompts through Codex goal API", async () => {
		const manager = new CodexAppServerManager();

		await manager.sendMessage(
			"REQ-goal",
			{
				sessionId: "session-goal",
				prompt: "/goal Finish the migration and keep tests green",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "high",
				fastMode: false,
				images: [],
			},
			emitter,
		);

		const goalSet = serverState.requests.find(
			(request) => request.method === "thread/goal/set",
		);
		expect(codexConfigState.calls).toBe(1);
		expect(goalSet?.params).toEqual({
			threadId: "thread-1",
			objective: "Finish the migration and keep tests green",
		});
		expect(
			serverState.requests.find((request) => request.method === "turn/start"),
		).toBeUndefined();
	});

	test("rejects oversized /goal objectives before opening Codex", async () => {
		const manager = new CodexAppServerManager();
		const objective = "x".repeat(MAX_CODEX_GOAL_OBJECTIVE_CHARS + 1);

		await expect(
			manager.sendMessage(
				"REQ-goal-too-long",
				{
					sessionId: "session-goal-too-long",
					prompt: `/goal ${objective}`,
					model: "gpt-5.4",
					cwd: "/tmp/workspace",
					resume: undefined,
					permissionMode: "bypassPermissions",
					effortLevel: "high",
					fastMode: false,
					images: [],
				},
				emitter,
			),
		).rejects.toThrow(
			`Codex goal objective is ${MAX_CODEX_GOAL_OBJECTIVE_CHARS + 1} characters; maximum is ${MAX_CODEX_GOAL_OBJECTIVE_CHARS}.`,
		);

		expect(codexConfigState.calls).toBe(0);
		expect(serverState.instances).toHaveLength(0);
		expect(serverState.requests).toEqual([]);
	});

	test("emits goal API failures before ending the stream", async () => {
		const manager = new CodexAppServerManager();
		const events: object[] = [];
		emitter = createSidecarEmitter((event) => events.push(event));
		serverState.goalSetError = new Error("thread/goal/set failed");

		await manager.sendMessage(
			"REQ-goal-fails",
			{
				sessionId: "session-goal-fails",
				prompt: "/goal Finish the migration",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "high",
				fastMode: false,
				images: [],
			},
			emitter,
		);

		expect(events).toEqual([
			{
				id: "REQ-goal-fails",
				type: "error",
				message: "thread/goal/set failed",
			},
			{ id: "REQ-goal-fails", type: "end" },
		]);
	});

	test("dispatches /goal resume as an active goal transition", async () => {
		const manager = new CodexAppServerManager();

		await manager.sendMessage(
			"REQ-goal-resume",
			{
				sessionId: "session-goal-resume",
				prompt: "/goal resume",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: "thread-existing",
				permissionMode: "bypassPermissions",
				effortLevel: "high",
				fastMode: false,
				images: [],
			},
			emitter,
		);

		const goalSet = serverState.requests.find(
			(request) => request.method === "thread/goal/set",
		);
		expect(goalSet?.params).toEqual({
			threadId: "thread-existing",
			status: "active",
		});
	});

	test("dedupes repeated Codex goal status notifications", async () => {
		const manager = new CodexAppServerManager();
		const events: Array<Record<string, unknown>> = [];
		const capturingEmitter = createSidecarEmitter((event) => {
			events.push(event as Record<string, unknown>);
		});
		serverState.goalStatusNotifications = [
			{
				status: "active",
				goal: { objective: "Finish the migration" },
				threadId: "thread-1",
			},
			{
				status: "active",
				goal: { objective: "Finish the migration" },
				threadId: "thread-1",
			},
		];

		await manager.sendMessage(
			"REQ-goal-dedupe",
			{
				sessionId: "session-goal-dedupe",
				prompt: "/goal Finish the migration",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "high",
				fastMode: false,
				images: [],
			},
			capturingEmitter,
		);

		const goalEvents = events.filter(
			(event) => event.type === "thread/goal/status",
		);
		expect(goalEvents).toHaveLength(2);
		expect(
			goalEvents.filter((event) => event.status === "active"),
		).toHaveLength(1);
		expect(goalEvents.filter((event) => event.status === "set")).toHaveLength(
			1,
		);
	});

	test("rejects setting a new Codex goal while one is active", async () => {
		const manager = new CodexAppServerManager();
		serverState.goalStatusNotifications = [
			{
				status: "active",
				goal: { objective: "Finish the migration" },
				threadId: "thread-1",
			},
		];

		await manager.sendMessage(
			"REQ-goal-active",
			{
				sessionId: "session-goal-active",
				prompt: "/goal Finish the migration",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "high",
				fastMode: false,
				images: [],
			},
			emitter,
		);

		serverState.requests = [];
		await expect(
			manager.sendMessage(
				"REQ-goal-rejected",
				{
					sessionId: "session-goal-active",
					prompt: "/goal Start a different goal",
					model: "gpt-5.4",
					cwd: "/tmp/workspace",
					resume: undefined,
					permissionMode: "bypassPermissions",
					effortLevel: "high",
					fastMode: false,
					images: [],
				},
				emitter,
			),
		).rejects.toThrow("A Codex goal is already active for this thread");
		expect(
			serverState.requests.find(
				(request) => request.method === "thread/goal/set",
			),
		).toBeUndefined();
	});

	test("allows setting a new Codex goal after the previous goal ends", async () => {
		const manager = new CodexAppServerManager();
		serverState.goalStatusNotifications = [
			{
				status: "active",
				goal: { objective: "Finish the migration" },
				threadId: "thread-1",
			},
		];

		await manager.sendMessage(
			"REQ-goal-completed",
			{
				sessionId: "session-goal-completed",
				prompt: "/goal Finish the migration",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "high",
				fastMode: false,
				images: [],
			},
			emitter,
		);

		serverState.goalStatusNotifications = [];
		serverState.beforeTurnCompleted = () => {
			serverState.onNotification?.({
				method: "thread/goal/status",
				params: {
					status: "completed",
					goal: { objective: "Finish the migration" },
					threadId: "thread-1",
				},
			});
		};
		await manager.sendMessage(
			"REQ-goal-finished-turn",
			{
				sessionId: "session-goal-completed",
				prompt: "ack",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "high",
				fastMode: false,
				images: [],
			},
			emitter,
		);

		serverState.requests = [];
		serverState.beforeTurnCompleted = null;
		serverState.goalStatusNotifications = [];
		await manager.sendMessage(
			"REQ-goal-next",
			{
				sessionId: "session-goal-completed",
				prompt: "/goal Start the next goal",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "high",
				fastMode: false,
				images: [],
			},
			emitter,
		);

		expect(
			serverState.requests.find(
				(request) => request.method === "thread/goal/set",
			),
		).toBeDefined();
	});

	test("recycles idle Codex context before /goal", async () => {
		const manager = new CodexAppServerManager();

		await manager.sendMessage(
			"REQ-first",
			{
				sessionId: "session-recycle",
				prompt: "hello",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "high",
				fastMode: false,
				images: [],
			},
			emitter,
		);
		const firstInstance = serverState.instances[0];
		serverState.requests = [];

		await manager.sendMessage(
			"REQ-goal-recycle",
			{
				sessionId: "session-recycle",
				prompt: "/goal Continue from here",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "high",
				fastMode: false,
				images: [],
			},
			emitter,
		);

		expect(firstInstance?.killed).toBe(true);
		expect(serverState.instances).toHaveLength(2);
		expect(serverState.requests).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					method: "thread/resume",
					params: expect.objectContaining({ threadId: "thread-1" }),
				}),
				expect.objectContaining({ method: "thread/goal/set" }),
			]),
		);
	});

	test("plan mode with additionalDirectories sets sandboxPolicy writableRoots including cwd", async () => {
		const manager = new CodexAppServerManager();
		gitAccessState.directories = ["/git/worktree-meta", "/git/common"];

		await manager.sendMessage(
			"REQ-plan-writable",
			{
				sessionId: "session-plan",
				prompt: "hi",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "plan",
				effortLevel: "medium",
				fastMode: false,
				images: [],
				// Include cwd explicitly to verify dedupe, and a duplicate
				// `/tmp/a` to verify we keep the first occurrence only.
				additionalDirectories: ["/tmp/workspace", "/tmp/a", "/tmp/a", "/tmp/b"],
			},
			emitter,
		);

		const turnStart = serverState.requests.find(
			(request) => request.method === "turn/start",
		);

		expect(turnStart?.params).toEqual(
			expect.objectContaining({
				sandboxPolicy: {
					type: "workspaceWrite",
					writableRoots: [
						"/tmp/workspace",
						"/tmp/a",
						"/tmp/b",
						"/git/worktree-meta",
						"/git/common",
					],
					networkAccess: false,
				},
			}),
		);
	});

	test("plan mode without additionalDirectories sets sandboxPolicy for cwd", async () => {
		const manager = new CodexAppServerManager();

		await manager.sendMessage(
			"REQ-plan-noextras",
			{
				sessionId: "session-plan-noextras",
				prompt: "hi",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "plan",
				effortLevel: "medium",
				fastMode: false,
				images: [],
			},
			emitter,
		);

		const turnStart = serverState.requests.find(
			(request) => request.method === "turn/start",
		);

		expect(turnStart?.params).toEqual(
			expect.objectContaining({
				sandboxPolicy: {
					type: "workspaceWrite",
					writableRoots: ["/tmp/workspace"],
					networkAccess: false,
				},
			}),
		);
	});

	test("non-plan modes restore dangerFullAccess sandboxPolicy", async () => {
		const manager = new CodexAppServerManager();

		await manager.sendMessage(
			"REQ-bypass-noop",
			{
				sessionId: "session-bypass",
				prompt: "hi",
				model: "gpt-5.4",
				cwd: "/tmp",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "medium",
				fastMode: false,
				images: [],
				additionalDirectories: ["/tmp/a"],
			},
			emitter,
		);

		const turnStart = serverState.requests.find(
			(request) => request.method === "turn/start",
		);

		expect(turnStart?.params).toEqual(
			expect.objectContaining({
				sandboxPolicy: {
					type: "dangerFullAccess",
				},
			}),
		);
	});

	test("prepends a linked-directories preamble to the turn input", async () => {
		const manager = new CodexAppServerManager();

		await manager.sendMessage(
			"REQ-preamble",
			{
				sessionId: "session-preamble",
				prompt: "summarize what's in these projects",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "medium",
				fastMode: false,
				images: [],
				additionalDirectories: ["/abs/alpha", "/abs/bravo"],
			},
			emitter,
		);

		const turnStart = serverState.requests.find(
			(request) => request.method === "turn/start",
		);
		const input = (turnStart?.params as { input?: Array<{ text?: string }> })
			?.input;
		const firstText = input?.[0]?.text ?? "";
		// Preamble references the linked paths, and the original user prompt
		// is still in there (after the preamble).
		expect(firstText).toContain("/abs/alpha");
		expect(firstText).toContain("/abs/bravo");
		expect(firstText).toContain("summarize what's in these projects");
	});

	test("does not touch the user prompt when no directories are linked", async () => {
		const manager = new CodexAppServerManager();

		await manager.sendMessage(
			"REQ-no-preamble",
			{
				sessionId: "session-no-preamble",
				prompt: "hello",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "bypassPermissions",
				effortLevel: "medium",
				fastMode: false,
				images: [],
			},
			emitter,
		);

		const turnStart = serverState.requests.find(
			(request) => request.method === "turn/start",
		);
		const input = (turnStart?.params as { input?: Array<{ text?: string }> })
			?.input;
		expect(input?.[0]?.text).toBe("hello");
	});

	test("includes resolved git access directories in the linked-directories preamble", async () => {
		const manager = new CodexAppServerManager();
		gitAccessState.directories = ["/git/worktree-meta", "/git/common"];

		await manager.sendMessage(
			"REQ-git-preamble",
			{
				sessionId: "session-git-preamble",
				prompt: "check repo state",
				model: "gpt-5.4",
				cwd: "/tmp/workspace",
				resume: undefined,
				permissionMode: "plan",
				effortLevel: "medium",
				fastMode: false,
				images: [],
			},
			emitter,
		);

		const turnStart = serverState.requests.find(
			(request) => request.method === "turn/start",
		);
		const input = (turnStart?.params as { input?: Array<{ text?: string }> })
			?.input;
		const firstText = input?.[0]?.text ?? "";

		expect(firstText).toContain("/git/worktree-meta");
		expect(firstText).toContain("/git/common");
		expect(firstText).toContain("check repo state");
	});

	test("normalizes thread/tokenUsage/updated into contextUsageUpdated emit", async () => {
		const manager = new CodexAppServerManager();
		const events: Array<Record<string, unknown>> = [];
		const capturingEmitter = createSidecarEmitter((event) => {
			events.push(event as Record<string, unknown>);
		});

		serverState.beforeTurnCompleted = () => {
			serverState.onNotification?.({
				method: "thread/tokenUsage/updated",
				params: {
					tokenUsage: {
						total: { totalTokens: 35_000 },
						last: { totalTokens: 17_500 },
						modelContextWindow: 400_000,
					},
				},
			});
		};

		await manager.sendMessage(
			"REQ-usage",
			{
				sessionId: "session-codex-usage",
				prompt: "hi",
				model: "gpt-5.4",
				cwd: "/tmp",
				resume: undefined,
				permissionMode: undefined,
				effortLevel: "medium",
				fastMode: false,
				images: [],
			},
			capturingEmitter,
		);

		// `last.totalTokens` (not `total.totalTokens`) is the numerator; max
		// is `modelContextWindow`; percentage is rounded to 2 decimals.
		const ctxUsage = events.find((e) => e.type === "contextUsageUpdated");
		expect(ctxUsage).toBeDefined();
		expect(ctxUsage?.sessionId).toBe("session-codex-usage");
		expect(ctxUsage?.id).toBe("REQ-usage");
		const meta = JSON.parse(ctxUsage?.meta as string);
		expect(meta).toEqual({
			// Stamped from the sendMessage param, not the notification.
			modelId: "gpt-5.4",
			usedTokens: 17_500,
			maxTokens: 400_000,
			percentage: 4.38,
		});
	});

	test("does not terminate stream for Codex reconnect progress notices", async () => {
		const manager = new CodexAppServerManager();
		const events: Array<Record<string, unknown>> = [];
		const capturingEmitter = createSidecarEmitter((event) => {
			events.push(event as Record<string, unknown>);
		});

		serverState.beforeTurnCompleted = () => {
			serverState.onNotification?.({
				method: "error",
				params: { error: { message: "Reconnecting... 1/5" } },
			});
			serverState.onNotification?.({
				method: "item/agentMessage/delta",
				params: {
					threadId: "thread-1",
					turnId: "turn-1",
					itemId: "msg-1",
					delta: "still streaming",
				},
			});
		};

		await manager.sendMessage(
			"REQ-reconnect",
			{
				sessionId: "session-reconnect",
				prompt: "hi",
				model: "gpt-5.4",
				cwd: "/tmp",
				resume: undefined,
				permissionMode: undefined,
				effortLevel: "medium",
				fastMode: false,
				images: [],
			},
			capturingEmitter,
		);

		expect(events.map((event) => event.type)).toEqual(
			expect.arrayContaining(["item/agentMessage/delta", "end"]),
		);
		expect(events.find((event) => event.type === "error")).toBeUndefined();
		expect(events.at(-1)?.type).toBe("end");
	});

	test("skips contextUsageUpdated emit when tokenUsage payload is empty", async () => {
		const manager = new CodexAppServerManager();
		const events: Array<Record<string, unknown>> = [];
		const capturingEmitter = createSidecarEmitter((event) => {
			events.push(event as Record<string, unknown>);
		});

		// Zero tokens AND zero window — nothing meaningful to persist.
		serverState.beforeTurnCompleted = () => {
			serverState.onNotification?.({
				method: "thread/tokenUsage/updated",
				params: {
					tokenUsage: {
						last: { totalTokens: 0 },
						total: { totalTokens: 0 },
					},
				},
			});
		};

		await manager.sendMessage(
			"REQ-empty",
			{
				sessionId: "session-empty",
				prompt: "hi",
				model: "gpt-5.4",
				cwd: "/tmp",
				resume: undefined,
				permissionMode: undefined,
				effortLevel: "medium",
				fastMode: false,
				images: [],
			},
			capturingEmitter,
		);

		expect(
			events.find((e) => e.type === "contextUsageUpdated"),
		).toBeUndefined();
	});

	test("suppresses app-server errors when protocol says Codex will retry", async () => {
		const manager = new CodexAppServerManager();
		const events: Array<Record<string, unknown>> = [];
		const capturingEmitter = createSidecarEmitter((event) => {
			events.push(event as Record<string, unknown>);
		});

		serverState.beforeTurnCompleted = () => {
			serverState.onNotification?.({
				method: "error",
				params: {
					error: { message: "stream interrupted" },
					willRetry: true,
					threadId: "thread-1",
					turnId: "turn-1",
				},
			});
		};

		await manager.sendMessage(
			"REQ-retryable-error",
			{
				sessionId: "session-retryable-error",
				prompt: "hi",
				model: "gpt-5.4",
				cwd: "/tmp",
				resume: undefined,
				permissionMode: undefined,
				effortLevel: "medium",
				fastMode: false,
				images: [],
			},
			capturingEmitter,
		);

		expect(events.find((e) => e.type === "error")).toBeUndefined();
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "REQ-retryable-error",
					type: "heartbeat",
				}),
			]),
		);
	});

	test("emits app-server errors when protocol says Codex will not retry", async () => {
		const manager = new CodexAppServerManager();
		const events: Array<Record<string, unknown>> = [];
		const capturingEmitter = createSidecarEmitter((event) => {
			events.push(event as Record<string, unknown>);
		});

		serverState.beforeTurnCompleted = () => {
			serverState.onNotification?.({
				method: "error",
				params: {
					error: { message: "fatal app-server failure" },
					willRetry: false,
					threadId: "thread-1",
					turnId: "turn-1",
				},
			});
		};

		await manager.sendMessage(
			"REQ-terminal-error",
			{
				sessionId: "session-terminal-error",
				prompt: "hi",
				model: "gpt-5.4",
				cwd: "/tmp",
				resume: undefined,
				permissionMode: undefined,
				effortLevel: "medium",
				fastMode: false,
				images: [],
			},
			capturingEmitter,
		);

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "REQ-terminal-error",
					type: "error",
					message: "fatal app-server failure",
				}),
			]),
		);
	});
});
