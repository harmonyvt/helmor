import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRegistry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { bootstrapGoalSupervisorAuth } from "./auth.js";
import { writeGoalSupervisorContext } from "./context.js";
import { resolvePiModel } from "./model.js";
import { createGoalSupervisorTools } from "./tools.js";
import type {
	CreateGoalSupervisorTurnOptions,
	GoalSupervisorModelInfo,
	GoalSupervisorTurn,
	ThinkingLevel,
} from "./types.js";

export type {
	CreateGoalSupervisorTurnOptions,
	GoalSupervisorModelInfo,
	GoalSupervisorParams,
	GoalSupervisorToolBridge,
	GoalSupervisorToolCall,
	GoalSupervisorTurn,
	PiImageContent,
} from "./types.js";

export async function createGoalSupervisorTurn(
	options: CreateGoalSupervisorTurnOptions,
): Promise<GoalSupervisorTurn> {
	return Effect.runPromise(
		Effect.tryPromise({
			try: () => createGoalSupervisorTurnUnsafe(options),
			catch: (error) => error,
		}),
	);
}

export async function listGoalSupervisorModels(): Promise<
	readonly GoalSupervisorModelInfo[]
> {
	return Effect.runPromise(
		Effect.tryPromise({
			try: async () => {
				const authStorage = AuthStorage.create();
				bootstrapGoalSupervisorAuth(authStorage);
				const modelRegistry = ModelRegistry.create(authStorage);
				return modelRegistry
					.getAvailable()
					.sort((left, right) => {
						const providerDelta = left.provider.localeCompare(right.provider);
						return providerDelta || left.id.localeCompare(right.id);
					})
					.map((model) => ({
						id: `pi:${model.provider}/${model.id}`,
						label: `Pi · ${model.name}`,
						cliModel: `${model.provider}/${model.id}`,
						providerKey: model.provider,
					}));
			},
			catch: (error) => error,
		}),
	);
}

async function createGoalSupervisorTurnUnsafe(
	options: CreateGoalSupervisorTurnOptions,
): Promise<GoalSupervisorTurn> {
	const startedAt = Date.now();
	const cwd = options.params.cwd || process.cwd();
	await writeGoalSupervisorContext(cwd, options.params.kanbanSnapshot, {
		title: options.params.goalTitle,
		description: options.params.goalDescription,
	});

	const authStorage = AuthStorage.create();
	const authBootstrap = bootstrapGoalSupervisorAuth(authStorage);
	const modelRegistry = ModelRegistry.create(authStorage);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
	});
	const resourceStartedAt = Date.now();
	await resourceLoader.reload();
	options.logger?.info?.("Goal Pi supervisor runtime loaded", {
		requestId: options.requestId,
		cwd,
		agentDir: getAgentDir(),
		authAnthropic: authBootstrap.anthropic,
		authOpenAICodex: authBootstrap.openaiCodex,
		resourceLoadMs: Date.now() - resourceStartedAt,
		totalElapsedMs: Date.now() - startedAt,
	});

	const sessionManager = buildSessionManager(options.params.resume, cwd);
	const providerSessionId =
		sessionManager.getSessionFile() ?? sessionManager.getSessionId();
	const model = resolvePiModel(modelRegistry, options.params.model);
	const tools = toolsForPermissionMode(options.params.permissionMode);
	const customTools = createGoalSupervisorTools(
		options.params.kanbanWorkspaceId,
		options.bridge,
		{
			assignedProvider: "pi",
			assignedEffortLevel: options.params.effortLevel ?? null,
		},
	);

	const sessionStartedAt = Date.now();
	const { session } = await createAgentSession({
		cwd,
		authStorage,
		modelRegistry,
		resourceLoader,
		sessionManager,
		model,
		thinkingLevel: normalizeThinkingLevel(options.params.effortLevel),
		tools,
		noTools:
			tools === undefined && options.params.permissionMode === "plan"
				? "builtin"
				: undefined,
		customTools,
	});
	const unsubscribe = session.subscribe(options.onEvent);
	options.logger?.debug?.("Goal Pi supervisor session created", {
		requestId: options.requestId,
		providerSessionId,
		elapsedMs: Date.now() - sessionStartedAt,
		totalElapsedMs: Date.now() - startedAt,
		toolMode: tools ? "readonly" : "default",
		customToolCount: customTools.length,
	});

	return {
		providerSessionId,
		session,
		prompt: (text) =>
			session.prompt(
				applyPermissionModePrompt(text, options.params.permissionMode),
				{
					images: options.images ? [...options.images] : undefined,
					source: "interactive",
				},
			),
		steer: (text, images) =>
			session.steer(text, images ? [...images] : undefined),
		abort: () => session.abort(),
		dispose: () => {
			unsubscribe();
			session.dispose();
		},
	};
}

function buildSessionManager(resume: string | undefined, cwd: string) {
	if (resume) {
		try {
			return SessionManager.open(resume, undefined, cwd);
		} catch {
			// Fall through to a new session when the persisted Pi session cannot be opened.
		}
	}
	return SessionManager.create(cwd);
}

function normalizeThinkingLevel(
	level: string | undefined,
): ThinkingLevel | undefined {
	if (
		level === "minimal" ||
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
