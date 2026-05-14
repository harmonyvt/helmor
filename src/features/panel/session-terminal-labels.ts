import type { WorkspaceSessionSummary } from "@/lib/api";

const GENERATED_TITLE_PREFIXES = [
	"Claude · ",
	"Codex · ",
	"OpenCode · ",
	"Pi · ",
	"Shell · ",
];

const GENERATED_TITLES = new Set([
	"Untitled",
	"Terminal",
	"Agent Terminal",
	"Claude Terminal",
	"Codex Terminal",
	"OpenCode Terminal",
	"Pi Terminal",
	"Shell Terminal",
]);

export function terminalRuntimeLabel(value?: string | null): string {
	const normalized = normalizeTerminalRuntime(value);
	switch (normalized) {
		case "claude":
			return "Claude";
		case "codex":
			return "Codex";
		case "opencode":
			return "OpenCode";
		case "pi":
			return "Pi";
		case "shell":
			return "Shell";
		default:
			return value?.trim() || "Shell";
	}
}

export function terminalModeLabel(
	session: Pick<WorkspaceSessionSummary, "surfaceMode">,
) {
	return session.surfaceMode === "agent_terminal"
		? "Agent Terminal"
		: "Terminal";
}

export function terminalDefaultTitle(
	session: Pick<
		WorkspaceSessionSummary,
		"surfaceMode" | "terminalRuntime" | "agentType"
	>,
): string {
	const runtime = session.terminalRuntime ?? session.agentType ?? "shell";
	return `${terminalRuntimeLabel(runtime)} Terminal`;
}

export function shouldAutoUpdateTerminalTitle(title?: string | null): boolean {
	const normalized = title?.trim();
	if (!normalized) return true;
	if (GENERATED_TITLES.has(normalized)) return true;
	return GENERATED_TITLE_PREFIXES.some((prefix) =>
		normalized.startsWith(prefix),
	);
}

export function formatLiveTerminalTitle(
	session: Pick<
		WorkspaceSessionSummary,
		"surfaceMode" | "terminalRuntime" | "agentType"
	>,
	terminalTitle?: string | null,
): string {
	const fallback = terminalDefaultTitle(session);
	const cleaned = sanitizeTerminalTitle(terminalTitle);
	if (!cleaned) return fallback;
	const label = terminalRuntimeLabel(
		session.terminalRuntime ?? session.agentType,
	);
	return label === "Shell" ? cleaned : `${label} · ${cleaned}`;
}

function normalizeTerminalRuntime(value?: string | null): string {
	const normalized =
		value
			?.trim()
			.toLowerCase()
			.replace(/[\s_-]+/g, "") ?? "";
	if (!normalized) return "shell";
	if (normalized === "openai" || normalized === "openaicodex") return "codex";
	return normalized;
}

function sanitizeTerminalTitle(value?: string | null): string | null {
	const cleaned = value
		?.split("")
		.map((char) => {
			const code = char.charCodeAt(0);
			return code < 32 || code === 127 ? " " : char;
		})
		.join("")
		.replace(/\s+/g, " ")
		.trim();
	if (!cleaned) return null;
	return cleaned.length > 80 ? `${cleaned.slice(0, 77).trimEnd()}…` : cleaned;
}
