import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postDebugEvidence } from "./debug-evidence";

describe("postDebugEvidence", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("does not post without an ingest url", () => {
		postDebugEvidence(null, {
			source: "terminal-output",
			message: "fit completed",
		});
		postDebugEvidence("  ", {
			source: "terminal-output",
			message: "fit completed",
		});

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("posts compact JSON evidence to the ingest endpoint", () => {
		postDebugEvidence("http://127.0.0.1:4321/ingest?token=test", {
			level: "warn",
			source: "terminal-output",
			message: "fit slow",
			details: {
				renderer: "xterm",
				elapsedMs: 42,
				cols: 100,
				rows: 30,
			},
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"http://127.0.0.1:4321/ingest?token=test",
			expect.objectContaining({
				method: "POST",
				headers: { "content-type": "application/json" },
			}),
		);
		const [, init] = fetchMock.mock.calls[0];
		const payload = JSON.parse(String(init.body));
		expect(payload).toEqual(
			expect.objectContaining({
				level: "warn",
				source: "terminal-output",
				message: "fit slow",
				timestamp: expect.any(String),
				details: {
					renderer: "xterm",
					elapsedMs: 42,
					cols: 100,
					rows: 30,
				},
			}),
		);
	});

	it("swallows fetch failures", async () => {
		fetchMock.mockRejectedValueOnce(new Error("offline"));

		expect(() =>
			postDebugEvidence("http://127.0.0.1:4321/ingest?token=test", {
				source: "browser",
				message: "uncaught exception",
			}),
		).not.toThrow();

		await Promise.resolve();
	});
});
