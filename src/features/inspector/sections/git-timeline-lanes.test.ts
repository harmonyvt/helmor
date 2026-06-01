import { describe, expect, it } from "vitest";
import { computeLaneRows } from "./git-timeline-lanes";

describe("computeLaneRows", () => {
	it("places a linear history on a single lane", () => {
		// Three commits in a straight line — every commit should live on
		// lane 0 with its single parent continuing the same lane.
		const { rows, maxLanes } = computeLaneRows([
			{ sha: "c3", parents: ["c2"] },
			{ sha: "c2", parents: ["c1"] },
			{ sha: "c1", parents: [] },
		]);
		expect(maxLanes).toBe(1);
		expect(rows.map((r) => r.commitLane)).toEqual([0, 0, 0]);
		expect(rows[0]?.parentLanes).toEqual([0]);
		expect(rows[2]?.parentLanes).toEqual([]); // root commit
	});

	it("opens a second lane for a merge commit's branch parent", () => {
		// `merge` has two parents — first stays on lane 0, second branches
		// off into a fresh lane. When that side branch resolves into the
		// shared root, its lane terminates.
		const { rows, maxLanes } = computeLaneRows([
			{ sha: "merge", parents: ["mainline", "feature"] },
			{ sha: "mainline", parents: ["root"] },
			{ sha: "feature", parents: ["root"] },
			{ sha: "root", parents: [] },
		]);
		expect(maxLanes).toBeGreaterThanOrEqual(2);
		expect(rows[0]?.commitLane).toBe(0);
		expect(rows[0]?.parentLanes).toEqual([0, 1]);
		// `root` should be hit once both branches converge — exactly one
		// row drawn for it on lane 0 (whichever lane reached it first).
		expect(rows[3]?.commitLane).toBe(0);
		expect(rows[3]?.parentLanes).toEqual([]);
	});

	it("re-uses an existing lane when another branch already reserved the parent", () => {
		// Two separate branches converging on a shared ancestor. The
		// second branch's parent should reuse the lane already holding
		// the shared SHA rather than allocating a new lane — this is the
		// signal that the renderer should draw a converging curve from
		// `b`'s lane down to `shared`'s lane.
		const { rows } = computeLaneRows([
			{ sha: "a", parents: ["shared"] },
			{ sha: "b", parents: ["shared"] },
			{ sha: "shared", parents: [] },
		]);
		expect(rows[0]?.commitLane).toBe(0);
		expect(rows[1]?.commitLane).toBe(1);
		// `b`'s parent lane (0) differs from `b`'s own lane (1) — that
		// disagreement is what tells `GraphCell` to draw a diagonal
		// connector from lane 1 to lane 0 instead of a straight line.
		expect(rows[1]?.parentLanes).toEqual([0]);
		// `shared` is rendered once, on the lane that originally reserved
		// it (lane 0).
		expect(rows[2]?.commitLane).toBe(0);
	});
});
