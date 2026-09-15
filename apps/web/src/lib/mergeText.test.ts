import { describe, expect, test } from "bun:test";
import { hasConflictMarkers, mergeText } from "./mergeText";

const doc = (...rows: string[]) => rows.join("\n");

describe("mergeText", () => {
	test("identical sides need no merging at all", () => {
		expect(mergeText("a", "b", "b")).toEqual({ text: "b", conflicts: 0 });
	});

	test("an untouched side yields to the other", () => {
		expect(mergeText("a", "a", "b")).toEqual({ text: "b", conflicts: 0 });
		expect(mergeText("a", "b", "a")).toEqual({ text: "b", conflicts: 0 });
	});

	test("edits in different places both survive", () => {
		const base = doc("one", "two", "three", "four", "five");
		const ours = doc("one", "TWO", "three", "four", "five");
		const theirs = doc("one", "two", "three", "four", "FIVE");

		const merged = mergeText(base, ours, theirs);
		expect(merged.conflicts).toBe(0);
		expect(merged.text).toBe(doc("one", "TWO", "three", "four", "FIVE"));
	});

	test("a line only we deleted stays deleted", () => {
		const base = doc("one", "two", "three");
		const ours = doc("one", "three");
		const theirs = doc("one", "two", "three", "four");

		const merged = mergeText(base, ours, theirs);
		expect(merged.conflicts).toBe(0);
		expect(merged.text).toBe(doc("one", "three", "four"));
	});

	test("a line only they deleted is not resurrected", () => {
		const base = doc("one", "two", "three");
		const ours = doc("ONE", "two", "three");
		const theirs = doc("one", "three");

		const merged = mergeText(base, ours, theirs);
		expect(merged.conflicts).toBe(0);
		expect(merged.text).toBe(doc("ONE", "three"));
	});

	test("insertions at different points both land", () => {
		const base = doc("one", "two");
		const ours = doc("zero", "one", "two");
		const theirs = doc("one", "two", "three");

		const merged = mergeText(base, ours, theirs);
		expect(merged.conflicts).toBe(0);
		expect(merged.text).toBe(doc("zero", "one", "two", "three"));
	});

	test("the same edit made twice collapses to one copy", () => {
		const base = doc("one", "two", "three");
		const same = doc("one", "TWO", "three");

		expect(mergeText(base, same, same)).toEqual({ text: same, conflicts: 0 });
	});

	test("two different edits to one line become a conflict, both texts kept", () => {
		const base = doc("one", "two", "three");
		const ours = doc("one", "ours", "three");
		const theirs = doc("one", "theirs", "three");

		const merged = mergeText(base, ours, theirs);
		expect(merged.conflicts).toBe(1);
		expect(merged.text).toBe(
			doc("one", "<<<<<<< your edits", "ours", "=======", "theirs", ">>>>>>> on disk", "three"),
		);
		expect(hasConflictMarkers(merged.text)).toBe(true);
	});

	test("a conflict does not swallow the agreeing regions around it", () => {
		const base = doc("head", "a", "b", "c", "tail");
		const ours = doc("head", "a", "OURS", "c", "TAIL");
		const theirs = doc("HEAD", "a", "THEIRS", "c", "tail");

		const merged = mergeText(base, ours, theirs);
		expect(merged.conflicts).toBe(1);
		expect(merged.text.startsWith("HEAD\na\n")).toBe(true);
		expect(merged.text.endsWith("\nc\nTAIL")).toBe(true);
	});

	test("one side deleting what the other rewrote is a conflict, not a silent loss", () => {
		const base = doc("one", "two", "three");
		const ours = doc("one", "rewritten", "three");
		const theirs = doc("one", "three");

		const merged = mergeText(base, ours, theirs);
		expect(merged.conflicts).toBe(1);
		expect(merged.text).toContain("rewritten");
	});

	test("two conflicts in one file are both marked", () => {
		const base = doc("a", "1", "b", "2", "c");
		const ours = doc("a", "x", "b", "y", "c");
		const theirs = doc("a", "p", "b", "q", "c");

		expect(mergeText(base, ours, theirs).conflicts).toBe(2);
	});

	test("an empty base means both sides are additions", () => {
		const merged = mergeText("", "ours", "theirs");
		expect(merged.conflicts).toBe(1);
	});
});

describe("hasConflictMarkers", () => {
	test("plain text carries none", () => {
		expect(hasConflictMarkers(doc("one", "two"))).toBe(false);
	});

	test("prose that merely mentions markers inline is not a conflict", () => {
		expect(hasConflictMarkers("git writes <<<<<<< your edits into the file")).toBe(false);
	});
});
