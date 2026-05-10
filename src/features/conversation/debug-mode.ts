const DEBUG_MODE_PROMPT_PREFIX = `[DEBUG MODE ACTIVE]
Use a debugging workflow for this turn.
- Start from evidence: reproduce the issue or inspect available logs, stack traces, test output, browser console/network output, and local app logs before editing when feasible.
- If a localhost log-ingest or debug bridge is available, use that runtime evidence; if not, ask for the missing log source or create the smallest local reproduction.
- Form a concrete hypothesis before changing code, make the smallest fix that explains the evidence, then rerun the relevant check.
- Keep the visible reply concise: summarize the observed failure, the fix, and the verification.`;

export function buildDebugPromptPrefix(enabled: boolean): string | null {
	return enabled ? DEBUG_MODE_PROMPT_PREFIX : null;
}
