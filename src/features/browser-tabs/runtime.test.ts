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

	it("uses tab-specific browser profile metadata when provided", () => {
		expect(
			browserWebviewOptions("https://example.com", bounds, {
				workspaceId: "11111111-1111-4111-8111-111111111111",
				tabId: "22222222-2222-4222-8222-222222222222",
				dataDirectory:
					"workspace-browser/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222",
				dataStoreIdentifier: [
					34, 34, 34, 34, 34, 34, 66, 34, 130, 34, 34, 34, 34, 34, 34, 34,
				],
			}),
		).toMatchObject({
			dataStoreIdentifier: [
				34, 34, 34, 34, 34, 34, 66, 34, 130, 34, 34, 34, 34, 34, 34, 34,
			],
		});
	});
});
