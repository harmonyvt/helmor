import { describe, expect, it } from "vitest";
import type { CodeGraphEdge } from "@/lib/api";
import {
	computeSelectionContext,
	edgeStateFor,
	nodeStateFor,
} from "./selection";

const edges: CodeGraphEdge[] = [
	{ id: "e0", source: "a.ts", target: "b.ts", kind: "static" },
	{ id: "e1", source: "a.ts", target: "c.ts", kind: "static" },
	{ id: "e2", source: "d.ts", target: "a.ts", kind: "static" },
	{ id: "e3", source: "e.ts", target: "f.ts", kind: "static" },
];

describe("computeSelectionContext", () => {
	it("returns empty context when nothing is selected", () => {
		const ctx = computeSelectionContext(null, edges);
		expect(ctx.connectedIds.size).toBe(0);
		expect(ctx.inboundCount).toBe(0);
		expect(ctx.outboundCount).toBe(0);
	});

	it("captures both inbound and outbound neighbours", () => {
		const ctx = computeSelectionContext("a.ts", edges);
		expect(ctx.inboundCount).toBe(1);
		expect(ctx.outboundCount).toBe(2);
		expect([...ctx.connectedIds].sort()).toEqual(["b.ts", "c.ts", "d.ts"]);
	});
});

describe("nodeStateFor", () => {
	it("classifies nodes relative to selection", () => {
		const ctx = computeSelectionContext("a.ts", edges);
		expect(nodeStateFor("a.ts", ctx)).toBe("selected");
		expect(nodeStateFor("b.ts", ctx)).toBe("connected");
		expect(nodeStateFor("d.ts", ctx)).toBe("connected");
		expect(nodeStateFor("e.ts", ctx)).toBe("dimmed");
	});

	it("returns default for everything when nothing selected", () => {
		const ctx = computeSelectionContext(null, edges);
		expect(nodeStateFor("a.ts", ctx)).toBe("default");
	});
});

describe("edgeStateFor", () => {
	it("highlights edges touching the selection and dims others", () => {
		const ctx = computeSelectionContext("a.ts", edges);
		expect(edgeStateFor(edges[0], ctx)).toBe("connected");
		expect(edgeStateFor(edges[2], ctx)).toBe("connected");
		expect(edgeStateFor(edges[3], ctx)).toBe("dimmed");
	});
});
