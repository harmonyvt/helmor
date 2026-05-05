import { describe, expect, it } from "vitest";
import { browserUserAgent, browserWebviewOptions } from "./runtime";

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
