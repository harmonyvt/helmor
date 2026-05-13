import type { DebugIngestStatus } from "@/lib/api";

const DEBUG_MODE_PROMPT_PREFIX = `[DEBUG MODE ACTIVE]
Use a debugging workflow for this turn.
- Start from evidence: reproduce the issue or inspect available logs, stack traces, test output, browser console/network output, and local app logs before editing when feasible.
- Form a concrete hypothesis before changing code, make the smallest fix that explains the evidence, then rerun the relevant check.
- Keep the visible reply concise: summarize the observed failure, the fix, and the verification.`;

function buildIngestInstructions(status: DebugIngestStatus): string | null {
	const localIngestUrl = status.ingestUrl?.trim();
	const publicIngestUrl = status.publicIngestUrl?.trim();
	const ingestUrl = publicIngestUrl || localIngestUrl;
	if (!status.running || !ingestUrl) return null;
	const publicNote = publicIngestUrl
		? `\n- This is a public ${status.tunnelProvider ?? "tunnel"} URL forwarded to Helmor; use it for remote preview deployments such as Vercel/Netlify that cannot reach localhost.`
		: status.tunnelError
			? "\n- A public ngrok tunnel was requested but failed to start; localhost ingest is still available from this machine only."
			: "";
	const localNote =
		publicIngestUrl && localIngestUrl
			? `\n- Local-only fallback from this machine: ${localIngestUrl}.`
			: "";
	return `[DEBUG INGEST SERVER]
A Helmor workspace-scoped debug ingest endpoint is available for this turn.${publicNote}${localNote}
- POST JSON evidence to ${ingestUrl} with a JSON object body, for example: {"level":"info","source":"agent","message":"observed failure","details":{}}.
- When runtime evidence would help, create temporary instrumentation that points back to this ingest endpoint (for example browser console/error hooks, app log shims, test probes, or backend request/error logging) and have it POST compact JSON evidence to ${ingestUrl}.
- Include enough fields to trace the source, such as {"level":"error","source":"browser","message":"uncaught exception","details":{}}; avoid secrets, tokens, full env dumps, or large payloads.
- GET ${ingestUrl} to read the current buffered evidence before drawing conclusions.
- DELETE ${ingestUrl} to clear stale evidence when it would confuse the investigation.
- Remove or clearly mark temporary instrumentation before finishing unless the user explicitly wants it kept.
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
