import { useCallback, useEffect, useRef, useState } from "react";

const ACTIVE_INPUT_WINDOW_MS = 380;
const SETTLE_AFTER_MS = 520;
const LARGE_APPEND_CHARS = 140;
const ACTIVE_CHARS_PER_SECOND = 44;
const FLUSH_CHARS_PER_SECOND = 96;
const MAX_MARKER_LOOKAHEAD = 16;

const getNow = () =>
	typeof performance === "undefined" ? Date.now() : performance.now();

function isMarkdownMarkerChar(char: string): boolean {
	switch (char.charCodeAt(0)) {
		case 0x21:
		case 0x24:
		case 0x28:
		case 0x29:
		case 0x2a:
		case 0x3c:
		case 0x3e:
		case 0x5b:
		case 0x5c:
		case 0x5d:
		case 0x5f:
		case 0x60:
		case 0x7c:
		case 0x7e:
			return true;
		default:
			return false;
	}
}

type UseSmoothStreamContentOptions = {
	enabled?: boolean;
};

export function useSmoothStreamContent(
	content: string,
	{ enabled = true }: UseSmoothStreamContentOptions = {},
): string {
	const [displayedContent, setDisplayedContent] = useState(content);
	const displayedContentRef = useRef(content);
	const displayedCountRef = useRef(0);
	const targetContentRef = useRef(content);
	const targetCharsRef = useRef<string[]>([]);
	const targetCountRef = useRef(0);
	const initializedRef = useRef(false);
	const lastInputTimeRef = useRef(0);
	const rafRef = useRef<number | null>(null);
	const lastFrameTimeRef = useRef<number | null>(null);
	const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearWakeTimer = useCallback(() => {
		if (wakeTimerRef.current !== null) {
			clearTimeout(wakeTimerRef.current);
			wakeTimerRef.current = null;
		}
	}, []);

	const stopFrameLoop = useCallback(() => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		lastFrameTimeRef.current = null;
	}, []);

	const stopScheduling = useCallback(() => {
		stopFrameLoop();
		clearWakeTimer();
	}, [clearWakeTimer, stopFrameLoop]);

	const resetToContent = useCallback(
		(nextContent: string) => {
			stopScheduling();
			targetContentRef.current = nextContent;
			displayedContentRef.current = nextContent;
			setDisplayedContent(nextContent);

			if (initializedRef.current) {
				const chars = [...nextContent];
				targetCharsRef.current = chars;
				targetCountRef.current = chars.length;
				displayedCountRef.current = chars.length;
			}
			lastInputTimeRef.current = getNow();
		},
		[stopScheduling],
	);

	const ensureInitialized = useCallback((seed: string) => {
		if (initializedRef.current) return;
		initializedRef.current = true;
		const chars = [...seed];
		targetCharsRef.current = chars;
		targetCountRef.current = chars.length;
		displayedCountRef.current = chars.length;
	}, []);

	const startFrameLoopRef = useRef<() => void>(() => {});

	const scheduleWake = useCallback(
		(delayMs: number) => {
			clearWakeTimer();
			wakeTimerRef.current = setTimeout(
				() => {
					wakeTimerRef.current = null;
					startFrameLoopRef.current();
				},
				Math.max(1, Math.ceil(delayMs)),
			);
		},
		[clearWakeTimer],
	);

	const startFrameLoop = useCallback(() => {
		clearWakeTimer();
		if (rafRef.current !== null) return;

		const tick = (timestamp: number) => {
			if (lastFrameTimeRef.current === null) {
				lastFrameTimeRef.current = timestamp;
				rafRef.current = requestAnimationFrame(tick);
				return;
			}

			const deltaSeconds = Math.max(
				0.001,
				Math.min((timestamp - lastFrameTimeRef.current) / 1000, 0.05),
			);
			lastFrameTimeRef.current = timestamp;

			const targetCount = targetCountRef.current;
			const displayedCount = displayedCountRef.current;
			const backlog = targetCount - displayedCount;
			if (backlog <= 0) {
				stopFrameLoop();
				return;
			}

			const idleMs = getNow() - lastInputTimeRef.current;
			if (idleMs <= ACTIVE_INPUT_WINDOW_MS && backlog <= 2) {
				stopFrameLoop();
				scheduleWake(ACTIVE_INPUT_WINDOW_MS - idleMs);
				return;
			}

			const charsPerSecond =
				idleMs >= SETTLE_AFTER_MS
					? FLUSH_CHARS_PER_SECOND
					: ACTIVE_CHARS_PER_SECOND;
			let nextCount = Math.min(
				targetCount,
				displayedCount + Math.max(1, Math.round(charsPerSecond * deltaSeconds)),
			);
			let lookahead = 0;
			while (
				nextCount < targetCount &&
				lookahead < MAX_MARKER_LOOKAHEAD &&
				isMarkdownMarkerChar(targetCharsRef.current[nextCount - 1] ?? "")
			) {
				nextCount += 1;
				lookahead += 1;
			}

			const nextDisplayed = targetCharsRef.current.slice(0, nextCount).join("");
			displayedCountRef.current = nextCount;
			displayedContentRef.current = nextDisplayed;
			setDisplayedContent(nextDisplayed);
			rafRef.current = requestAnimationFrame(tick);
		};

		rafRef.current = requestAnimationFrame(tick);
	}, [clearWakeTimer, scheduleWake, stopFrameLoop]);
	startFrameLoopRef.current = startFrameLoop;

	useEffect(() => {
		if (!enabled) {
			initializedRef.current = false;
			targetCharsRef.current = [];
			targetCountRef.current = 0;
			displayedCountRef.current = 0;
			resetToContent(content);
			return;
		}

		ensureInitialized(targetContentRef.current);

		const previousTarget = targetContentRef.current;
		if (content === previousTarget) return;

		const appendOnly = content.startsWith(previousTarget);
		const appended = appendOnly
			? content.slice(previousTarget.length)
			: content;
		const appendedChars = [...appended];
		if (!appendOnly || appendedChars.length > LARGE_APPEND_CHARS) {
			resetToContent(content);
			return;
		}

		targetContentRef.current = content;
		targetCharsRef.current = [...targetCharsRef.current, ...appendedChars];
		targetCountRef.current += appendedChars.length;
		lastInputTimeRef.current = getNow();
		startFrameLoop();
	}, [content, enabled, ensureInitialized, resetToContent, startFrameLoop]);

	useEffect(() => stopScheduling, [stopScheduling]);

	return displayedContent;
}
