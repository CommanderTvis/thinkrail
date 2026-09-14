import { expect, test } from "bun:test";
import type { SpecGraphNode } from "../contracts";
import { evictWorkspace, sameSpecGraph, specPathMatcher, useSpecStore } from "./store";

function node(over: Partial<SpecGraphNode> = {}): SpecGraphNode {
	return {
		id: "task-x",
		type: "task-spec",
		title: "X",
		path: ".thinkrail/context/TASK-x.md",
		dependsOn: [],
		references: [],
		implements: [],
		tags: [],
		...over,
	};
}

test("specPathMatcher recognizes a spec by graph membership, in either reported form", () => {
	const isSpec = specPathMatcher([node()]);

	expect(isSpec(".thinkrail/context/TASK-x.md")).toBe(true);
	expect(isSpec("/wt/ws/.thinkrail/context/TASK-x.md")).toBe(true);
	expect(isSpec("packages/server/src/todos/todos.ts")).toBe(false);
	expect(specPathMatcher([])(".thinkrail/context/TASK-x.md")).toBe(false);
});

test("sameSpecGraph compares by value, not by reference", () => {
	expect(sameSpecGraph(undefined, [])).toBe(false);
	expect(sameSpecGraph([node()], [node()])).toBe(true);
	expect(sameSpecGraph([node()], [node({ status: "active" })])).toBe(false);
	expect(sameSpecGraph([node()], [])).toBe(false);
});

test("setWorkspaceSpecs keeps the previous array identity when the re-read found no change", () => {
	useSpecStore.setState({ specsByWorkspace: {} });
	useSpecStore.getState().setWorkspaceSpecs("w1", [node()]);
	const first = useSpecStore.getState().specsByWorkspace.w1;

	useSpecStore.getState().setWorkspaceSpecs("w1", [node()]);
	expect(useSpecStore.getState().specsByWorkspace.w1).toBe(first);

	useSpecStore.getState().setWorkspaceSpecs("w1", [node({ status: "active" })]);
	expect(useSpecStore.getState().specsByWorkspace.w1).not.toBe(first);
});

test("evictWorkspace drops one workspace's cache without touching its siblings", () => {
	useSpecStore.setState({ specsByWorkspace: { w1: [node()], other: [] } });
	evictWorkspace("w1");
	const s = useSpecStore.getState();
	expect(s.specsByWorkspace.w1).toBeUndefined();
	expect(s.specsByWorkspace.other).toEqual([]);
});

test("evictWorkspace also drops the workspace's failed flag", () => {
	useSpecStore.setState({ failedByWorkspace: { w1: true, other: false } });
	evictWorkspace("w1");
	const s = useSpecStore.getState();
	expect(s.failedByWorkspace.w1).toBeUndefined();
	expect(s.failedByWorkspace.other).toBe(false);
});
