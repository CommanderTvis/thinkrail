import { defaultUrlTransform } from "react-markdown";
import { parseFrontmatter } from "./frontmatter";
import { SPEC_TYPES } from "./specTree";

export interface SpecDocument {
	/** The node id other specs link to with `[[id]]`. */
	id: string;
	type: string;
	title?: string;
}

function scalar(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * A spec is frontmatter carrying an `id` and one of the graph's own `type`s — see panels/SPEC.md for
 * why those two and not the filename.
 */
export function readSpecDocument(content: string): SpecDocument | null {
	const block = parseFrontmatter(content);
	if (!block) return null;
	const at = (key: string) => scalar(block.properties.find((p) => p.key === key)?.value);
	const id = at("id");
	const type = at("type");
	if (!id || !type || !SPEC_TYPES.includes(type)) return null;
	const title = at("title");
	return { id, type, ...(title ? { title } : {}) };
}

const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export interface WikiLink {
	target: string;
	label: string;
}

/** Every `[[id]]` / `[[id|label]]` in the text, in order. */
export function wikiLinks(text: string): WikiLink[] {
	const links: WikiLink[] = [];
	for (const match of text.matchAll(WIKI_LINK)) {
		const target = (match[1] ?? "").trim();
		if (target === "") continue;
		links.push({ target, label: (match[2] ?? "").trim() || target });
	}
	return links;
}

/**
 * Rewrite `[[id]]` into ordinary markdown links the renderer already knows, pointing at a scheme the
 * link handler resolves against the spec graph.
 */
export function linkifyWikiLinks(text: string): string {
	return text.replace(WIKI_LINK, (_whole, rawTarget: string, rawLabel?: string) => {
		const target = rawTarget.trim();
		if (target === "") return _whole;
		const label = (rawLabel ?? "").trim() || target;
		return `[${label}](spec:${encodeURIComponent(target)})`;
	});
}

export const SPEC_LINK_PREFIX = "spec:";

/** react-markdown drops a scheme it does not know, so our own is passed through unchanged. */
export function specUrlTransform(url: string): string {
	return url.startsWith(SPEC_LINK_PREFIX) ? url : defaultUrlTransform(url);
}

/** The node id a rewritten link points at, or null for an ordinary href. */
export function specLinkTarget(href: string): string | null {
	if (!href.startsWith(SPEC_LINK_PREFIX)) return null;
	const target = decodeURIComponent(href.slice(SPEC_LINK_PREFIX.length));
	return target === "" ? null : target;
}
