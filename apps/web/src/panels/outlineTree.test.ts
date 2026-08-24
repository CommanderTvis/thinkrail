import { expect, test } from "bun:test";
import { buildOutlineTree, type HeadingEntry } from "./outlineTree";

function heading(level: number, text: string): HeadingEntry {
	return { level, text, id: text.toLowerCase().replace(/\s+/g, "-") };
}

test("flat headings at one level nest as siblings", () => {
	const tree = buildOutlineTree([heading(1, "A"), heading(1, "B")]);
	expect(tree.map((n) => n.entry.text)).toEqual(["A", "B"]);
	expect(tree.every((n) => n.children.length === 0)).toBe(true);
});

test("a deeper heading nests under the nearest shallower one", () => {
	const tree = buildOutlineTree([heading(1, "A"), heading(2, "A.1"), heading(2, "A.2")]);
	expect(tree).toHaveLength(1);
	expect(tree[0]?.children.map((n) => n.entry.text)).toEqual(["A.1", "A.2"]);
});

test("a heading closes every open node at or above its own level", () => {
	const tree = buildOutlineTree([heading(1, "A"), heading(3, "A.deep"), heading(2, "A.2")]);
	expect(tree[0]?.children.map((n) => n.entry.text)).toEqual(["A.deep", "A.2"]);
	expect(tree[0]?.children[0]?.children).toEqual([]);
});

test("a level skip (h1 straight to h3) still nests rather than flattening", () => {
	const tree = buildOutlineTree([heading(1, "A"), heading(3, "A.deep")]);
	expect(tree[0]?.children.map((n) => n.entry.text)).toEqual(["A.deep"]);
});

test("no headings yields an empty tree", () => {
	expect(buildOutlineTree([])).toEqual([]);
});
