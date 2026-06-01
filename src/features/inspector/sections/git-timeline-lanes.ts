// Lane assignment for the Git Timeline. Given commits ordered newest-first
// with parent SHAs, we compute a VS Code / GitLens-style graph layout: each
// commit occupies a horizontal lane, and connectors (vertical + diagonal
// curves) are drawn between a commit and its parents.
//
// The algorithm processes commits top-to-bottom and keeps a "pending lanes"
// array. Each entry is either `null` (lane empty) or the SHA of the next
// commit expected in that lane. When we hit that SHA, the lane terminates
// there and may be reassigned to one of the commit's parents.
//
// We snapshot the lane state both BEFORE the commit (`incoming`) and AFTER
// (`outgoing`) so the renderer can draw the vertical segments above and
// below the commit dot, plus diagonal connectors for branch / merge points.

export type CommitWithParents = {
	sha: string;
	parents: string[];
};

export type LaneRow = {
	/** Lane index where this commit's dot is drawn. */
	commitLane: number;
	/** Lane indices where this commit's parents will appear. Length matches
	 *  `commit.parents`. Same lane as `commitLane` for a first-parent that
	 *  continues straight down; a different lane for a branch/merge. */
	parentLanes: number[];
	/** Snapshot of pending lane SHAs entering this row. `null` = empty.
	 *  The array length is sized to the widest lane used so far so the
	 *  renderer can lay out a consistent grid. */
	incoming: (string | null)[];
	/** Snapshot of pending lane SHAs leaving this row. */
	outgoing: (string | null)[];
};

/** Build per-row lane data plus the max lane width across all rows so the
 *  renderer can size the graph rail consistently for every commit row. */
export function computeLaneRows(commits: CommitWithParents[]): {
	rows: LaneRow[];
	maxLanes: number;
} {
	const lanes: (string | null)[] = [];
	const rows: LaneRow[] = [];
	let maxLanes = 0;

	for (const commit of commits) {
		// 1. Find this commit's lane: first lane already expecting it. If
		//    none, allocate a new lane (reuse an empty slot, else append).
		let commitLane = lanes.indexOf(commit.sha);
		if (commitLane === -1) {
			commitLane = lanes.indexOf(null);
			if (commitLane === -1) {
				commitLane = lanes.length;
				lanes.push(null);
			}
		}

		const incoming = lanes.slice();

		// 2. Clear any lane currently pointing at this SHA — multiple
		//    branches can converge on the same commit (e.g. two tags on the
		//    same SHA). All such lanes terminate here.
		for (let i = 0; i < lanes.length; i++) {
			if (lanes[i] === commit.sha) lanes[i] = null;
		}

		// 3. Place parents. First parent prefers the commit's own lane so
		//    the mainline flows straight down. Subsequent parents (merges)
		//    spread into fresh lanes. If a parent already has a lane (a
		//    later commit already reserved it), reuse that lane.
		const parentLanes: number[] = [];
		commit.parents.forEach((parent, parentIdx) => {
			const existing = lanes.indexOf(parent);
			if (existing !== -1) {
				parentLanes.push(existing);
				return;
			}
			if (parentIdx === 0 && lanes[commitLane] === null) {
				lanes[commitLane] = parent;
				parentLanes.push(commitLane);
				return;
			}
			let slot = lanes.indexOf(null);
			if (slot === -1) {
				slot = lanes.length;
				lanes.push(parent);
			} else {
				lanes[slot] = parent;
			}
			parentLanes.push(slot);
		});

		// 4. Compact trailing nulls so the graph rail doesn't grow without
		//    bound after merges resolve. Lanes in the middle stay as-is to
		//    avoid breaking the visual continuity of unrelated branches.
		while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
			lanes.pop();
		}

		const outgoing = lanes.slice();
		const widest = Math.max(incoming.length, outgoing.length, commitLane + 1);
		if (widest > maxLanes) maxLanes = widest;

		rows.push({ commitLane, parentLanes, incoming, outgoing });
	}

	return { rows, maxLanes };
}
