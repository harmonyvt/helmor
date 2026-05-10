/**
 * Realtime feature — barrel export.
 *
 * The primary public surface is `RealtimeContainer`, which manages its own
 * state and renders both the sidebar dock row and the floating panel portal.
 *
 * Sub-components (dock, panel states, primitives) are exported for use in
 * settings panels and other surfaces that need to reference them individually.
 */

export { AzureRealtimeIcon } from "@/components/icons";
export { RealtimeContainer } from "./container";
export { RealtimeDock } from "./dock";
export { RealtimePanelActionPreview } from "./panel/action-preview";
export { RealtimePanelExecuting } from "./panel/executing";
// Panel states (used individually in settings/tour surfaces)
export { RealtimePanelIdle } from "./panel/idle";
export { RealtimePanelListening } from "./panel/listening";
export { RealtimePanelModelPick } from "./panel/model-pick";
export { RealtimePanelSidecar } from "./panel/sidecar";
export { RealtimePanelWorkspacePick } from "./panel/workspace-pick";

// Primitives (used in other provider surfaces)
export {
	ActionLine,
	FootBtn,
	Kbd,
	RTGlyph,
	Tline,
	Waveform,
} from "./primitives";

// Types
export type {
	ActionEntry,
	ModelOption,
	RealtimeState,
	Speaker,
	TlineEntry,
	ToolResult,
	WorkspaceMatch,
} from "./types";
