type ChannelHandler<T> = ((event: T) => void) | null;

type InvokeEnvelope<T> =
	| { ok: true; data: T }
	| { ok: false; error?: { message?: string } };

const configuredApiBase = import.meta.env.VITE_HELMOR_WEB_API_BASE?.replace(
	/\/$/,
	"",
);
const configuredApiPort = import.meta.env.VITE_HELMOR_WEB_API_PORT;
const apiBase = configuredApiBase ?? apiBaseFromLocation(configuredApiPort);

function apiBaseFromLocation(port?: string): string {
	if (!port) return "";
	if (typeof window === "undefined") return `http://127.0.0.1:${port}`;
	return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

export class Channel<T = unknown> {
	onmessage: ChannelHandler<T> = null;

	toJSON(): string {
		return "__HELMOR_WEB_CHANNEL__";
	}
}

export async function invoke<T = unknown>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	if (command === "send_agent_message_stream") {
		await startAgentStream(
			args as { request?: unknown; onEvent?: Channel<unknown> },
		);
		return undefined as T;
	}
	if (command === "subscribe_ui_mutations") {
		subscribeUiMutations((args as { onEvent?: Channel<unknown> })?.onEvent);
		return undefined as T;
	}

	const response = await fetch(`${apiBase}/api/invoke/${command}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(args ?? {}),
	});
	const envelope = (await response
		.json()
		.catch(() => null)) as InvokeEnvelope<T> | null;
	if (!response.ok || !envelope?.ok) {
		throw new Error(
			envelope && !envelope.ok
				? envelope.error?.message || `Helmor web command failed: ${command}`
				: `Helmor web command failed: ${command}`,
		);
	}
	return envelope.data;
}

export function convertFileSrc(path: string): string {
	return `${apiBase}/api/asset?path=${encodeURIComponent(path)}`;
}

async function startAgentStream(args?: {
	request?: unknown;
	onEvent?: Channel<unknown>;
}): Promise<void> {
	const response = await fetch(`${apiBase}/api/streams/agent`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ request: args?.request }),
	});
	if (!response.ok || !response.body) {
		throw new Error(`Unable to start Helmor web stream (${response.status})`);
	}
	void pumpSse(response, (event) => args?.onEvent?.onmessage?.(event));
}

function subscribeUiMutations(channel?: Channel<unknown>): void {
	const source = new EventSource(`${apiBase}/api/events/ui`);
	source.addEventListener("ui", (event) => {
		channel?.onmessage?.(JSON.parse((event as MessageEvent).data));
	});
	source.onerror = () => {
		// Keep EventSource's built-in reconnect behavior; no user-visible action.
	};
}

async function pumpSse(
	response: Response,
	onEvent: (event: unknown) => void,
): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) return;
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let separator = buffer.indexOf("\n\n");
		while (separator >= 0) {
			const chunk = buffer.slice(0, separator);
			buffer = buffer.slice(separator + 2);
			handleSseChunk(chunk, onEvent);
			separator = buffer.indexOf("\n\n");
		}
	}
	if (buffer.trim()) handleSseChunk(buffer, onEvent);
}

function handleSseChunk(
	chunk: string,
	onEvent: (event: unknown) => void,
): void {
	const data = chunk
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trimStart())
		.join("\n");
	if (!data) return;
	try {
		onEvent(JSON.parse(data));
	} catch {
		// Ignore malformed keep-alive/comment chunks.
	}
}
