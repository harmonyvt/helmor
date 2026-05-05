import { beforeEach, describe, expect, mock, test } from "bun:test";

const registryState = {
	models: [] as Array<{
		id: string;
		name: string;
		provider: string;
		reasoning: boolean;
	}>,
	error: undefined as string | undefined,
	bootstrapped: false,
};

const sessionState = {
	createdSession: undefined as MockAgentSession | undefined,
	promptBlocker: undefined as Promise<void> | undefined,
};

const MockAuthStorage = {
	create: () => ({}),
};

class MockModelRegistry {
	static create(_authStorage: unknown): MockModelRegistry {
		return new MockModelRegistry();
	}

	getError(): string | undefined {
		return registryState.error;
	}

	getAvailable() {
		return [...registryState.models];
	}

	find(provider: string, id: string) {
		return (
			registryState.models.find(
				(model) => model.provider === provider && model.id === id,
			) ?? registryState.models[0]
		);
	}
}

class MockSessionManager {
	static create() {
		return new MockSessionManager();
	}

	static open() {
		return new MockSessionManager();
	}

	static inMemory() {
		return new MockSessionManager();
	}

	getSessionFile() {
		return undefined;
	}

	getSessionId() {
		return "provider-session-1";
	}
}

class MockDefaultResourceLoader {
	async reload() {}
}

class MockAgentSession {
	listeners: Array<(event: unknown) => void> = [];
	steerCalls: Array<{ text: string; images: unknown }> = [];
	abortCalls = 0;
	disposed = false;
	agent = { state: { errorMessage: undefined as string | undefined } };

	subscribe(listener: (event: unknown) => void) {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener);
		};
	}

	async prompt() {
		await sessionState.promptBlocker;
	}

	async steer(text: string, images: unknown) {
		if (text.startsWith("/bad")) {
			throw new Error("extension command rejected");
		}
		this.steerCalls.push({ text, images });
	}

	async bindExtensions() {}

	async reload() {}

	async abort() {
		this.abortCalls += 1;
	}

	dispose() {
		this.disposed = true;
	}
}

mock.module("@mariozechner/pi-coding-agent", () => ({
	AuthStorage: MockAuthStorage,
	DefaultResourceLoader: MockDefaultResourceLoader,
	defineTool: (tool: unknown) => tool,
	getAgentDir: () => "/tmp/pi-agent",
	ModelRegistry: MockModelRegistry,
	SessionManager: MockSessionManager,
	createAgentSession: async () => {
		const session = new MockAgentSession();
		sessionState.createdSession = session;
		return { session };
	},
}));

mock.module("../src/pi-auth-bootstrap.js", () => ({
	bootstrapPiAuth: () => {
		registryState.bootstrapped = true;
		return { anthropic: true, openaiCodex: true };
	},
}));

const { PiSessionManager, normalizePiSlashCommands } = await import(
	"../src/pi-session-manager.js"
);

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("condition not met");
}

describe("PiSessionManager.listModels", () => {
	beforeEach(() => {
		registryState.models = [];
		registryState.error = undefined;
		registryState.bootstrapped = false;
		sessionState.createdSession = undefined;
		sessionState.promptBlocker = undefined;
	});

	test("returns configured Pi models from the registry", async () => {
		registryState.models = [
			{
				id: "gpt-5.4",
				name: "GPT-5.4",
				provider: "azure-openai-responses",
				reasoning: true,
			},
			{
				id: "claude-sonnet-4-6",
				name: "Claude Sonnet 4.6",
				provider: "anthropic",
				reasoning: false,
			},
		];

		const models = await new PiSessionManager().listModels();

		expect(registryState.bootstrapped).toBe(true);
		expect(models).toEqual([
			{
				id: "pi:anthropic/claude-sonnet-4-6",
				label: "Pi · Claude Sonnet 4.6",
				cliModel: "anthropic/claude-sonnet-4-6",
				providerKey: "anthropic",
				effortLevels: [],
				supportsFastMode: false,
			},
			{
				id: "pi:azure-openai-responses/gpt-5.4",
				label: "Pi · GPT-5.4",
				cliModel: "azure-openai-responses/gpt-5.4",
				providerKey: "azure-openai-responses",
				effortLevels: ["low", "medium", "high", "xhigh"],
				supportsFastMode: true,
			},
		]);
	});

	test("returns an empty list when no Pi auth is configured", async () => {
		const models = await new PiSessionManager().listModels();

		expect(registryState.bootstrapped).toBe(true);
		expect(models).toEqual([]);
	});
});

