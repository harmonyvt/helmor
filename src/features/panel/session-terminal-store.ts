import {
	resizeSessionTerminal,
	type ScriptEvent,
	spawnSessionTerminal,
	stopSessionTerminal,
	writeSessionTerminalStdin,
} from "@/lib/api";

export type SessionTerminalStatus = "new" | "running" | "exited";

export type SessionTerminalState = {
	chunks: string[];
	bufferedBytes: number;
	truncated: boolean;
	status: SessionTerminalStatus;
	exitCode: number | null;
	started: boolean;
};

type Listener = {
	onChunk: (data: string) => void;
	onStatusChange: (
		status: SessionTerminalStatus,
		exitCode: number | null,
	) => void;
};

const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
export const SESSION_TERMINAL_TRUNCATION_NOTICE =
	"\r\n\x1b[2m… earlier output truncated (buffer limit reached) …\x1b[0m\r\n";

const states = new Map<string, SessionTerminalState>();
const listeners = new Map<string, Listener>();
const startPromises = new Map<string, Promise<void>>();

function appendChunk(state: SessionTerminalState, data: string) {
	state.chunks.push(data);
	state.bufferedBytes += data.length;
	while (state.bufferedBytes > MAX_CHUNK_BYTES && state.chunks.length > 1) {
		const dropped = state.chunks.shift();
		if (dropped === undefined) break;
		state.bufferedBytes -= dropped.length;
		state.truncated = true;
	}
}

function ensureState(sessionId: string): SessionTerminalState {
	let state = states.get(sessionId);
	if (!state) {
		state = {
			chunks: [],
			bufferedBytes: 0,
			truncated: false,
			status: "new",
			exitCode: null,
			started: false,
		};
		states.set(sessionId, state);
	}
	return state;
}

export function attachSessionTerminal(
	sessionId: string,
	listener: Listener,
): SessionTerminalState {
	listeners.set(sessionId, listener);
	return ensureState(sessionId);
}

export function detachSessionTerminal(sessionId: string) {
	listeners.delete(sessionId);
}

export function startSessionTerminal(
	repoId: string,
	workspaceId: string,
	sessionId: string,
	runtime: string | null,
	initialSize?: { cols: number; rows: number } | null,
) {
	const state = ensureState(sessionId);
	if (state.started) return startPromises.get(sessionId) ?? Promise.resolve();
	state.started = true;
	state.status = "running";
	const promise = spawnSessionTerminal(
		repoId,
		workspaceId,
		sessionId,
		runtime,
		(event: ScriptEvent) => {
			const current = ensureState(sessionId);
			switch (event.type) {
				case "started":
					current.status = "running";
					listeners.get(sessionId)?.onStatusChange("running", null);
					break;
				case "stdout":
				case "stderr":
					appendChunk(current, event.data);
					listeners.get(sessionId)?.onChunk(event.data);
					break;
				case "exited": {
					current.status = "exited";
					current.exitCode = event.code;
					const tail = `\r\n\x1b[2m[Process exited with code ${
						event.code ?? "?"
					}]\x1b[0m\r\n`;
					appendChunk(current, tail);
					listeners.get(sessionId)?.onChunk(tail);
					listeners.get(sessionId)?.onStatusChange("exited", event.code);
					break;
				}
				case "error": {
					const msg = `\r\n\x1b[31m${event.message}\x1b[0m\r\n`;
					appendChunk(current, msg);
					current.status = "exited";
					current.exitCode = current.exitCode ?? 1;
					listeners.get(sessionId)?.onChunk(msg);
					listeners.get(sessionId)?.onStatusChange("exited", current.exitCode);
					break;
				}
			}
		},
		initialSize,
	).catch((err) => {
		const current = ensureState(sessionId);
		const msg = `\r\n\x1b[31mFailed to start terminal: ${err}\x1b[0m\r\n`;
		appendChunk(current, msg);
		current.status = "exited";
		current.exitCode = 1;
		listeners.get(sessionId)?.onChunk(msg);
		listeners.get(sessionId)?.onStatusChange("exited", 1);
	});
	startPromises.set(sessionId, promise);
	return promise;
}

export function stopSessionTerminalProcess(
	repoId: string,
	workspaceId: string,
	sessionId: string,
) {
	void stopSessionTerminal(repoId, workspaceId, sessionId);
}

export function writeSessionTerminal(
	repoId: string,
	workspaceId: string,
	sessionId: string,
	data: string,
) {
	void writeSessionTerminalStdin(repoId, workspaceId, sessionId, data);
}

export function resizeSessionTerminalProcess(
	repoId: string,
	workspaceId: string,
	sessionId: string,
	cols: number,
	rows: number,
) {
	void resizeSessionTerminal(repoId, workspaceId, sessionId, cols, rows);
}

export function _resetSessionTerminalStoreForTesting() {
	states.clear();
	listeners.clear();
	startPromises.clear();
}
