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
	agent = { state: { errorMessage: undefined as string | undefined } };

	subscribe(listener: (event: unknown) => void) {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((item) => item !== listener);
		};
	}

	async prompt() {}

	async bindExtensions() {}

	async reload() {}

	dispose() {}
}

mock.module("@mariozechner/pi-coding-agent", () => ({
	AuthStorage: MockAuthStorage,
	DefaultResourceLoader: MockDefaultResourceLoader,
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

describe("PiSessionManager.listModels", () => {
	beforeEach(() => {
		registryState.models = [];
		registryState.error = undefined;
		registryState.bootstrapped = false;
		sessionState.createdSession = undefined;
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

	test("normalizes Pi model metadata from the registry", async () => {
		registryState.models = [
			{
				id: "pi:azure-openai-responses/gpt-5.5",
				name: "",
				provider: "",
				reasoning: false,
			},
		];

		const models = await new PiSessionManager().listModels();

		expect(models).toEqual([
			{
				id: "pi:azure-openai-responses/gpt-5.5",
				label: "Pi · gpt-5.5",
				cliModel: "azure-openai-responses/gpt-5.5",
				providerKey: "azure-openai-responses",
				effortLevels: [],
				supportsFastMode: true,
			},
		]);
	});

	test("deduplicates models whose raw ids normalize to the same output id", async () => {
		registryState.models = [
			{
				id: "openrouter/auto",
				name: "Auto",
				provider: "openrouter",
				reasoning: false,
			},
			// "pi:openrouter/auto" normalizes to the same output id as "openrouter/auto"
			{
				id: "pi:openrouter/auto",
				name: "Auto (duplicate)",
				provider: "openrouter",
				reasoning: false,
			},
		];

		const models = await new PiSessionManager().listModels();

		expect(models).toHaveLength(1);
		expect(models[0]?.id).toBe("pi:openrouter/auto");
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
