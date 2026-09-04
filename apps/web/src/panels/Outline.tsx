import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiLayoutLeftLine as PanelLeft,
} from "@remixicon/react";
import { useState } from "react";
import { IconTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { buildOutlineTree, type HeadingEntry, type OutlineNode } from "./outlineTree";

/** Scroll the rendered heading into view — by its slug id, or by the line stamp of the block holding it. */
export function scrollToHeading(entry: HeadingEntry): void {
	const target =
		document.getElementById(entry.id) ??
		document.querySelector(`[data-md-line-start="${entry.line}"]`);
	target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function OutlineToggle({
	active,
	onClick,
	testid = "md-toggle-outline",
}: {
	active: boolean;
	onClick: () => void;
	testid?: string;
}) {
	return (
		<IconTooltip label={active ? "Hide outline" : "Show outline"}>
			<button
				type="button"
				data-testid={testid}
				aria-pressed={active}
				aria-label={active ? "Hide outline" : "Show outline"}
				onClick={onClick}
				className={`flex size-24 items-center justify-center rounded-[var(--radius-sm)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
					active
						? "bg-container-elevated-bg text-text-default"
						: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				}`}
			>
				<PanelLeft className="size-14" />
			</button>
		</IconTooltip>
	);
}

/** The pane-edge column an outline lives in, the same width wherever a document has one. */
export function OutlineColumn({
	headings,
	onSelect,
}: {
	headings: readonly HeadingEntry[];
	onSelect: (entry: HeadingEntry) => void;
}) {
	return (
		<div className="w-224 shrink-0 overflow-y-auto border-border-default border-r bg-container-header-bg">
			<Outline headings={headings} onSelect={onSelect} />
		</div>
	);
}

function OutlineRow({
	node,
	onSelect,
}: {
	node: OutlineNode;
	onSelect: (entry: OutlineNode["entry"]) => void;
}) {
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
						className="flex w-20 shrink-0 items-center justify-center text-text-subtle outline-none transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
					>
						<Chevron className="size-14" />
					</button>
				) : (
					<span className="w-20 shrink-0" />
				)}
				<button
					type="button"
					data-testid="markdown-outline-entry"
					data-level={node.entry.level}
					data-heading-id={node.entry.id}
					title={node.entry.text}
					onClick={() => onSelect(node.entry)}
					className={cn(
						"min-w-0 flex-1 truncate rounded-[var(--radius-sm)] py-2 pr-4 text-left tr-text-ui outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
						node.entry.level <= 1 ? "text-text-default" : "text-text-muted",
					)}
				>
					{node.entry.text}
				</button>
			</div>
			{hasChildren && expanded ? (
				<ul className="pl-12">
					{node.children.map((child) => (
						<OutlineRow key={child.entry.id} node={child} onSelect={onSelect} />
					))}
				</ul>
			) : null}
		</li>
	);
}

export function Outline({
	headings,
	onSelect,
}: {
	headings: readonly HeadingEntry[];
	onSelect: (entry: HeadingEntry) => void;
}) {
	if (headings.length === 0) {
		return (
			<p data-testid="markdown-outline-empty" className="p-8 tr-text-metadata text-text-subtle">
				No headings in this document.
			</p>
		);
	}
	const tree = buildOutlineTree(headings);
	return (
		<nav data-testid="markdown-outline" aria-label="Document outline" className="px-4 py-8">
			<ul>
				{tree.map((node) => (
					<OutlineRow key={node.entry.id} node={node} onSelect={onSelect} />
				))}
			</ul>
		</nav>
	);
}
