/**
 * Realtime session state — drives which panel view is rendered.
 * "idle" means no active session (dock is closed or open but disconnected).
 */
export type RealtimeState =
	| "idle"
	| "listening"
	| "action-preview"
	| "executing"
	| "workspace-pick"
	| "model-pick"
	| "sidecar";

/** Who is currently speaking — drives --rt-speaker-color and waveform tint */
export type Speaker = "user" | "agent";

/** A single line of the real-time transcript */
export interface TlineEntry {
	who: "you" | "rt";
	text: string;
	/** True while the streamed text is still arriving */
	partial?: boolean;
	/** Optional timestamp string, e.g. "0:12" */
	time?: string;
}

/** A queued agentic action shown in the action-preview panel */
export interface ActionEntry {
	/** 1-based index */
	n: number;
	/** Short verb label, e.g. "run", "edit", "open" */
	verb: string;
	/** Human-readable detail line */
	detail: string;
}

/** A tool execution result shown in the executing panel */
export interface ToolResult {
	label: string;
	/** True → done (✓), false → in progress (pulsing dot) */
	done: boolean;
	/** Optional short chip / output snippet */
	chip?: string;
}

/** A ranked workspace match shown in the workspace-pick panel */
export interface WorkspaceMatch {
	id: string;
	name: string;
	branch: string;
	/** 1-3 — mapped to keyboard shortcut */
	rank: 1 | 2 | 3;
}

/** A model option shown in the model-pick panel */
export interface ModelOption {
	id: string;
	label: string;
	provider: string;
	/** Currently selected */
	chosen?: boolean;
	/** Marked as user default */
	isDefault?: boolean;
}
