/**
 * Utility for building a conversation-history prefix string that is injected
 * into the first user message sent to the new provider after a mid-thread
 * provider swap. The prefix rides as `promptPrefix` — Rust stitches it onto
 * the wire payload only, so it never appears in the chat bubble or the DB.
 */

import type { AgentProvider, ThreadMessageLike } from "@/lib/api";

const PROVIDER_LABELS: Record<AgentProvider, string> = {
	claude: "Claude",
	codex: "OpenAI Codex",
};

/**
 * Extract the plain-text content from a single thread message. Returns an
 * empty string for messages whose parts carry no readable text (e.g.
 * pure-tool-call turns).
 */
function extractMessageText(message: ThreadMessageLike): string {
	const parts: string[] = [];
	for (const part of message.content) {
		if (part.type === "text" && part.text.trim()) {
			parts.push(part.text.trim());
		} else if (part.type === "collapsed-group") {
			// Summarise collapsed tool groups as a brief note rather than
			// omitting them entirely — gives the receiving model awareness
			// that work was done without flooding it with tool details.
			parts.push(`[${part.summary}]`);
		}
	}
	return parts.join("\n");
}

/**
 * Build the context-transfer preamble that is prepended (via `promptPrefix`)
 * to the first user message in the new provider's session.
 *
 * Only user and assistant turns are included. System notices, error messages,
 * and turns with no extractable text are silently omitted. The transcript is
 * capped at `maxTurns` (most-recent) to avoid blowing the context window of
 * smaller models.
 */
export function buildContextTransferPrefix(
	messages: ThreadMessageLike[],
	fromProvider: AgentProvider,
	maxTurns = 40,
): string {
	const fromLabel = PROVIDER_LABELS[fromProvider] ?? fromProvider;

	// Gather user + assistant turns in chronological order.
	const turns: { role: "User" | "Assistant"; text: string }[] = [];
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") {
			continue;
		}
		const text = extractMessageText(message);
		if (!text) continue;
		turns.push({
			role: message.role === "user" ? "User" : "Assistant",
			text,
		});
	}

	if (turns.length === 0) {
		return "";
	}

	// Keep only the most recent N turns to avoid context overflow.
	const kept = turns.length > maxTurns ? turns.slice(-maxTurns) : turns;
	const truncated = turns.length > maxTurns;

	const lines: string[] = [
		`The following is a conversation history transferred from ${fromLabel}.`,
		`Please use this context to continue assisting the user.`,
		"",
		"--- Transferred Conversation ---",
		...(truncated
			? [
					`[Note: ${turns.length - maxTurns} earlier turn(s) omitted for brevity]`,
					"",
				]
			: []),
	];

	for (const turn of kept) {
		lines.push(`${turn.role}:`, turn.text, "");
	}

	lines.push("--- End of Transferred Conversation ---");

	return lines.join("\n");
}
