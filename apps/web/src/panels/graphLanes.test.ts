import { expect, test } from "bun:test";
import type { GitGraphCommit } from "@thinkrail/contracts";
import { layoutGraph } from "./graphLanes";

function commit(sha: string, parents: string[]): GitGraphCommit {
	return {
		sha,
		shortSha: sha,
		parents,
		refs: [],
		subject: sha,
		author: "t",
		committedAt: "2026-01-01T00:00:00Z",
	};
}

test("a straight history stays in one lane", () => {
	const { rows } = layoutGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);
	expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
	expect(rows.map((row) => row.width)).toEqual([0, 0, 0]);
});

test("a branch takes its own lane and gives it back where it forked", () => {
	// c and b both sit on a: two tips, two lanes, rejoining at their shared parent.
	const { rows } = layoutGraph([commit("c", ["a"]), commit("b", ["a"]), commit("a", [])]);
	expect(rows.map((row) => row.lane)).toEqual([0, 1, 0]);
	// The fork point is reached from the second lane, which joins the first there.
	expect(rows[2]?.edges.some((edge) => edge.joins === 0)).toBe(true);
});

test("a merge opens a lane for its second parent", () => {
	const { rows } = layoutGraph([commit("m", ["a", "b"]), commit("b", ["a"]), commit("a", [])]);
	expect(rows[0]?.lane).toBe(0);
	expect(rows[1]?.lane).toBe(1);
	expect(rows[2]?.lane).toBe(0);
});

test("a lane keeps drawing through the rows it spans", () => {
	const { rows } = layoutGraph([
		commit("d", ["c"]),
		commit("c", ["a"]),
		commit("b", ["a"]),
		commit("a", []),
	]);
	// d continues into c, so c's own lane is drawn above its dot rather than as a crossing line.
	expect(rows[1]?.fromAbove).toBe(true);
	expect(rows[1]?.edges.map((edge) => edge.lane)).not.toContain(0);
	// b opens a second lane, and c's lane keeps crossing the rows below it.
	expect(rows[2]?.lane).toBe(1);
	expect(rows[2]?.edges.map((edge) => edge.lane)).toContain(0);
});

test("a tip has no line above it, and a root none below", () => {
	const { rows } = layoutGraph([commit("b", ["a"]), commit("a", [])]);
	expect(rows[0]?.fromAbove).toBe(false);
	expect(rows[0]?.toBelow).toBe(true);
	expect(rows[1]?.fromAbove).toBe(true);
	expect(rows[1]?.toBelow).toBe(false);
});

test("history wider than the rail shares the last lane instead of growing", () => {
	const tips = Array.from({ length: 12 }, (_, index) => commit(`t${index}`, ["root"]));
	const { rows } = layoutGraph([...tips, commit("root", [])]);
	expect(Math.max(...rows.map((row) => row.lane))).toBeLessThanOrEqual(7);
});

test("a page picks up the lanes the page before it left open", () => {
	const all = [commit("d", ["c"]), commit("c", ["a"]), commit("b", ["a"]), commit("a", [])];
	const whole = layoutGraph(all);
	const first = layoutGraph(all.slice(0, 2));
	const second = layoutGraph(all.slice(2), first.carry);
	// Split across two reads, every commit still sits in the lane the one-shot layout gives it.
	expect([...first.rows, ...second.rows].map((row) => row.lane)).toEqual(
		whole.rows.map((row) => row.lane),
	);
	expect(second.rows[0]?.fromAbove).toBe(false);
});

test("a merge says where the lane it opens came from", () => {
	const { rows } = layoutGraph([
		commit("m", ["a", "b"]),
		commit("b", ["base"]),
		commit("a", ["base"]),
		commit("base", []),
	]);
	// The merge opens a lane for its second parent, and the drawing joins it to the merge's own dot.
	expect(rows[0]?.branches.length).toBe(1);
	expect(rows[0]?.branches[0]).not.toBe(rows[0]?.lane);
	// The commit that lane was opened for sits in it.
	expect(rows[1]?.lane).toBe(rows[0]?.branches[0]);
	// An ordinary commit opens nothing.
	expect(rows[2]?.branches).toEqual([]);
});

test("an orphan branch keeps a lane of its own, ending where its root does", () => {
	// No shared ancestry: two histories that never meet, which is what an orphan branch is.
	const { rows } = layoutGraph([
		commit("x2", ["x1"]),
		commit("o2", ["o1"]),
		commit("x1", []),
		commit("o1", []),
	]);
	const lane = (sha: string) => rows.find((row) => row.commit.sha === sha)?.lane;
	expect(lane("x2")).not.toBe(lane("o2"));
	expect(lane("x1")).toBe(lane("x2"));
	expect(lane("o1")).toBe(lane("o2"));
	// Each history starts and stops on its own: no line above a tip, none below a root.
	for (const tip of ["x2", "o2"])
		expect(rows.find((r) => r.commit.sha === tip)?.fromAbove).toBe(false);
	for (const root of ["x1", "o1"]) {
		const row = rows.find((r) => r.commit.sha === root);
		expect(row?.toBelow).toBe(false);
		expect(row?.branches).toEqual([]);
	}
	// And a root frees its lane, so nothing below it keeps drawing a line that leads nowhere.
	const last = rows.at(-1);
	expect(last?.edges.some((edge) => edge.joins === null)).toBe(false);
});
