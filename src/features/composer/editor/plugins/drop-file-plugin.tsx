/**
 * Lexical plugin: handle file drag-and-drop via Tauri's webview drag-drop event.
 *
 * Uses `getCurrentWebview().onDragDropEvent()` (the correct Tauri v2 API) rather
 * than the global `listen()`, because drag-drop events are emitted to the specific
 * webview target and are not received by a global `{ kind: 'Any' }` listener.
 *
 * Inserts dropped files into the editor:
 * - Image files → ImageBadgeNode
 * - Other files  → FileBadgeNode
 *
 * Also blocks the native browser DROP_COMMAND to prevent duplicate insertion.
 *
 * Calls `onDragStateChange(true/false)` on drag-enter / drag-leave / drop so the
 * parent can show a visual drop-zone overlay.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_CRITICAL, DROP_COMMAND } from "lexical";
import { useEffect, useRef } from "react";
import { $insertFilePaths } from "../../editor-ops";

/** Dedup window (ms) — ignore identical drops within this period. */
const DROP_DEDUP_MS = 500;

export function DropFilePlugin({
	onDragStateChange,
}: {
	onDragStateChange?: (isDragging: boolean) => void;
} = {}) {
	const [editor] = useLexicalComposerContext();
	const unlistenRef = useRef<(() => void) | null>(null);
	const cancelledRef = useRef(false);
	const lastDropRef = useRef<{ key: string; ts: number }>({ key: "", ts: 0 });
	// Keep a stable ref so the Tauri callback never captures a stale closure.
	const dragStateChangeRef = useRef(onDragStateChange);
	useEffect(() => {
		dragStateChangeRef.current = onDragStateChange;
	});

	useEffect(() => {
		cancelledRef.current = false;

		// Block native browser drop so PlainTextPlugin doesn't also insert content.
		const unregisterDrop = editor.registerCommand(
			DROP_COMMAND,
			(event) => {
				event.preventDefault();
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		);

		// Clean up any stale Tauri listener from a previous effect run.
		unlistenRef.current?.();
		unlistenRef.current = null;

		import("@tauri-apps/api/webview")
			.then(({ getCurrentWebview }) => {
				if (cancelledRef.current) return undefined;

				return getCurrentWebview().onDragDropEvent((event) => {
					const payload = event.payload;

					if (payload.type === "enter") {
						dragStateChangeRef.current?.(true);
						return;
					}

					if (payload.type === "leave") {
						dragStateChangeRef.current?.(false);
						return;
					}

					if (payload.type !== "drop") return;

					// Drop complete — clear the drag state regardless of whether we
					// insert anything (user may have dropped outside the composer).
					dragStateChangeRef.current?.(false);

					const paths = payload.paths;
					if (!paths?.length) return;

					// Dedup: ignore identical path sets within DROP_DEDUP_MS.
					const key = paths.join("|");
					const now = Date.now();
					if (
						key === lastDropRef.current.key &&
						now - lastDropRef.current.ts < DROP_DEDUP_MS
					) {
						return;
					}
					lastDropRef.current = { key, ts: now };

					editor.update(() => {
						$insertFilePaths(paths);
					});
				});
			})
			.then((fn) => {
				if (!fn) return;
				if (cancelledRef.current) {
					fn(); // effect already cleaned up — immediately unlisten
				} else {
					unlistenRef.current = fn;
				}
			})
			.catch(() => {
				// Not in Tauri environment — silently no-op.
			});

		return () => {
			cancelledRef.current = true;
			unregisterDrop();
			unlistenRef.current?.();
			unlistenRef.current = null;
		};
	}, [editor]);

	return null;
}
