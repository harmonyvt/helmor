import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import {
	type IDisposable,
	type IEvent,
	Terminal as XtermTerminal,
} from "@xterm/xterm";
import { memo, useEffect, useRef, useState } from "react";
import {
	getTerminalThemeRevision,
	resolveTerminalTheme,
	type TerminalRenderer,
} from "@/components/terminal-theme";
import { useSettings } from "@/lib/settings";
import "@xterm/xterm/css/xterm.css";

type TerminalOutputProps = {
	terminalRef?: React.RefObject<TerminalHandle | null>;
	className?: string;
	detectLinks?: boolean;
	fontSize?: number;
	lineHeight?: number;
	padding?: string;
	/**
	 * Called when the user types (or pastes). The string is the raw bytes
	 * xterm would send over a real PTY — e.g. a literal `\x03` for Ctrl+C,
	 * `\x1b[A` for Up arrow. Forward this to the backend to write into the
	 * PTY master.
	 *
	 * When omitted, xterm still captures keys but they go nowhere.
	 */
	onData?: (data: string) => void;
	/**
	 * Called when the terminal's cell grid changes size (FitAddon resize,
	 * font change, etc). Forward to the backend's `TIOCSWINSZ` so
	 * interactive tools (vim, htop, less) re-layout.
	 */
	onResize?: (cols: number, rows: number) => void;
	/** Called when the PTY emits an OSC terminal title update. */
	onTitleChange?: (title: string) => void;
	/** Called once the selected renderer is mounted and ready to fit. */
	onReady?: () => void;
};

type TerminalBufferLine = {
	readonly isWrapped: boolean;
	translateToString(trimRight?: boolean): string;
};

type TerminalBuffer = {
	readonly length: number;
	getLine(y: number): TerminalBufferLine | undefined;
};

type TerminalLike = {
	readonly buffer: {
		readonly active: TerminalBuffer;
	};
	options: {
		theme?: ReturnType<typeof resolveTerminalTheme>;
	};
	open(parent: HTMLElement): void;
	write(data: string | Uint8Array, callback?: () => void): void;
	clear(): void;
	dispose(): void;
	focus(): void;
	loadAddon(addon: TerminalAddonLike): void;
	attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
	registerLinkProvider(provider: TerminalLinkProvider): IDisposable | undefined;
	onData: IEvent<string>;
	onResize: IEvent<{ cols: number; rows: number }>;
	onTitleChange: IEvent<string>;
};

type TerminalCtor = new (options: Record<string, unknown>) => TerminalLike;

type TerminalAddonLike = {
	activate?(terminal: unknown): void;
	dispose?(): void;
};

type FitAddonLike = TerminalAddonLike & {
	fit(): void;
};

type FitAddonCtor = new () => FitAddonLike;

type TerminalBackend = {
	renderer: TerminalRenderer;
	Terminal: TerminalCtor;
	FitAddon: FitAddonCtor;
};

type TerminalLink = {
	range: {
		start: { x: number; y: number };
		end: { x: number; y: number };
	};
	text: string;
	decorations?: {
		pointerCursor?: boolean;
		underline?: boolean;
	};
	activate: (event: MouseEvent, linkText?: string) => void;
};

type TerminalLinkProvider = {
	provideLinks(
		bufferLineNumber: number,
		callback: (links: TerminalLink[] | undefined) => void,
	): void;
	dispose?(): void;
};

export type TerminalHandle = {
	write: (data: string) => void;
	clear: () => void;
	dispose: () => void;
	/**
	 * Force a FitAddon re-fit. Used when the terminal becomes visible after
	 * being hidden (e.g. outer tab switch) — even though `visibility: hidden`
	 * keeps DOM dimensions intact, xterm's renderer can drop intermediate
	 * frames and benefits from one explicit fit + redraw on re-show.
	 */
	refit: () => void;
	/**
	 * Move keyboard focus into the xterm viewport so the user can start
	 * typing immediately. Used when a terminal tab is activated or when a
	 * new terminal is spawned via `+` / shortcut.
	 */
	focus: () => void;
};

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_URL_PUNCTUATION = /[),.;:!?]+$/;

function sanitizeHttpUrl(value: string): string | null {
	const trimmed = value.replace(TRAILING_URL_PUNCTUATION, "");
	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.toString();
	} catch {
		return null;
	}
}

function openHttpUrl(value: string) {
	const url = sanitizeHttpUrl(value);
	if (!url) return;
	void openUrl(url);
}

let ghosttyInitPromise: Promise<void> | null = null;

