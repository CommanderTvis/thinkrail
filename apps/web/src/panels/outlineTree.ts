import { stripFrontmatter } from "@/lib/utils";
import { slugify } from "./markdownLinks";
import { frontmatterOffset } from "./sourceLines";

export interface HeadingEntry {
	level: number;
	text: string;
	id: string;
	/** 1-based line in the raw document, what the editor jump reveals. */
	line: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^(#{1,6})\s+(.*)$/;

/**
 * Headings read from the markdown source — level, display text, the slug id the rendered document gives
 * the same heading (same `slugify` + dedupe walk as `remarkHeadingIds`), and the raw source line. The
 * source is what both sides of a split can agree on; the id can drift from the DOM only in the review
 * path's segmented render, where the jump falls back to line stamps. See SPEC.md.
 */
export function sourceHeadings(raw: string): HeadingEntry[] {
	const stripped = stripFrontmatter(raw);
	const offset = frontmatterOffset(raw, stripped);
	const seen = new Map<string, number>();
	const found: HeadingEntry[] = [];
	let fence: string | null = null;
	stripped.split("\n").forEach((lineText, at) => {
		const fenceMark = FENCE.exec(lineText);
		if (fenceMark) {
			const mark = (fenceMark[1] ?? "").charAt(0);
			if (fence === null) fence = mark;
			else if (fence === mark) fence = null;
			return;
		}
		if (fence !== null) return;
		const match = ATX.exec(lineText);
		if (!match) return;
		const text = (match[2] ?? "")
			.replace(/\s+#+\s*$/, "")
			.replaceAll("`", "")
			.trim();
		const base = slugify(text);
		if (!base) return;
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		found.push({
			level: (match[1] ?? "").length,
			text,
			id: n === 0 ? base : `${base}-${n}`,
			line: at + 1 + offset,
		});
	});
	return found;
}

export interface OutlineNode {
	entry: HeadingEntry;
	children: OutlineNode[];
}

/** Nests a flat, document-order heading list by level — a level-N heading closes every open node at >= N. */
export function buildOutlineTree(entries: readonly HeadingEntry[]): OutlineNode[] {
	const root: OutlineNode[] = [];
	const stack: OutlineNode[] = [];
	for (const entry of entries) {
		const node: OutlineNode = { entry, children: [] };
		while (stack.length > 0 && (stack.at(-1) as OutlineNode).entry.level >= entry.level) {
			stack.pop();
		}
		const parent = stack.at(-1);
		(parent ? parent.children : root).push(node);
		stack.push(node);
	}
	return root;
}
