import type {
	AgentSession,
	AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

export type PiImageContent = {
	readonly type: "image";
	readonly data: string;
	readonly mimeType: string;
};

export type GoalSupervisorParams = {
	readonly sessionId: string;
	readonly prompt: string;
	readonly model?: string;
	readonly cwd?: string;
	readonly resume?: string;
	readonly permissionMode?: string;
	readonly effortLevel?: string;
	readonly additionalDirectories?: readonly string[];
	readonly kanbanWorkspaceId: string;
	readonly kanbanSnapshot?: string;
	readonly goalTitle?: string;
	readonly goalDescription?: string;
};

export type GoalSupervisorToolCall = {
	readonly toolCallId: string;
	readonly tool: string;
	readonly workspaceId: string;
	readonly args: Record<string, unknown>;
};

export type GoalSupervisorToolBridge = {
	readonly callTool: (call: GoalSupervisorToolCall) => Promise<unknown>;
};

export type GoalSupervisorLogger = {
	readonly debug?: (message: string, meta?: Record<string, unknown>) => void;
	readonly info?: (message: string, meta?: Record<string, unknown>) => void;
	readonly error?: (message: string, meta?: Record<string, unknown>) => void;
};

export type CreateGoalSupervisorTurnOptions = {
	readonly requestId: string;
	readonly params: GoalSupervisorParams;
	readonly bridge: GoalSupervisorToolBridge;
	readonly images?: readonly PiImageContent[];
	readonly onEvent: (event: AgentSessionEvent) => void;
	readonly logger?: GoalSupervisorLogger;
};

export type GoalSupervisorTurn = {
	readonly providerSessionId: string;
	readonly session: AgentSession;
	readonly prompt: (text: string) => Promise<void>;
	readonly steer: (
		text: string,
		images?: readonly PiImageContent[],
	) => Promise<void>;
	readonly abort: () => Promise<void>;
	readonly dispose: () => void;
};

export type GoalSupervisorModelInfo = {
	readonly id: string;
	readonly label: string;
	readonly cliModel: string;
	readonly providerKey?: string;
	readonly effortLevels?: readonly string[];
};