async function loadTerminalBackend(
	renderer: TerminalRenderer,
): Promise<TerminalBackend> {
	if (renderer === "libghostty") {
		const ghostty = await import("ghostty-web");
		ghosttyInitPromise ??= ghostty.init().catch((error) => {
			ghosttyInitPromise = null;
			throw error;
		});
		await ghosttyInitPromise;
		return {
			renderer,
			Terminal: ghostty.Terminal as TerminalCtor,
			FitAddon: ghostty.FitAddon as FitAddonCtor,
		};
	}

	return {
		renderer,
		Terminal: XtermTerminal as unknown as TerminalCtor,
		FitAddon: XtermFitAddon as unknown as FitAddonCtor,
	};
}

function findLineForOffset(
	lineOffsets: readonly number[],
	lineTexts: readonly string[],
	offset: number,
): number | null {
	for (let i = lineOffsets.length - 1; i >= 0; i--) {
		if (offset >= lineOffsets[i]) {
			const lineEnd = lineOffsets[i] + lineTexts[i].length;
			return offset <= lineEnd ? i : null;
		}
	}
	return null;
}

function createHttpLinkProvider(
	terminal: TerminalLike,
	renderer: TerminalRenderer,
): TerminalLinkProvider {
	const coordinateBase = renderer === "xterm" ? 1 : 0;
	return {
		provideLinks(bufferLineNumber, callback) {
			const buffer = terminal.buffer.active;
			let startLine = bufferLineNumber - coordinateBase;
			while (startLine > 0 && buffer.getLine(startLine)?.isWrapped) {
				startLine--;
			}

			let endLine = bufferLineNumber - coordinateBase;
			while (
				endLine + 1 < buffer.length &&
				buffer.getLine(endLine + 1)?.isWrapped
			) {
				endLine++;
			}

			const lineTexts: string[] = [];
			for (let y = startLine; y <= endLine; y++) {
				lineTexts.push(buffer.getLine(y)?.translateToString(false) ?? "");
			}

			const lineOffsets: number[] = [];
			let offset = 0;
			for (const lineText of lineTexts) {
				lineOffsets.push(offset);
				offset += lineText.length;
			}

			const text = lineTexts.join("");
			const links = [...text.matchAll(URL_PATTERN)]
				.map((match) => {
					const rawText = match[0];
					const url = sanitizeHttpUrl(rawText);
					if (!url || match.index === undefined) return null;

					const startOffset = match.index;
					const endOffset =
						startOffset + rawText.replace(TRAILING_URL_PUNCTUATION, "").length;
					const startRelativeLine = findLineForOffset(
						lineOffsets,
						lineTexts,
						startOffset,
					);
					const endRelativeLine = findLineForOffset(
						lineOffsets,
						lineTexts,
						Math.max(startOffset, endOffset - 1),
					);
					if (startRelativeLine === null || endRelativeLine === null) {
						return null;
					}

					return {
						range: {
							start: {
								x:
									startOffset - lineOffsets[startRelativeLine] + coordinateBase,
								y: startLine + startRelativeLine + coordinateBase,
							},
							end: {
								x: endOffset - lineOffsets[endRelativeLine] + coordinateBase,
								y: startLine + endRelativeLine + coordinateBase,
							},
						},
						text: url,
						decorations: {
							pointerCursor: true,
							underline: true,
						},
						activate: (_event: MouseEvent, linkText?: string) => {
							openHttpUrl(linkText ?? url);
						},
					};
				})
				.filter((link) => link !== null);

			callback(links.length > 0 ? links : undefined);
		},
	};
}

// Global suspend counter — callers wrap heavy animations to skip per-frame
// FitAddon reflows; final fit runs once the last release fires.
let terminalFitSuspendCount = 0;
const terminalRefitListeners = new Set<() => void>();

/** Pause FitAddon.fit() across every mounted TerminalOutput. Idempotent release. */
export function suspendTerminalFit(): () => void {
	terminalFitSuspendCount++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		terminalFitSuspendCount--;
		if (terminalFitSuspendCount === 0) {
			for (const listener of terminalRefitListeners) listener();
		}
	};
}

function useTerminalThemeRevision(enabled: boolean): string {
	const [revision, setRevision] = useState(() =>
		enabled ? getTerminalThemeRevision() : "",
	);

	useEffect(() => {
		if (!enabled) {
			setRevision("");
			return;
		}
		const syncRevision = () => setRevision(getTerminalThemeRevision());
		syncRevision();
		const observer = new MutationObserver(syncRevision);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "style"],
		});
		return () => observer.disconnect();
	}, [enabled]);

	return enabled ? revision : "";
}

