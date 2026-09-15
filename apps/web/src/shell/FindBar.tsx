import {
	RiArrowDownSLine as ChevronDown,
	RiArrowUpSLine as ChevronUp,
	RiCloseLine as X,
} from "@remixicon/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export const FIND_HIGHLIGHT = "thinkrail-find";
export const FIND_CURRENT_HIGHLIGHT = "thinkrail-find-current";
const SKIPPED_PARENTS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT"]);

function collectMatches(query: string, exclude: Element | null): Range[] {
	const needle = query.toLowerCase();
	if (!needle) return [];
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => {
			const parent = node.parentElement;
			if (!parent || SKIPPED_PARENTS.has(parent.tagName) || exclude?.contains(node)) {
				return NodeFilter.FILTER_REJECT;
			}
			if (typeof parent.checkVisibility === "function" && !parent.checkVisibility()) {
				return NodeFilter.FILTER_REJECT;
			}
			return NodeFilter.FILTER_ACCEPT;
		},
	});
	const ranges: Range[] = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const haystack = (node as Text).data.toLowerCase();
		for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
			const range = document.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + needle.length);
			ranges.push(range);
		}
	}
	return ranges;
}

function paint(ranges: Range[], current: number): void {
	const target = ranges[current];
	if ("highlights" in CSS) {
		CSS.highlights.set(FIND_HIGHLIGHT, new Highlight(...ranges));
		CSS.highlights.set(FIND_CURRENT_HIGHLIGHT, target ? new Highlight(target) : new Highlight());
	} else {
		const selection = window.getSelection();
		selection?.removeAllRanges();
		if (target) selection?.addRange(target);
	}
	target?.startContainer.parentElement?.scrollIntoView({ block: "center" });
}

function clearPaint(): void {
	if ("highlights" in CSS) {
		CSS.highlights.delete(FIND_HIGHLIGHT);
		CSS.highlights.delete(FIND_CURRENT_HIGHLIGHT);
	}
}

export function FindBar({ request, onClose }: { request: number; onClose: () => void }) {
	const barRef = useRef<HTMLElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [matches, setMatches] = useState<Range[]>([]);
	const [current, setCurrent] = useState(0);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [request]);
	useEffect(() => clearPaint, []);

	const show = (ranges: Range[], index: number) => {
		setMatches(ranges);
		setCurrent(index);
		paint(ranges, index);
	};
	const retype = (next: string) => {
		setQuery(next);
		show(collectMatches(next, barRef.current), 0);
	};
	const step = (backwards: boolean) => {
		const ranges = collectMatches(query, barRef.current);
		if (ranges.length === 0) return show(ranges, 0);
		const from = Math.min(current, ranges.length - 1);
		show(ranges, (from + (backwards ? -1 : 1) + ranges.length) % ranges.length);
	};
	const missed = query !== "" && matches.length === 0;

	return (
		<search
			ref={barRef}
			data-testid="find-bar"
			className="fixed top-[calc(var(--panel-header-row-height)+16px)] right-16 z-50 flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg p-4 shadow-[var(--shadow-md)]"
		>
			<input
				ref={inputRef}
				data-testid="find-input"
				data-missed={missed}
				value={query}
				placeholder="Find in page"
				spellCheck={false}
				onChange={(event) => retype(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						step(event.shiftKey);
					} else if (event.key === "Escape") {
						event.preventDefault();
						onClose();
					}
				}}
				className={`w-[220px] rounded-[var(--radius-sm)] border bg-control-bg px-8 py-4 tr-text-ui outline-none focus:border-control-border-active ${
					missed ? "border-feedback-error" : "border-control-border-default"
				}`}
			/>
			<span
				data-testid="find-count"
				className="min-w-[48px] text-center tr-text-metadata text-text-muted"
			>
				{query ? `${matches.length === 0 ? 0 : current + 1}/${matches.length}` : ""}
			</span>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Previous match"
				data-testid="find-previous"
				onClick={() => step(true)}
			>
				<ChevronUp className="size-14" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Next match"
				data-testid="find-next"
				onClick={() => step(false)}
			>
				<ChevronDown className="size-14" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Close find"
				data-testid="find-close"
				onClick={onClose}
			>
				<X className="size-14" />
			</Button>
		</search>
	);
}
