export type WorkspaceRow = {
	id: string;
	title: string;
	repoName?: string | null;
	directoryName?: string | null;
	status?: string | null;
	activeSessionId?: string | null;
	hasUnread?: boolean;
};

export type WorkspaceGroup = {
	id: string;
	label: string;
	tone: string;
	rows: WorkspaceRow[];
};

export type WorkspaceSession = {
	id: string;
	workspaceId: string;
	title: string;
	status: string;
	model?: string | null;
	agentType?: string | null;
	active: boolean;
	updatedAt: string;
};

export type MessagePart = {
	type: string;
	id?: string;
	text?: string;
	label?: string;
	body?: string;
	summary?: string;
	toolName?: string;
	tool_name?: string;
	children?: MessagePart[];
	tools?: MessagePart[];
	[key: string]: unknown;
};

export type ThreadMessage = {
	id?: string;
	role: "assistant" | "system" | "user" | "error";
	createdAt?: string;
	content: MessagePart[];
	streaming?: boolean;
};

export type SendResult = {
	sessionId: string;
	provider: string;
	model: string;
	persisted: boolean;
};

export type AgentStreamEvent =
	| { kind: "update"; messages: ThreadMessage[] }
	| { kind: "streamingPartial"; message: ThreadMessage }
	| { kind: "done"; [key: string]: unknown }
	| { kind: "aborted"; [key: string]: unknown }
	| { kind: "permissionRequest"; [key: string]: unknown }
	| { kind: "deferredToolUse"; [key: string]: unknown }
	| { kind: "elicitationRequest"; [key: string]: unknown }
	| { kind: "planCaptured"; [key: string]: unknown }
	| { kind: "error"; message: string; [key: string]: unknown };

export type ServerEvent =
	| { kind: "uiMutation"; event?: { type: string } }
	| { kind: "agentStream"; event: AgentStreamEvent }
	| { kind: "heartbeat" }
	| { kind: string; event?: unknown };

const TOKEN_KEY = "helmor.mobile.token";

export function loadToken() {
	return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function saveToken(token: string) {
	localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
	localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T>(
	token: string,
	path: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(path, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});
	if (!response.ok) {
		const body = await response.json().catch(() => null);
		throw new Error(
			body?.error
				? String(body.error)
				: `${response.status} ${response.statusText}`,
		);
	}
	return response.json() as Promise<T>;
}

export const api = {
	bootstrap: (token: string) =>
		apiFetch<{ app: string }>(token, "/api/bootstrap"),
	workspaces: (token: string) =>
		apiFetch<WorkspaceGroup[]>(token, "/api/workspaces"),
	sessions: (token: string, workspaceId: string) =>
		apiFetch<WorkspaceSession[]>(
			token,
			`/api/workspaces/${workspaceId}/sessions`,
		),
	messages: (token: string, sessionId: string) =>
		apiFetch<ThreadMessage[]>(token, `/api/sessions/${sessionId}/messages`),
	send: (
		token: string,
		sessionId: string,
		input: { workspaceId: string; prompt: string; modelId?: string | null },
	) =>
		apiFetch<SendResult>(token, `/api/sessions/${sessionId}/send`, {
			method: "POST",
			body: JSON.stringify(input),
		}),
	stop: (token: string, sessionId: string) =>
		apiFetch<{ ok: true }>(token, `/api/sessions/${sessionId}/stop`, {
			method: "POST",
			body: "{}",
		}),
	respondInteraction: (
		token: string,
		interactionId: string,
		input:
			| { kind: "permission"; behavior: "allow" | "deny"; message?: string }
			| {
					kind: "deferredTool";
					behavior: "allow" | "deny";
					reason?: string;
			  }
			| {
					kind: "elicitation";
					action: "accept" | "decline" | "cancel";
					content?: Record<string, unknown> | null;
			  },
	) =>
		apiFetch<{ ok: true }>(
			token,
			`/api/interactions/${interactionId}/respond`,
			{
				method: "POST",
				body: JSON.stringify(input),
			},
		),
};

export async function openEventStream(
	token: string,
	onEvent: (event: ServerEvent) => void,
	signal: AbortSignal,
) {
	const response = await fetch("/events", {
		headers: { Authorization: `Bearer ${token}` },
		signal,
	});
	if (!response.ok || !response.body) {
		throw new Error(`${response.status} ${response.statusText}`);
	}

	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";
	while (!signal.aborted) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += value;
		let boundary = buffer.indexOf("\n\n");
		while (boundary !== -1) {
			const raw = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			const dataLine = raw
				.split("\n")
				.find((line) => line.startsWith("data: "));
			if (dataLine) {
				try {
					onEvent(JSON.parse(dataLine.slice(6)));
				} catch {
					// Ignore malformed keepalive chunks.
				}
			}
			boundary = buffer.indexOf("\n\n");
		}
	}
}
