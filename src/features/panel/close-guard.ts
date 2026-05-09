import type { WorkspaceSessionSummary } from "@/lib/api";

export function shouldConfirmRunningSessionClose(
	session: WorkspaceSessionSummary,
	sendingSessionIds?: Set<string>,
): boolean {
	return (
		sendingSessionIds?.has(session.id) === true ||
		session.status === "pending" ||
		session.status === "streaming_input" ||
		session.status === "running"
	);
}
