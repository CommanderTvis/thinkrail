import type { GitGraphCommit } from "@thinkrail/contracts";

export interface GraphEdge {
	/** The lane the line occupies in the gap above this row. */
	lane: number;
	/** Where it lands on this row: the same lane, or a merge/branch joining this commit's lane. */
	joins: number | null;
}

export interface GraphRow {
	commit: GitGraphCommit;
	/** The lane the commit's own dot sits in. */
	lane: number;
	/** Lines crossing the gap above this row. Never the commit's own lane — see `fromAbove`. */
	edges: GraphEdge[];
	/** A child drawn above continues down into this dot; false on a branch tip. */
	fromAbove: boolean;
	/** A first parent continues below it; false on a root commit. */
	toBelow: boolean;
	/** Widest lane index in play on this row, for sizing the gutter. */
	width: number;
}

const MAX_LANES = 8;

/** What the lanes were waiting for when a page ran out, so the next page can carry on. */
export type LaneState = readonly string[];

export interface GraphLayout {
	rows: GraphRow[];
	carry: LaneState;
}

/** Lanes for a commit list already in date order — see panels/SPEC.md for the rule. */
export function layoutGraph(
	commits: readonly GitGraphCommit[],
	carry: LaneState = [],
): GraphLayout {
	// Lane i is waiting for lanes[i]; an empty string is a free lane.
	const lanes: string[] = [...carry];
	const rows: GraphRow[] = [];

	const claim = (sha: string): number => {
		const existing = lanes.indexOf(sha);
		if (existing >= 0) return existing;
		const free = lanes.indexOf("");
		if (free >= 0) {
			lanes[free] = sha;
			return free;
		}
		if (lanes.length < MAX_LANES) {
			lanes.push(sha);
			return lanes.length - 1;
		}
		lanes[MAX_LANES - 1] = sha;
		return MAX_LANES - 1;
	};

	for (const commit of commits) {
		// Asked before claiming: a lane the claim itself opened has nothing above it to draw.
		const fromAbove = lanes.includes(commit.sha);
		const lane = claim(commit.sha);
		// Every other lane still waiting for something draws a line through the gap above this row.
		const edges: GraphEdge[] = [];
		for (const [index, waiting] of lanes.entries()) {
			if (waiting === "" || index === lane) continue;
			edges.push({ lane: index, joins: waiting === commit.sha ? lane : null });
		}

		// The lanes that were waiting for this commit are answered; the first parent inherits this lane.
		for (const [index, waiting] of lanes.entries()) {
			if (waiting === commit.sha) lanes[index] = "";
		}
		const [first, ...rest] = commit.parents;
		if (first !== undefined) lanes[lane] = first;
		for (const parent of rest) claim(parent);

		const width = lanes.reduce((widest, waiting, index) => (waiting ? index : widest), lane);
		rows.push({
			commit,
			lane,
			edges,
			fromAbove,
			toBelow: first !== undefined,
			width: Math.max(width, lane),
		});
	}

	return { rows, carry: lanes };
}
