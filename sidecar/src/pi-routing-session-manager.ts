import type { SidecarEmitter } from "./emitter.js";
import { GoalPiSupervisorManager } from "./goal-pi-supervisor-manager.js";
import { PiSessionManager } from "./pi-session-manager.js";
import type {
	GenerateTitleOptions,
	ListSlashCommandsParams,
	ProviderModelInfo,
	SendMessageParams,
	SessionManager,
	SlashCommandInfo,
} from "./session-manager.js";

export class PiRoutingSessionManager implements SessionManager {
	readonly regular = new PiSessionManager();
	readonly goals = new GoalPiSupervisorManager();

	async sendMessage(
		requestId: string,
		params: SendMessageParams,
		emitter: SidecarEmitter,
	): Promise<void> {
		if (params.kanbanWorkspaceId) {
			await this.goals.sendMessage(requestId, params, emitter);
			return;
		}
		await this.regular.sendMessage(requestId, params, emitter);
	}

	generateTitle(
		requestId: string,
		userMessage: string,
		branchRenamePrompt: string | null,
		emitter: SidecarEmitter,
		timeoutMs?: number,
		options?: GenerateTitleOptions,
	): Promise<void> {
		return this.regular.generateTitle(
			requestId,
			userMessage,
			branchRenamePrompt,
			emitter,
			timeoutMs,
			options,
		);
	}

	listSlashCommands(
		params: ListSlashCommandsParams,
	): Promise<readonly SlashCommandInfo[]> {
		return this.regular.listSlashCommands(params);
	}

	listModels(): Promise<readonly ProviderModelInfo[]> {
		return this.regular.listModels();
	}

	async stopSession(sessionId: string): Promise<void> {
		if (await this.goals.stopSession(sessionId)) return;
		await this.regular.stopSession(sessionId);
	}

	async steer(
		sessionId: string,
		prompt: string,
		files: readonly string[],
		images: readonly string[],
	): Promise<boolean> {
		if (await this.goals.steer(sessionId, prompt, files, images)) return true;
		return this.regular.steer(sessionId, prompt, files, images);
	}

	async shutdown(): Promise<void> {
		await Promise.all([this.goals.shutdown(), this.regular.shutdown()]);
	}

	resolveKanbanToolCall(
		toolCallId: string,
		result: unknown,
		isError: boolean,
	): void {
		if (this.goals.resolveKanbanToolCall(toolCallId, result, isError)) return;
		this.regular.resolveKanbanToolCall(toolCallId, result, isError);
	}
}
