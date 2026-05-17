import type { DebugIngestStatus } from "@/lib/api";

const DEBUG_MODE_PROMPT_PREFIX = `[DEBUG MODE ACTIVE]
Use a debugging workflow for this turn.
- Start from evidence: reproduce the issue or inspect available logs, stack traces, test output, browser console/network output, and local app logs before editing when feasible.
- Form a concrete hypothesis before changing code, make the smallest fix that explains the evidence, then rerun the relevant check.
- Keep the visible reply concise: summarize the observed failure, the fix, and the verification.`;

const RUNTIME_PROBE_EXAMPLES = `Useful temporary probes can cover frontend timing, console errors, unhandled rejections, component init/mount ordering, network or IPC call start/end/failure, state transitions, resize/layout measurements, and user-flow checkpoints. For terminal renderer work specifically, include renderer selection, dynamic import/init, constructor/open, fit timings, first dimensions, onReady, fallback timer, spawn args including cols/rows, resize events, and throttled fit calls.`;

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
- GET ${ingestUrl} before making claims so you know what evidence is already buffered.
- DELETE ${ingestUrl} to clear stale evidence when it would confuse this investigation.
- When runtime evidence would help, add focused temporary instrumentation around the suspected hot path before making a perf/reliability claim; for frontend probes, prefer importing postDebugEvidence from "@/lib/debug-evidence" and calling it with this ingest URL.
- After adding probes, give the user concrete testing instructions and stop; the user will prompt again after they have run the dev app or reproduced the target flow. On the follow-up, GET ${ingestUrl} again and base conclusions on the captured ordering, timings, errors, dimensions, and state transitions.
- Include enough fields to trace the source, such as {"level":"error","source":"browser","message":"uncaught exception","details":{}}; avoid secrets, tokens, prompt contents, full env dumps, or large payloads.
- ${RUNTIME_PROBE_EXAMPLES}
- Remove temporary instrumentation before finishing unless the user explicitly wants it kept.
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
