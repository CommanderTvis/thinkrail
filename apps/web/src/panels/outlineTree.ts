export interface HeadingEntry {
	level: number;
	text: string;
	id: string;
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
