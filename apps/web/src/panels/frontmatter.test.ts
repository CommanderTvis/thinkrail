import { expect, test } from "bun:test";
import { parseFrontmatter, withFrontmatter } from "./frontmatter";

const DOC = `---
title: Green talk
count: 20
tags:
  - talk
  - latex
empty:
inline: [a, "b c"]
---

# Body
`;

test("scalars, block lists, inline lists, and empty values parse as editable properties", () => {
	const block = parseFrontmatter(DOC);
	expect(block?.editable).toBe(true);
	expect(block?.properties).toEqual([
		{ key: "title", value: "Green talk" },
		{ key: "count", value: "20" },
		{ key: "tags", value: ["talk", "latex"] },
		{ key: "empty", value: "" },
		{ key: "inline", value: ["a", "b c"] },
	]);
});

test("a document without frontmatter has none, and one with an unclosed fence is left alone", () => {
	expect(parseFrontmatter("# Just a doc\n")).toBeNull();
	expect(parseFrontmatter("---\ntitle: x\n# never closed\n")).toBeNull();
});

test("shapes the editor does not speak keep the block read-only instead of guessing", () => {
	for (const body of [
		"nested:\n  child:\n    deep: x",
		"dup:\n  a: 1\n  a: 2",
		"map: { a: 1 }",
		"anchor: &a x",
	]) {
		const block = parseFrontmatter(`---\n${body}\n---\n`);
		expect(block?.editable).toBe(false);
		expect(block?.raw).toBe(body);
	}
});

test("a one-level mapping of scalars parses and round-trips", () => {
	const doc = "---\nmeta:\n  owner: me\n  count: 2\n---\n\n# Body\n";
	const block = parseFrontmatter(doc);
	expect(block?.editable).toBe(true);
	expect(block?.properties).toEqual([{ key: "meta", value: { owner: "me", count: "2" } }]);
	const next = withFrontmatter(doc, [{ key: "meta", value: { owner: "you", count: "2" } }]);
	expect(next.endsWith("\n# Body\n")).toBe(true);
	expect(parseFrontmatter(next)?.properties).toEqual([
		{ key: "meta", value: { owner: "you", count: "2" } },
	]);
});

test("an edit round-trips: the body is untouched and the values read back", () => {
	const block = parseFrontmatter(DOC);
	if (!block) throw new Error("expected frontmatter");
	const edited = block.properties.map((p) =>
		p.key === "title" ? { ...p, value: "Amber talk" } : p,
	);
	const next = withFrontmatter(DOC, edited);
	expect(next.endsWith("\n# Body\n")).toBe(true);
	expect(parseFrontmatter(next)?.properties).toEqual([
		{ key: "title", value: "Amber talk" },
		{ key: "count", value: "20" },
		{ key: "tags", value: ["talk", "latex"] },
		{ key: "empty", value: "" },
		{ key: "inline", value: ["a", "b c"] },
	]);
});

test("values that need quoting survive the trip", () => {
	const next = withFrontmatter("# Doc\n", [
		{ key: "title", value: 'He said "go": now' },
		{ key: "truthy", value: "false" },
		{ key: "tags", value: ["a: b", ""] },
	]);
	expect(parseFrontmatter(next)?.properties).toEqual([
		{ key: "title", value: 'He said "go": now' },
		{ key: "truthy", value: "false" },
		{ key: "tags", value: ["a: b", ""] },
	]);
});

test("removing the last property removes the fence; adding to a bare doc creates one", () => {
	expect(withFrontmatter(DOC, [])).toBe("# Body\n");
	const created = withFrontmatter("# Doc\n", [{ key: "title", value: "x" }]);
	expect(created).toBe("---\ntitle: x\n---\n\n# Doc\n");
});
