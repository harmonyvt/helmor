import { randomUUID } from "node:crypto";
import type {
	AgentSession,
	ExtensionError,
	ExtensionUIContext,
} from "@mariozechner/pi-coding-agent";
import type { SidecarEmitter } from "./emitter.js";

type CardSeverity = "info" | "warning" | "error";

// ---------------------------------------------------------------------------
// Pending interactive UI calls — interactionId → { resolve, reject }
// ---------------------------------------------------------------------------

interface PendingUiInteraction {
	resolve: (result: unknown) => void;
	reject: (err: Error) => void;
}

const pendingUiInteractions = new Map<string, PendingUiInteraction>();

/**
 * Called by the sidecar stdin handler when `piUiResponse` arrives from the
 * frontend. Resolves the corresponding pending `uiContext.select/confirm/input`
 * call inside the Pi extension.
 */
export function resolvePiUiInteraction(
	interactionId: string,
	result: unknown,
): void {
	const pending = pendingUiInteractions.get(interactionId);
	if (!pending) return;
	pendingUiInteractions.delete(interactionId);
	pending.resolve(result);
}

export async function bindPiExtensionsForHelmor(
	session: AgentSession,
	emitter: SidecarEmitter,
	requestId: string,
	onCard?: () => void,
): Promise<void> {
	const host = new PiExtensionHost(emitter, requestId, onCard);
	await session.bindExtensions({
		uiContext: host.uiContext,
		onError: host.onError,
		commandContextActions: {
			waitForIdle: async () => undefined,
			newSession: async () => unsupportedSessionAction(),
			fork: async () => unsupportedSessionAction(),
			navigateTree: async () => unsupportedSessionAction(),
			switchSession: async () => unsupportedSessionAction(),
			reload: async () => session.reload(),
		},
	});
}

function unsupportedSessionAction(): { cancelled: boolean } {
	return { cancelled: true };
}

class PiExtensionHost {
	private sequence = 0;

	constructor(
		private readonly emitter: SidecarEmitter,
		private readonly requestId: string,
		private readonly onCard: (() => void) | undefined,
	) {}

	readonly onError = (error: ExtensionError): void => {
		this.emitCard({
			title: "Pi extension error",
			subtitle: error.extensionPath,
			severity: "error",
			body: `${error.event}: ${error.error}`,
			details: error,
		});
	};

	readonly uiContext: ExtensionUIContext = {
		// -----------------------------------------------------------------------
		// Interactive — emit a piUiRequest and await the frontend's response.
		// -----------------------------------------------------------------------
		select: async (title, options) => {
			return this.awaitUiInteraction("select", { title, options }) as Promise<
				string | undefined
			>;
		},
		confirm: async (title, message) => {
			const result = await this.awaitUiInteraction("confirm", {
				title,
				message,
			});
			return result === true || result === "true";
		},
		input: async (title, placeholder) => {
			return this.awaitUiInteraction("input", {
				title,
				placeholder,
			}) as Promise<string | undefined>;
		},

		// -----------------------------------------------------------------------
		// Notifications — emit info cards; no round-trip needed.
		// -----------------------------------------------------------------------
		notify: (message, type = "info") => {
			this.emitCard({
				title: "Pi extension notification",
				severity: type,
				body: message,
			});
		},
		setStatus: (key, text) => {
			this.emitCard({
				title: "Pi extension status",
				subtitle: key,
				body: text ?? "Cleared",
			});
		},
		setWorkingMessage: (message) => {
			if (message) {
				this.emitCard({ title: "Pi working message", body: message });
			}
		},
		setTitle: (title) => {
			this.emitCard({ title: "Pi extension title", body: title });
		},

		// -----------------------------------------------------------------------
		// Unsupported — emit a warning card and return a safe fallback.
		// -----------------------------------------------------------------------
		editor: async (title, prefill) => {
			this.emitUnsupported(title, "editor", { prefill });
			return undefined;
		},
		custom: async (_factory, options) => {
			this.emitUnsupported("Custom Pi extension UI", "custom", {
				overlay: options?.overlay ?? false,
			});
			return undefined as never;
		},
		pasteToEditor: (text) => {
			this.emitUnsupported("Paste into editor", "pasteToEditor", { text });
		},
		setEditorText: (text) => {
			this.emitUnsupported("Set editor text", "setEditorText", { text });
		},
		getEditorText: () => "",
		onTerminalInput: () => () => undefined,
		setWorkingVisible: () => undefined,
		setWorkingIndicator: () => undefined,
		setHiddenThinkingLabel: () => undefined,
		setWidget: () => undefined,
		setFooter: () => undefined,
		setHeader: () => undefined,
		addAutocompleteProvider: () => undefined,
		setEditorComponent: () => undefined,
		getEditorComponent: () => undefined,
		get theme() {
			return undefined as unknown as ExtensionUIContext["theme"];
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({
			success: false,
			error: "Theme switching is not available in Helmor yet",
		}),
		getToolsExpanded: () => false,
		setToolsExpanded: () => undefined,
	};

	// -------------------------------------------------------------------------
	// Internal helpers
	// -------------------------------------------------------------------------

	private awaitUiInteraction(
		kind: "select",
		payload: { title?: string; options: string[] },
	): Promise<unknown>;
	private awaitUiInteraction(
		kind: "confirm",
		payload: { title?: string; message?: string },
	): Promise<unknown>;
	private awaitUiInteraction(
		kind: "input",
		payload: { title?: string; placeholder?: string },
	): Promise<unknown>;
	private awaitUiInteraction(
		kind: "select" | "confirm" | "input",
		payload: Record<string, unknown>,
	): Promise<unknown> {
		const interactionId = randomUUID();
		const promise = new Promise<unknown>((resolve, reject) => {
			pendingUiInteractions.set(interactionId, { resolve, reject });
		});
		// Cast through `never` to satisfy the discriminated overloads — the three
		// caller overloads above ensure each kind/payload pair is valid at call
		// sites; the internal union dispatch is intentionally broader.
		(
			this.emitter.piUiRequest as (
				r: string,
				i: string,
				k: "select" | "confirm" | "input",
				p: Record<string, unknown>,
			) => void
		)(this.requestId, interactionId, kind, payload);
		return promise;
	}

	private emitUnsupported(
		title: string,
		action: string,
		details?: Record<string, unknown>,
	): void {
		this.emitCard({
			title,
			subtitle: "Pi extension UI not available in Helmor yet",
			severity: "warning",
			body: `Unsupported Pi UI action: ${action}`,
			details: { action, ...details },
		});
	}

	private emitCard(input: {
		readonly title: string;
		readonly subtitle?: string;
		readonly severity?: CardSeverity;
		readonly body?: string;
		readonly details?: unknown;
	}): void {
		this.sequence += 1;
		this.onCard?.();
		this.emitter.passthrough(this.requestId, {
			type: "item/completed",
			item: {
				id: `pi-extension-${Date.now()}-${this.sequence}`,
				type: "generic_card",
				provider: "pi",
				title: input.title,
				subtitle: input.subtitle,
				severity: input.severity ?? "info",
				body: input.body,
				details: input.details,
			},
		});
	}
}
