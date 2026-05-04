import type {
	AgentSession,
	ExtensionError,
	ExtensionUIContext,
} from "@mariozechner/pi-coding-agent";
import type { SidecarEmitter } from "./emitter.js";

type CardSeverity = "info" | "warning" | "error";

export async function bindPiExtensionsForHelmor(
	session: AgentSession,
	emitter: SidecarEmitter,
	requestId: string,
): Promise<void> {
	const host = new PiExtensionHost(emitter, requestId);
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
		select: async (title, options) => {
			this.emitUnsupported(title, "select", { options });
			return undefined;
		},
		confirm: async (title, message) => {
			this.emitUnsupported(title, "confirm", { message });
			return false;
		},
		input: async (title, placeholder) => {
			this.emitUnsupported(title, "input", { placeholder });
			return undefined;
		},
		notify: (message, type = "info") => {
			this.emitCard({
				title: "Pi extension notification",
				severity: type,
				body: message,
			});
		},
		onTerminalInput: () => () => undefined,
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
		setWorkingVisible: () => undefined,
		setWorkingIndicator: () => undefined,
		setHiddenThinkingLabel: () => undefined,
		setWidget: () => undefined,
		setFooter: () => undefined,
		setHeader: () => undefined,
		setTitle: (title) => {
			this.emitCard({ title: "Pi extension title", body: title });
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
		editor: async (title, prefill) => {
			this.emitUnsupported(title, "editor", { prefill });
			return undefined;
		},
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
