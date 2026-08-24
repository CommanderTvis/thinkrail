import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { buildOutlineTree, type HeadingEntry, type OutlineNode } from "./outlineTree";

function scrollToHeading(id: string): void {
	document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function OutlineRow({ node }: { node: OutlineNode }) {
	const [expanded, setExpanded] = useState(true);
	const hasChildren = node.children.length > 0;
	const Chevron = expanded ? ChevronDown : ChevronRight;

	return (
		<li>
			<div className="group flex min-w-0 items-stretch">
				{hasChildren ? (
					<button
						type="button"
						data-testid="markdown-outline-toggle"
						aria-label={expanded ? `Collapse ${node.entry.text}` : `Expand ${node.entry.text}`}
						aria-expanded={expanded}
						onClick={() => setExpanded((value) => !value)}
						className="flex w-5 shrink-0 items-center justify-center text-text-subtle outline-none transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
					>
						<Chevron className="size-3.5" />
					</button>
				) : (
					<span className="w-5 shrink-0" />
				)}
				<button
					type="button"
					data-testid="markdown-outline-entry"
					data-level={node.entry.level}
					data-heading-id={node.entry.id}
					title={node.entry.text}
					onClick={() => scrollToHeading(node.entry.id)}
					className={cn(
						"min-w-0 flex-1 truncate rounded-[var(--radius-sm)] py-0.5 pr-xs text-left tr-text-ui outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
						node.entry.level <= 1 ? "text-text-default" : "text-text-muted",
					)}
				>
					{node.entry.text}
				</button>
			</div>
			{hasChildren && expanded ? (
				<ul className="pl-md">
					{node.children.map((child) => (
						<OutlineRow key={child.entry.id} node={child} />
					))}
				</ul>
			) : null}
		</li>
	);
}

export function Outline({ headings }: { headings: readonly HeadingEntry[] }) {
	if (headings.length === 0) {
		return (
			<p data-testid="markdown-outline-empty" className="p-sm tr-text-metadata text-text-subtle">
				No headings in this document.
			</p>
		);
	}
	const tree = buildOutlineTree(headings);
	return (
		<nav data-testid="markdown-outline" aria-label="Document outline" className="px-xs py-sm">
			<ul>
				{tree.map((node) => (
					<OutlineRow key={node.entry.id} node={node} />
				))}
			</ul>
		</nav>
	);
}
