import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { describe, expect, it } from "vitest";
import {
	browserUserAgent,
	browserWebviewOptions,
	measureBrowserWebviewBounds,
	readBrowserWebviewGeometry,
} from "./runtime";

const bounds = { x: 1, y: 2, width: 300, height: 200 };

describe("browserUserAgent", () => {
	it("removes app framework tokens from browser-like user agents", () => {
		expect(
			browserUserAgent(
				"Mozilla/5.0 AppleWebKit/605.1.15 Version/17.6 Safari/605.1.15 Helmor/0.12.2 Tauri/2.0 Wry/0.54.4",
			),
		).toBe("Mozilla/5.0 AppleWebKit/605.1.15 Version/17.6 Safari/605.1.15");
	});

	it("falls back to a Safari user agent when the host agent is not browser-like", () => {
		expect(browserUserAgent("Helmor/0.12.2")).toContain("Safari/605.1.15");
	});
});

describe("browserWebviewOptions", () => {
	it("explicitly enables JavaScript and uses a normal browser profile", () => {
		expect(browserWebviewOptions("https://example.com", bounds)).toMatchObject({
			url: "https://example.com",
			x: 1,
			y: 2,
			width: 300,
			height: 200,
			javascriptDisabled: false,
			incognito: false,
			userAgent: expect.stringContaining("Safari/605.1.15"),
		});
	});

	it("does not rely on JS-created webview profile options", () => {
		expect(
			browserWebviewOptions("https://example.com", bounds),
		).not.toHaveProperty("dataStoreIdentifier");
		expect(
			browserWebviewOptions("https://example.com", bounds),
		).not.toHaveProperty("dataDirectory");
	});
});

describe("measureBrowserWebviewBounds", () => {
	it("rounds DOM bounds and enforces a minimum visible size", () => {
		const element = {
			getBoundingClientRect: () => ({
				left: 10.4,
				top: 20.5,
				width: 12.2,
				height: 400.6,
			}),
		} as HTMLElement;

		expect(measureBrowserWebviewBounds(element)).toEqual({
			x: 10,
			y: 21,
			width: 24,
			height: 401,
		});
	});
});

describe("readBrowserWebviewGeometry", () => {
	it("discloses actual native frame and safe page viewport dimensions", async () => {
		const originalDevicePixelRatio = window.devicePixelRatio;
		Object.defineProperty(window, "devicePixelRatio", {
			configurable: true,
			value: 2,
		});

		const geometry = await readBrowserWebviewGeometry(
			{
				position: async () => new PhysicalPosition(20, 40),
				size: async () => new PhysicalSize(640, 480),
			},
			bounds,
			"create",
		);

		expect(geometry).toMatchObject({
			requestedBounds: bounds,
			nativeFrame: {
				logical: { x: 10, y: 20, width: 320, height: 240 },
				physical: { x: 20, y: 40, width: 640, height: 480 },
			},
			pageViewport: { width: 320, height: 240, scaleFactor: 2 },
			source: "create",
		});

		Object.defineProperty(window, "devicePixelRatio", {
			configurable: true,
			value: originalDevicePixelRatio,
		});
	});

	it("falls back to requested bounds when native reads fail", async () => {
		const geometry = await readBrowserWebviewGeometry(
			{
				position: async () => {
					throw new Error("unavailable");
				},
				size: async () => new PhysicalSize(640, 480),
			},
			bounds,
			"manual",
		);

		expect(geometry).toMatchObject({
			requestedBounds: bounds,
			nativeFrame: { logical: bounds },
			pageViewport: { width: bounds.width, height: bounds.height },
			source: "manual",
		});
	});
});
