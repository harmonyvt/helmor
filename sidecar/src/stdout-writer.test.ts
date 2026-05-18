import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { createStdoutProtocolWriter, isBrokenPipeError } from "./stdout-writer";

class FakeStdout extends EventEmitter {
	chunks: string[] = [];
	throwOnWrite: unknown = null;

	write(chunk: string) {
		if (this.throwOnWrite) throw this.throwOnWrite;
		this.chunks.push(chunk);
		return true;
	}
}

describe("stdout protocol writer", () => {
	it("serializes events as json lines", () => {
		const stream = new FakeStdout();
		const writer = createStdoutProtocolWriter(stream, { error: () => {} });

		writer({ type: "ready", version: 1 });

		expect(stream.chunks).toEqual(['{"type":"ready","version":1}\n']);
	});

	it("exits once and drops future writes after EPIPE", async () => {
		const stream = new FakeStdout();
		const errors: string[] = [];
		const exits: number[] = [];
		const writer = createStdoutProtocolWriter(
			stream,
			{ error: (message) => errors.push(message) },
			(code) => exits.push(code),
		);
		stream.throwOnWrite = Object.assign(new Error("broken pipe"), {
			code: "EPIPE",
		});

		writer({ type: "ready", version: 1 });
		writer({ type: "ready", version: 2 });
		await new Promise((resolve) => setImmediate(resolve));

		expect(errors).toEqual(["stdout pipe closed; sidecar exiting"]);
		expect(exits).toEqual([0]);
		expect(stream.chunks).toEqual([]);
	});

	it("recognizes only EPIPE as a broken parent pipe", () => {
		expect(isBrokenPipeError({ code: "EPIPE" })).toBe(true);
		expect(isBrokenPipeError({ code: "ECONNRESET" })).toBe(false);
		expect(isBrokenPipeError(new Error("EPIPE"))).toBe(false);
	});
});