describe("PiSessionManager.sendMessage", () => {
	beforeEach(() => {
		registryState.models = [];
		registryState.error = undefined;
		registryState.bootstrapped = false;
		sessionState.createdSession = undefined;
		sessionState.promptBlocker = undefined;
	});

	test("emits steer prompts in the persisted user_prompt shape after Pi accepts", async () => {
		let releasePrompt = () => {};
		sessionState.promptBlocker = new Promise<void>((resolve) => {
			releasePrompt = resolve;
		});
		const events: object[] = [];
		const manager = new PiSessionManager();
		const send = manager.sendMessage(
			"request-1",
			{
				sessionId: "session-1",
				prompt: "Hi",
				cwd: "/tmp",
				model: undefined,
				resume: undefined,
				permissionMode: undefined,
				effortLevel: undefined,
				fastMode: undefined,
				images: [],
			},
			{
				passthrough: (_requestId: string, event: object) => events.push(event),
				end: (requestId: string) => events.push({ id: requestId, type: "end" }),
				error: (requestId: string, message: string, internal?: boolean) =>
					events.push({ id: requestId, type: "error", message, internal }),
				aborted: (requestId: string, reason: string) =>
					events.push({ id: requestId, type: "aborted", reason }),
			} as never,
		);
		await waitFor(() => sessionState.createdSession !== undefined);

		await expect(
			manager.steer("session-1", "/bad command", [], []),
		).rejects.toThrow("extension command rejected");
		expect(events).not.toContainEqual(
			expect.objectContaining({ type: "user_prompt", text: "/bad command" }),
		);

		await expect(
			manager.steer("session-1", "Please adjust", ["src/App.tsx"], []),
		).resolves.toBe(true);
		expect(sessionState.createdSession?.steerCalls).toEqual([
			{ text: "Please adjust", images: [] },
		]);
		expect(events).toContainEqual({
			type: "user_prompt",
			text: "Please adjust",
			steer: true,
			files: ["src/App.tsx"],
		});

		releasePrompt();
		await send;
	});

	test("stopSession emits an aborted terminal event on the active stream", async () => {
		let releasePrompt = () => {};
		sessionState.promptBlocker = new Promise<void>((resolve) => {
			releasePrompt = resolve;
		});
		const events: object[] = [];
		const manager = new PiSessionManager();
		const send = manager.sendMessage(
			"request-1",
			{
				sessionId: "session-1",
				prompt: "Hi",
				cwd: "/tmp",
				model: undefined,
				resume: undefined,
				permissionMode: undefined,
				effortLevel: undefined,
				fastMode: undefined,
				images: [],
			},
			{
				passthrough: (_requestId: string, event: object) => events.push(event),
				end: (requestId: string) => events.push({ id: requestId, type: "end" }),
				error: (requestId: string, message: string, internal?: boolean) =>
					events.push({ id: requestId, type: "error", message, internal }),
				aborted: (requestId: string, reason: string) =>
					events.push({ id: requestId, type: "aborted", reason }),
			} as never,
		);
		await waitFor(() => sessionState.createdSession !== undefined);

		await manager.stopSession("session-1");
		expect(events).toContainEqual({
			id: "request-1",
			type: "aborted",
			reason: "user_requested",
		});
		expect(sessionState.createdSession?.abortCalls).toBe(1);
		expect(sessionState.createdSession?.disposed).toBe(true);

		releasePrompt();
		await send;
		expect(events).not.toContainEqual({ id: "request-1", type: "end" });
	});

	test("emits a visible error when Pi completes with no assistant output", async () => {
		const events: object[] = [];
		await new PiSessionManager().sendMessage(
			"request-1",
			{
				sessionId: "session-1",
				prompt: "Hi",
				cwd: "/tmp",
				model: undefined,
				resume: undefined,
				permissionMode: undefined,
				effortLevel: undefined,
				fastMode: undefined,
				images: [],
			},
			{
				passthrough: (_requestId: string, event: object) => events.push(event),
				end: (requestId: string) => events.push({ id: requestId, type: "end" }),
				error: (requestId: string, message: string, internal?: boolean) =>
					events.push({ id: requestId, type: "error", message, internal }),
				aborted: (requestId: string, reason: string) =>
					events.push({ id: requestId, type: "aborted", reason }),
			} as never,
		);

		expect(events).toContainEqual({
			type: "error",
			message: "Pi completed without returning a visible assistant message.",
		});
		expect(events).toContainEqual({ id: "request-1", type: "end" });
	});
});

describe("normalizePiSlashCommands", () => {
	test("maps executable Pi command sources and dedupes by name", () => {
		const commands = normalizePiSlashCommands([
			{
				name: "review",
				description: "Review changes",
				source: "extension",
				sourceInfo: {
					path: "/tmp/review.ts",
					source: "extension:review",
					scope: "project",
					origin: "top-level",
				},
			},
			{
				name: "deploy",
				description: "Deploy app",
				source: "prompt",
				sourceInfo: {
					path: "/tmp/deploy.md",
					source: "project",
					scope: "project",
					origin: "top-level",
				},
			},
			{
				name: "skill:pdf",
				description: "Read PDFs",
				source: "skill",
				sourceInfo: {
					path: "/tmp/pdf/SKILL.md",
					source: "user",
					scope: "user",
					origin: "top-level",
				},
			},
			{
				name: "review",
				description: "Duplicate",
				source: "prompt",
				sourceInfo: {
					path: "/tmp/review.md",
					source: "project",
					scope: "project",
					origin: "top-level",
				},
			},
		]);

		expect(commands).toEqual([
			{
				name: "review",
				description: "Review changes",
				argumentHint: undefined,
				source: "extension",
				sourceInfo: {
					path: "/tmp/review.ts",
					source: "extension:review",
					scope: "project",
					origin: "top-level",
				},
			},
			{
				name: "deploy",
				description: "Deploy app",
				argumentHint: undefined,
				source: "prompt",
				sourceInfo: {
					path: "/tmp/deploy.md",
					source: "project",
					scope: "project",
					origin: "top-level",
				},
			},
			{
				name: "skill:pdf",
				description: "Read PDFs",
				argumentHint: undefined,
				source: "skill",
				sourceInfo: {
					path: "/tmp/pdf/SKILL.md",
					source: "user",
					scope: "user",
					origin: "top-level",
				},
			},
		]);
	});
});
