import type { DebugIngestStatus } from "@/lib/api";

const DEBUG_MODE_PROMPT_PREFIX = `[DEBUG MODE ACTIVE]
Use a debugging workflow for this turn.
- Start from evidence: reproduce the issue or inspect available logs, stack traces, test output, browser console/network output, and local app logs before editing when feasible.
- Form a concrete hypothesis before changing code, make the smallest fix that explains the evidence, then rerun the relevant check.
- Keep the visible reply concise: summarize the observed failure, the fix, and the verification.`;

function buildIngestInstructions(status: DebugIngestStatus): string | null {
	const ingestUrl = status.ingestUrl?.trim();
	if (!status.running || !ingestUrl) return null;
	return `[DEBUG INGEST SERVER]
A Helmor workspace-scoped localhost debug ingest server is available for this turn.
- POST JSON evidence to ${ingestUrl} with a JSON object body, for example: {"level":"info","source":"agent","message":"observed failure","details":{}}.
- GET ${ingestUrl} to read the current buffered evidence before drawing conclusions.
- DELETE ${ingestUrl} to clear stale evidence when it would confuse the investigation.
- Do not try to stop this server; start/stop is owned by the Helmor UI/backend.
- Use provider-neutral shell commands such as curl when helpful; keep these ingest mechanics out of the visible user-facing answer unless directly relevant.`;
}

export function buildDebugPromptPrefix(
	enabled: boolean,
	ingestStatus?: DebugIngestStatus | null,
): string | null {
	if (!enabled) return null;
	return [
		DEBUG_MODE_PROMPT_PREFIX,
		ingestStatus ? buildIngestInstructions(ingestStatus) : null,
	]
		.filter(Boolean)
		.join("\n\n");
}
