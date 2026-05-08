/**
 * Permission requests and deferred-tool requests are two different streaming
 * signals, but visually they're the same thing: "the agent wants to run a
 * tool; user must approve." To avoid maintaining two UI surfaces, we adapt
 * `PendingPermission` into a `PendingDeferredTool` so the composer can
 * render a single shared panel (`GenericDeferredToolPanel`) for both.
 *
 * The adapted object carries the permission id inside `toolUseId` with a
 * reserved prefix; the composer's response handler then uses the helpers
 * below to route the callback back to the correct backend API.
 */

import type { PendingPermission } from "./hooks/use-streaming";
import type { PendingDeferredTool } from "./pending-deferred-tool";

const PERMISSION_TOOL_USE_PREFIX = "permission:" as const;

export function adaptPermissionToDeferredTool(
	permission: PendingPermission,
): PendingDeferredTool {
	return {
		// These fields are required by the PendingDeferredTool type but are
		// unused by the panel UI — it only reads toolName, toolInput, and
		// toolUseId. Backend-bound fields (provider / modelId / ...) are
		// placeholders because the response is routed through the permission
		// API, not the deferred-tool API.
		provider: "claude",
		modelId: "",
		resolvedModel: "",
		providerSessionId: null,
		workingDirectory: "",
		permissionMode: null,
		toolUseId: `${PERMISSION_TOOL_USE_PREFIX}${permission.permissionId}`,
		toolName: permission.toolName,
		toolInput: permission.toolInput,
	};
}

export function isAdaptedPermissionToolUseId(toolUseId: string): boolean {
	return toolUseId.startsWith(PERMISSION_TOOL_USE_PREFIX);
}

export function permissionIdFromAdaptedToolUseId(
	toolUseId: string,
): string | null {
	if (!isAdaptedPermissionToolUseId(toolUseId)) {
		return null;
	}
	return toolUseId.slice(PERMISSION_TOOL_USE_PREFIX.length);
}
