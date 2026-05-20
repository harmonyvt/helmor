import {
	aggregatePerfMarks,
	getPerfMarkSummaries,
	isPerfMarksEnabled,
} from "./perf-marks";

type LongFrameApi = {
	enabled: () => boolean;
	get: () => unknown[];
	fps: () => number;
	worstFrameMs: () => number;
};

export function collectLogExportDiagnostics(): Record<string, unknown> {
	const longFrames = getLongFrameApi();
	const memory = getMemorySnapshot();

	return {
		capturedAt: new Date().toISOString(),
		location: getLocationSnapshot(),
		navigator: getNavigatorSnapshot(),
		viewport: getViewportSnapshot(),
		performance: {
			timeOrigin: getPerformanceTimeOrigin(),
			nowMs: getPerformanceNow(),
			memory,
			marks: {
				enabled: isPerfMarksEnabled(),
				entries: getPerfMarkSummaries(),
				aggregates: aggregatePerfMarks(),
			},
			longFrames: longFrames
				? {
						enabled: longFrames.enabled(),
						fps: longFrames.fps(),
						worstFrameMs: longFrames.worstFrameMs(),
						entries: longFrames.get(),
					}
				: {
						enabled: false,
						fps: null,
						worstFrameMs: null,
						entries: [],
					},
		},
	};
}

function getLongFrameApi(): LongFrameApi | null {
	if (typeof window === "undefined") return null;
	const api = window.__HELMOR_LONG_FRAMES__;
	if (!api) return null;
	return {
		enabled: api.enabled,
		get: api.get,
		fps: api.fps,
		worstFrameMs: api.worstFrameMs,
	};
}

function getLocationSnapshot() {
	if (typeof window === "undefined") return null;
	return {
		href: window.location.href,
		pathname: window.location.pathname,
		search: window.location.search,
		hash: window.location.hash,
	};
}

function getNavigatorSnapshot() {
	if (typeof navigator === "undefined") return null;
	return {
		userAgent: navigator.userAgent,
		language: navigator.language,
		hardwareConcurrency: navigator.hardwareConcurrency,
	};
}

function getViewportSnapshot() {
	if (typeof window === "undefined") return null;
	return {
		innerWidth: window.innerWidth,
		innerHeight: window.innerHeight,
		devicePixelRatio: window.devicePixelRatio,
	};
}

function getPerformanceTimeOrigin() {
	return typeof performance !== "undefined" ? performance.timeOrigin : null;
}

function getPerformanceNow() {
	return typeof performance !== "undefined" ? performance.now() : null;
}

function getMemorySnapshot() {
	if (typeof performance === "undefined") return null;
	const memory = (
		performance as Performance & {
			memory?: {
				usedJSHeapSize?: number;
				totalJSHeapSize?: number;
				jsHeapSizeLimit?: number;
			};
		}
	).memory;
	if (!memory) return null;
	return {
		usedJSHeapSize: memory.usedJSHeapSize,
		totalJSHeapSize: memory.totalJSHeapSize,
		jsHeapSizeLimit: memory.jsHeapSizeLimit,
	};
}