// Memoized so parent re-renders (e.g. inspector width drag) don't push a
// fresh render through the heavy xterm wrapper.
function TerminalOutputImpl({
	terminalRef,
	className,
	detectLinks = false,
	fontSize = 12,
	lineHeight = 1.3,
	padding = "12px 2px 12px 12px",
	onData,
	onResize,
	onTitleChange,
	onReady,
}: TerminalOutputProps) {
	const { settings } = useSettings();
	const renderer: TerminalRenderer = settings.libghosttyEnabled
		? "libghostty"
		: "xterm";
	const terminalThemeRevision = useTerminalThemeRevision(
		renderer === "libghostty",
	);
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRuntimeRef = useRef<TerminalLike | null>(null);
	const fitRef = useRef<FitAddonLike | null>(null);
	// Refs so the terminal effect doesn't recreate on parent rerender.
	const onDataRef = useRef<typeof onData>(onData);
	const onResizeRef = useRef<typeof onResize>(onResize);
	const onTitleChangeRef = useRef<typeof onTitleChange>(onTitleChange);
	const onReadyRef = useRef<typeof onReady>(onReady);
	onDataRef.current = onData;
	onResizeRef.current = onResize;
	onTitleChangeRef.current = onTitleChange;
	onReadyRef.current = onReady;

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		let disposed = false;
		let cleanupTerminal: (() => void) | null = null;

		const shouldSuppressKey = (
			terminal: TerminalLike,
			activeRenderer: TerminalRenderer,
			event: KeyboardEvent,
		) => {
			if (event.type !== "keydown") return activeRenderer === "xterm";
			if (!event.metaKey || event.ctrlKey || event.altKey)
				return activeRenderer === "xterm";

			const key = event.key;
			// Cmd+K — clear screen + scrollback (matches Terminal.app / iTerm).
			if (key.toLowerCase() === "k") {
				terminal.clear();
				return activeRenderer === "libghostty";
			}
			// Cmd+Backspace — kill the entire input line.
			if (key === "Backspace") {
				onDataRef.current?.("\x15"); // Ctrl+U: unix-line-discard
				return activeRenderer === "libghostty";
			}
			// Cmd+← — jump cursor to start of line.
			if (key === "ArrowLeft") {
				onDataRef.current?.("\x01"); // Ctrl+A: beginning-of-line
				return activeRenderer === "libghostty";
			}
			// Cmd+→ — jump cursor to end of line.
			if (key === "ArrowRight") {
				onDataRef.current?.("\x05"); // Ctrl+E: end-of-line
				return activeRenderer === "libghostty";
			}
			return activeRenderer === "xterm";
		};

		const mount = async (requestedRenderer: TerminalRenderer) => {
			let backend = await loadTerminalBackend(requestedRenderer);
			if (disposed) return;

			const options: Record<string, unknown> = {
				convertEol: true,
				// stdin enabled — forward keystrokes via onData below.
				disableStdin: false,
				scrollback: 5000,
				fontSize,
				fontFamily: "'GeistMono', 'SF Mono', Monaco, Menlo, monospace",
				lineHeight,
				theme: resolveTerminalTheme(backend.renderer),
				cursorBlink: false,
				cursorStyle: "bar",
			};
			if (backend.renderer === "xterm") {
				options.cursorInactiveStyle = "none";
				// Option emits `ESC+<key>` so readline picks up word movement.
				options.macOptionIsMeta = true;
			}

			let fit = new backend.FitAddon();
			let terminal = new backend.Terminal(options);

			try {
				terminal.loadAddon(fit);
				terminal.open(container);
			} catch (error) {
				if (backend.renderer === "xterm") throw error;
				console.error(
					"[helmor] libghostty terminal failed to mount; falling back to xterm.js",
					error,
				);
				fit.dispose?.();
				terminal.dispose();
				backend = await loadTerminalBackend("xterm");
				fit = new backend.FitAddon();
				terminal = new backend.Terminal({
					...options,
					theme: resolveTerminalTheme("xterm"),
					cursorInactiveStyle: "none",
					macOptionIsMeta: true,
				});
				terminal.loadAddon(fit);
				terminal.open(container);
			}

			if (disposed) {
				fit.dispose?.();
				terminal.dispose();
				return;
			}

			// Translate macOS Cmd combos to readline control codes.
			terminal.attachCustomKeyEventHandler((event) =>
				shouldSuppressKey(terminal, backend.renderer, event),
			);

			const linkProvider = detectLinks
				? createHttpLinkProvider(terminal, backend.renderer)
				: null;
			const linkProviderDisposable = linkProvider
				? terminal.registerLinkProvider(linkProvider)
				: null;

			// Leading + trailing throttled fit. fit.fit() reflows scrollback
			// every call; without throttle, inspector-width drags fire it per
			// frame and stall the main thread.
			const FIT_THROTTLE_MS = 100;
			let fitTimer: number | null = null;
			let lastFitAt = 0;
			const fitNow = () => {
				lastFitAt = performance.now();
				requestAnimationFrame(() => {
					try {
						fit.fit();
					} catch {
						// Container might be detached.
					}
				});
			};
			const runFit = () => {
				if (fitTimer !== null) {
					window.clearTimeout(fitTimer);
					fitTimer = null;
				}
				const elapsed = performance.now() - lastFitAt;
				if (elapsed >= FIT_THROTTLE_MS) {
					fitNow();
				} else {
					fitTimer = window.setTimeout(() => {
						fitTimer = null;
						fitNow();
					}, FIT_THROTTLE_MS - elapsed);
				}
			};

			// Every keystroke / paste flows through here. The terminal renderer
			// has already done the key → byte translation (e.g. Ctrl+C →
			// `\x03`), we just forward whatever it produced.
			const dataSub = terminal.onData((data) => {
				onDataRef.current?.(data);
			});

			// Fired after FitAddon changes the grid, font size changes, etc.
			// Forward to the backend PTY for TIOCSWINSZ.
			const resizeSub = terminal.onResize(({ cols, rows }) => {
				onResizeRef.current?.(cols, rows);
			});

			const titleSub = terminal.onTitleChange((title) => {
				onTitleChangeRef.current?.(title);
			});

			const resizeObserver = new ResizeObserver((entries) => {
				// A caller is animating an ancestor — skip the per-frame reflow and
				// rely on `refitListener` below to fit once when the animation ends.
				if (terminalFitSuspendCount > 0) return;
				// Skip while the container is collapsed to 0×0 (e.g. parent in
				// `display: none` state during a tab transition). Calling
				// FitAddon.fit() at zero size can truncate internal buffer
				// dimensions and the next visible frame renders empty until input
				// arrives.
				const entry = entries[0];
				if (
					entry &&
					(entry.contentRect.width === 0 || entry.contentRect.height === 0)
				) {
					return;
				}
				runFit();
			});
			resizeObserver.observe(container);

			// Fired when the last outstanding `suspendTerminalFit()` release runs.
			const refitListener = () => runFit();
			terminalRefitListeners.add(refitListener);

			// Re-resolve CSS variables when app light/dark mode changes. The
			// libghostty renderer is remounted instead because theme changes after
			// open() do not fully update its WASM palette.
			const themeObserver =
				backend.renderer === "xterm"
					? new MutationObserver(() => {
							terminal.options.theme = resolveTerminalTheme("xterm");
						})
					: null;
			themeObserver?.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ["class"],
			});

			terminalRuntimeRef.current = terminal;
			fitRef.current = fit;

			if (terminalRef) {
				(terminalRef as React.MutableRefObject<TerminalHandle | null>).current =
					{
						write: (data: string) => terminal.write(data),
						// Scrollback wipe only — `reset()` here would race with replay.
						clear: () => terminal.clear(),
						dispose: () => terminal.dispose(),
						refit: () => runFit(),
						focus: () => terminal.focus(),
					};
			}

			onReadyRef.current?.();
			runFit();

			cleanupTerminal = () => {
				if (fitTimer !== null) {
					window.clearTimeout(fitTimer);
					fitTimer = null;
				}
				dataSub.dispose();
				resizeSub.dispose();
				titleSub.dispose();
				linkProviderDisposable?.dispose();
				linkProvider?.dispose?.();
				themeObserver?.disconnect();
				resizeObserver.disconnect();
				terminalRefitListeners.delete(refitListener);
				fit.dispose?.();
				terminal.dispose();
				terminalRuntimeRef.current = null;
				fitRef.current = null;
				if (terminalRef) {
					(
						terminalRef as React.MutableRefObject<TerminalHandle | null>
					).current = null;
				}
			};
		};

		void mount(renderer).catch(async (error) => {
			if (disposed || renderer === "xterm") {
				console.error("[helmor] terminal renderer failed to mount", error);
				return;
			}
			console.error(
				"[helmor] libghostty terminal failed to load; falling back to xterm.js",
				error,
			);
			try {
				await mount("xterm");
			} catch (fallbackError) {
				console.error(
					"[helmor] xterm.js fallback failed to mount",
					fallbackError,
				);
			}
		});

		return () => {
			disposed = true;
			cleanupTerminal?.();
			if (terminalRef) {
				(terminalRef as React.MutableRefObject<TerminalHandle | null>).current =
					null;
			}
		};
	}, [
		detectLinks,
		fontSize,
		lineHeight,
		renderer,
		terminalRef,
		terminalThemeRevision,
	]);

	return (
		<div
			className={className}
			style={{
				width: "100%",
				height: "100%",
				boxSizing: "border-box",
				padding,
				backgroundColor: "var(--terminal-background)",
			}}
		>
			<div ref={containerRef} style={{ width: "100%", height: "100%" }} />
		</div>
	);
}

export const TerminalOutput = memo(TerminalOutputImpl);
