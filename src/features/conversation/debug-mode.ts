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
		? `\n- This is a public ${status.tunnelProvider ?? "tunnel"} URL forwarded to Helmor; use it when the app runs in a remote deployment (Vercel/Netlify) that cannot reach localhost.`
		: status.tunnelError
			? "\n- A public ngrok tunnel was requested but failed to start; the localhost endpoint below is still reachable from this machine."
			: "";
	const localNote =
		publicIngestUrl && localIngestUrl
			? `\n- Local-only fallback: ${localIngestUrl}.`
			: "";
	return `[DEBUG INGEST SERVER]
This is a live telemetry receiver, not a place to post your own observations. The workflow is: you write probe code that POSTs here when the user triggers a flow; the user runs the app; then you GET this endpoint to read what the probes captured.${publicNote}${localNote}

Endpoint: ${ingestUrl}

Follow this order strictly:
1. Form a hypothesis first. State what you suspect is wrong and what you expect the probes to show — e.g. "component X mounts before Y finishes initializing, so I expect X's probe to fire before Y's ready event." This guides where probes go and gives you something to falsify.
2. Add focused temporary probes at exactly those points. For frontend code, import postDebugEvidence from "@/lib/debug-evidence" and call it with this ingest URL. For backend/shell paths, probe code can POST directly. Do NOT manually POST your own analysis to this endpoint.
3. Give the user concrete instructions (what to run, what to click, what flow to reproduce) and STOP. Wait for their next message.
4. On the follow-up, GET ${ingestUrl} to read the captured telemetry. Compare it against your pre-probe expectation and form a diagnosis from the actual ordering, timings, and state — not from assumptions.
5. Make the smallest fix that explains the data, then remove all probes.

Endpoint reference:
- GET ${ingestUrl} — read buffered telemetry (array of probe payloads)
- DELETE ${ingestUrl} — clear stale data before a fresh investigation
- POST is used only by your probe code at runtime, not by you directly

Probe payload shape: {"level":"info","source":"component-name","message":"what happened","details":{}}. Include enough fields to trace the source. Avoid secrets, tokens, prompt contents, full env dumps, or large payloads.
${RUNTIME_PROBE_EXAMPLES}
Remove all temporary probes before finishing unless the user explicitly asks to keep them.
Do not try to stop this server; start/stop is owned by the Helmor UI/backend.
Use provider-neutral shell commands such as curl when helpful; keep these mechanics out of the visible user-facing reply unless directly relevant.`;
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
