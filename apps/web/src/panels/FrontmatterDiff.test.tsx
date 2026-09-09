import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FrontmatterDiff, frontmatterDiff } from "./FrontmatterDiff";

const doc = (frontmatter: string) => `---\n${frontmatter}\n---\n\n# Doc\n`;

function states(before: string, after: string): string[] {
	const model = frontmatterDiff(before, after);
	if (model?.kind !== "rows") throw new Error("expected a row model");
	return model.rows.map((row) => `${row.state}:${row.key}`);
}

function markup(before: string, after: string): string {
	const model = frontmatterDiff(before, after);
	if (!model) throw new Error("expected frontmatter on a side");
	return renderToStaticMarkup(<FrontmatterDiff model={model} />).replace(/ class="[^"]*"/g, "");
}

test("documents without frontmatter have no properties to compare", () => {
	expect(frontmatterDiff("# A\n", "# B\n")).toBeNull();
});

test("each key is a row named for what happened to it", () => {
	expect(
		states(doc("status: draft\nowner: ann\nold: 1"), doc("status: active\nowner: ann\nnew: 2")),
	).toEqual(["changed:status", "same:owner", "removed:old", "added:new"]);
});

test("a renamed key is one key leaving and another arriving", () => {
	expect(states(doc("status: draft"), doc("state: draft"))).toEqual([
		"removed:status",
		"added:state",
	]);
});

test("reordering keys and reformatting a list are not changes", () => {
	const model = frontmatterDiff(doc("a: 1\ntags: [x, y]"), doc("tags:\n  - x\n  - y\na: 1"));
	expect(model?.changed).toBe(false);
});

test("frontmatter appearing or disappearing marks every row", () => {
	expect(states("# Doc\n", doc("status: draft"))).toEqual(["added:status"]);
	expect(states(doc("status: draft"), "# Doc\n")).toEqual(["removed:status"]);
});

test("a scalar is marked by word and a list by item, brackets left alone", () => {
	expect(markup(doc("title: Old Title"), doc("title: New Title"))).toContain(
		"<del>Old</del><ins>New</ins><span> Title</span>",
	);
	const list = markup(doc("tags: [a, b]"), doc("tags: [a, c, d]"));
	expect(list).toContain('<del data-testid="frontmatter-diff-item">b</del>');
	expect(list).toContain('<ins data-testid="frontmatter-diff-item">c</ins>');
	expect(list).toContain('<ins data-testid="frontmatter-diff-item">d</ins>');
	expect(list).not.toMatch(/<(ins|del)[^>]*>[^<]*[[\]]/);
});

test("a mapping is marked by entry and a change of shape replaces the value whole", () => {
	const mapping = markup(doc("meta:\n  a: 1\n  b: 2"), doc("meta:\n  a: 1\n  b: 3"));
	expect(mapping).toContain('<del data-testid="frontmatter-diff-item">b: 2</del>');
	expect(mapping).toContain('<ins data-testid="frontmatter-diff-item">b: 3</ins>');
	const reshaped = markup(doc("tags: one"), doc("tags: [one, two]"));
	expect(reshaped).toContain("<del>one</del>");
	expect(reshaped).toMatch(/<ins>\[.*two.*\]<\/ins>/);
});

test("frontmatter the properties table cannot speak is compared line by line as written", () => {
	const model = frontmatterDiff(doc("desc: |\n  one\n  two"), doc("desc: |\n  one\n  three"));
	expect(model?.kind).toBe("raw");
	expect(model?.changed).toBe(true);
	const raw = markup(doc("desc: |\n  one\n  two"), doc("desc: |\n  one\n  three"));
	expect(raw).toContain("<del>  two</del>");
	expect(raw).toContain("<ins>  three</ins>");
	expect(markup(doc("a: |\n  x\nb: {c: {d: 1}}"), doc("a: |\n  y\nb: {c: {d: 1}}"))).toContain(
		"<del>  x</del><ins>  y</ins><span>b:",
	);
});
