import { expect, test } from "bun:test";
import { sourceHeadings } from "./outlineTree";
import { linkifyWikiLinks, readSpecDocument, specLinkTarget, wikiLinks } from "./specDocument";

const SPEC = [
	"---",
	"id: module-web",
	"type: module-design",
	"title: web — the UI client",
	"---",
	"",
	"## Responsibility",
	"",
	"It depends on [[module-contracts]] and nothing else.",
	"",
].join("\n");

const PLAIN = ["---", "title: Just notes", "---", "", "## Heading", "", "[[not-a-link]]", ""].join(
	"\n",
);

test("a spec is frontmatter with an id and a known graph type", () => {
	expect(readSpecDocument(SPEC)).toEqual({
		id: "module-web",
		type: "module-design",
		title: "web — the UI client",
	});
});

test("ordinary markdown is not a spec, whatever its frontmatter says", () => {
	expect(readSpecDocument(PLAIN)).toBeNull();
	expect(readSpecDocument("# No frontmatter at all\n")).toBeNull();
	expect(readSpecDocument("---\nid: x\ntype: invented-kind\n---\n")).toBeNull();
});

test("wiki links carry a target and the label the writer chose", () => {
	expect(wikiLinks("see [[module-web]] and [[module-server|the host]]")).toEqual([
		{ target: "module-web", label: "module-web" },
		{ target: "module-server", label: "the host" },
	]);
});

test("a wiki link becomes a markdown link the renderer already understands", () => {
	expect(linkifyWikiLinks("see [[module-web]]")).toBe("see [module-web](spec:module-web)");
	expect(linkifyWikiLinks("see [[a b|two words]]")).toBe("see [two words](spec:a%20b)");
	expect(linkifyWikiLinks("[[]]")).toBe("[[]]");
});

test("only a rewritten link names a spec", () => {
	expect(specLinkTarget("spec:module-web")).toBe("module-web");
	expect(specLinkTarget("spec:a%20b")).toBe("a b");
	expect(specLinkTarget("./README.md")).toBeNull();
	expect(specLinkTarget("https://example.test")).toBeNull();
});

test("a spec's outline opens with its frontmatter title", () => {
	const headings = sourceHeadings(SPEC);
	expect(headings[0]).toMatchObject({ level: 1, text: "web — the UI client", line: 4 });
	expect(headings[1]).toMatchObject({ level: 2, text: "Responsibility" });
});

test("ordinary markdown's outline starts at its own first heading", () => {
	expect(sourceHeadings(PLAIN)[0]).toMatchObject({ level: 2, text: "Heading" });
});
