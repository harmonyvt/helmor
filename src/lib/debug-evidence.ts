export type DebugEvidencePayload = {
	level?: "info" | "warn" | "error";
	source: string;
	message: string;
	details?: Record<string, unknown>;
	timestamp?: string;
};

export function postDebugEvidence(
	ingestUrl: string | null | undefined,
	payload: DebugEvidencePayload,
) {
	if (!import.meta.env.DEV) return;
	const url = ingestUrl?.trim();
	if (!url) return;

	const { level = "info", timestamp, ...rest } = payload;
	const body = {
		timestamp: timestamp ?? new Date().toISOString(),
		level,
		...rest,
	};

	void fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	}).catch(() => {});
}
