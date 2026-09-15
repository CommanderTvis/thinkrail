import type { LineSelection } from "@/panels/reviewGutter";

function stampedAncestor(node: Node | null, root: HTMLElement): HTMLElement | null {
	let el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
	while (el && el !== root.parentElement) {
		if (el.hasAttribute?.("data-md-line-start")) return el;
		el = el.parentElement;
	}
	return null;
}

/** The source line span the current selection falls in, read from `data-md-line-*` stamps. */
export function stampedSelectionLines(container: HTMLElement): LineSelection | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	const startBlock = stampedAncestor(range.startContainer, container);
	const endBlock = stampedAncestor(range.endContainer, container);
	if (!startBlock || !endBlock) return null;
	const num = (el: HTMLElement, attr: string) => Number(el.getAttribute(attr)) || 0;
	const startLine = num(startBlock, "data-md-line-start");
	const boundaryOnly = endBlock !== startBlock && range.endOffset === 0;
	let effectiveEnd: HTMLElement = endBlock;
	if (boundaryOnly) {
		let prev = endBlock.previousElementSibling;
		while (prev && !(prev instanceof HTMLElement && prev.hasAttribute("data-md-line-start")))
			prev = prev.previousElementSibling;
		effectiveEnd = prev instanceof HTMLElement ? prev : startBlock;
	}
	const endLine = num(effectiveEnd, "data-md-line-end");
	if (startLine < 1 || endLine < 1) return null;
	return { startLine, endLine: Math.max(startLine, endLine) };
}
