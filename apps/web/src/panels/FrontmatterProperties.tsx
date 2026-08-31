import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiListUnordered as ListIcon,
	RiBracesLine as MappingIcon,
	RiAddLine as Plus,
	RiText as TextIcon,
	RiCloseLine as X,
} from "@remixicon/react";
import { useId, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type FrontmatterProperty, parseFrontmatter, withFrontmatter } from "./frontmatter";
import { SPEC_TYPES } from "./specTree";

type ValueShape = "text" | "sequence" | "mapping";

function shapeOf(value: FrontmatterProperty["value"]): ValueShape {
	if (Array.isArray(value)) return "sequence";
	return typeof value === "object" ? "mapping" : "text";
}

/**
 * Shape conversions, loss-visible rather than lossless: a structure becomes its inline reading as text,
 * a text becomes one item, mapping ⇄ sequence goes through `key: value` items so a round trip survives.
 */
function convertedValue(
	value: FrontmatterProperty["value"],
	to: ValueShape,
): FrontmatterProperty["value"] {
	const from = shapeOf(value);
	if (from === to) return value;
	if (to === "text") {
		if (Array.isArray(value)) return `[${value.join(", ")}]`;
		return typeof value === "object"
			? `{${Object.entries(value)
					.map(([key, item]) => `${key}: ${item}`)
					.join(", ")}}`
			: value;
	}
	if (to === "sequence") {
		if (typeof value === "object" && !Array.isArray(value)) {
			return Object.entries(value).map(([key, item]) => `${key}: ${item}`);
		}
		const text = value as string;
		return text.trim() === "" ? [] : [text];
	}
	const items = Array.isArray(value)
		? value
		: (value as string).trim() === ""
			? []
			: [value as string];
	const pairs = items.map((item, at): [string, string] => {
		const split = item.indexOf(": ");
		return split > 0 ? [item.slice(0, split), item.slice(split + 2)] : [String(at + 1), item];
	});
	const unique = new Set(pairs.map(([key]) => key)).size === pairs.length;
	return Object.fromEntries(
		unique ? pairs : items.map((item, at): [string, string] => [String(at + 1), item]),
	);
}

function MappingValue({
	entries,
	onCommit,
}: {
	entries: Record<string, string>;
	onCommit: (next: Record<string, string>) => void;
}) {
	const pairs = Object.entries(entries);
	const renameKey = (at: number, key: string) => {
		const trimmed = key.trim();
		if (!trimmed || pairs.some(([existing], index) => index !== at && existing === trimmed)) return;
		onCommit(
			Object.fromEntries(pairs.map(([k, v], index) => (index === at ? [trimmed, v] : [k, v]))),
		);
	};
	const setValue = (at: number, value: string) =>
		onCommit(
			Object.fromEntries(pairs.map(([k, v], index) => (index === at ? [k, value] : [k, v]))),
		);
	const add = () => {
		let key = "key";
		let suffix = 1;
		while (entries[key] !== undefined) {
			suffix += 1;
			key = `key-${suffix}`;
		}
		onCommit({ ...entries, [key]: "" });
	};
	return (
		<div className="flex min-w-0 flex-1 flex-col py-2">
			{pairs.map(([key, value], index) => (
				<div key={index} className="flex min-w-0 items-start gap-8">
					<div className="w-120 shrink-0 [&_input]:text-text-muted">
						<TextValue
							value={key}
							onCommit={(next) => renameKey(index, next)}
							testid="frontmatter-map-key"
						/>
					</div>
					<TextValue
						value={value}
						onCommit={(next) => setValue(index, next)}
						testid="frontmatter-map-value"
					/>
					<button
						type="button"
						data-testid="frontmatter-map-remove"
						aria-label={`Remove entry ${key}`}
						onClick={() => onCommit(Object.fromEntries(pairs.filter((_, at) => at !== index)))}
						className="shrink-0 rounded-[var(--radius-sm)] p-2 text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
					>
						<X className="size-14" />
					</button>
				</div>
			))}
			<button
				type="button"
				data-testid="frontmatter-map-add"
				onClick={add}
				className="flex w-fit items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 tr-text-metadata text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
			>
				<Plus className="size-14" />
				Add entry
			</button>
		</div>
	);
}

/** Suggestions, not constraints: the doc may use any vocabulary, but a spec node's is known. */
const VALUE_SUGGESTIONS: Record<string, readonly string[]> = {
	type: SPEC_TYPES,
	status: ["draft", "active", "stale", "done", "deprecated"],
};

function TextValue({
	value,
	onCommit,
	testid,
	suggestions,
}: {
	value: string;
	onCommit: (next: string) => void;
	testid: string;
	suggestions?: readonly string[] | undefined;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const listId = useId();
	return (
		<>
			<input
				data-testid={testid}
				value={draft ?? value}
				list={suggestions ? listId : undefined}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => {
					if (draft !== null && draft !== value) onCommit(draft);
					setDraft(null);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
					if (event.key === "Escape") {
						setDraft(null);
						event.currentTarget.blur();
					}
				}}
				className="w-full min-w-0 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-4 py-2 tr-text-ui text-text-default outline-none hover:border-border-default focus:border-control-border-active"
			/>
			{suggestions ? (
				<datalist id={listId}>
					{suggestions.map((option) => (
						<option key={option} value={option} />
					))}
				</datalist>
			) : null}
		</>
	);
}

function ListValue({ items, onCommit }: { items: string[]; onCommit: (next: string[]) => void }) {
	const [draft, setDraft] = useState("");
	const add = () => {
		const value = draft.trim();
		if (!value) return;
		onCommit([...items, value]);
		setDraft("");
	};
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-4 py-2">
			{items.map((item, index) => (
				<span
					key={`${index}-${item}`}
					data-testid="frontmatter-list-item"
					className="inline-flex max-w-full items-center gap-2 rounded-full bg-control-bg px-8 py-2 tr-text-metadata text-text-default"
				>
					<span className="truncate">{item}</span>
					<button
						type="button"
						aria-label={`Remove ${item}`}
						onClick={() => onCommit(items.filter((_, at) => at !== index))}
						className="shrink-0 rounded-full text-text-muted hover:text-text-default"
					>
						<X className="size-12" />
					</button>
				</span>
			))}
			<input
				data-testid="frontmatter-list-add"
				value={draft}
				placeholder="Add…"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={add}
				onKeyDown={(event) => {
					if (event.key === "Enter") add();
					if (event.key === "Escape") setDraft("");
				}}
				className="w-64 min-w-0 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-4 py-2 tr-text-metadata text-text-default outline-none placeholder:text-text-subtle hover:border-border-default focus:border-control-border-active"
			/>
		</div>
	);
}

/**
 * The document's frontmatter as an Obsidian-style properties table above the rendered view. Text and
 * lists only; a block using shapes this editor does not speak renders read-only. See SPEC.md.
 */
export function FrontmatterProperties({
	content,
	onEdit,
}: {
	content: string;
	onEdit: (next: string) => void;
}) {
	const [open, setOpen] = useState(true);
	const block = parseFrontmatter(content);
	if (!block) return null;
	const { properties, editable } = block;

	const commit = (next: FrontmatterProperty[]) => onEdit(withFrontmatter(content, next));
	const setValue = (index: number, value: FrontmatterProperty["value"]) =>
		commit(properties.map((property, at) => (at === index ? { ...property, value } : property)));
	// Picking the shape a row already has changes nothing — not even the block's formatting.
	const convert = (index: number, to: ValueShape) => {
		const value = properties[index]?.value;
		if (value === undefined || shapeOf(value) === to) return;
		setValue(index, convertedValue(value, to));
	};
	const renameKey = (index: number, key: string) => {
		const trimmed = key.trim();
		// A duplicate key would make the document say two things at once; the rename is simply refused.
		if (!trimmed || properties.some((property, at) => at !== index && property.key === trimmed))
			return;
		commit(
			properties.map((property, at) => (at === index ? { ...property, key: trimmed } : property)),
		);
	};
	const addProperty = () => {
		let key = "property";
		let suffix = 1;
		while (properties.some((property) => property.key === key)) {
			suffix += 1;
			key = `property-${suffix}`;
		}
		commit([...properties, { key, value: "" }]);
	};

	const Chevron = open ? ChevronDown : ChevronRight;
	return (
		<section
			data-testid="frontmatter-properties"
			className="border-border-muted border-b bg-container-workspace-bg"
		>
			<div className="mx-auto max-w-[78ch] px-24 py-8">
				<button
					type="button"
					data-testid="frontmatter-toggle"
					aria-expanded={open}
					onClick={() => setOpen((current) => !current)}
					className="flex items-center gap-4 tr-text-metadata text-text-subtle hover:text-text-default"
				>
					<Chevron className="size-14" />
					Properties
				</button>
				{open && !editable ? (
					<pre className="mt-4 overflow-x-auto rounded-[var(--radius-sm)] bg-container-content-bg p-8 tr-code-text text-text-muted">
						{block.raw}
					</pre>
				) : null}
				{open && editable ? (
					<div className="mt-4 flex flex-col">
						{properties.map((property, index) => (
							<div
								key={property.key}
								data-testid="frontmatter-property"
								className="flex min-h-28 items-start gap-8"
							>
								<DropdownMenu>
									<DropdownMenuTrigger
										data-testid="frontmatter-type"
										data-value-type={shapeOf(property.value)}
										aria-label={`Change type of ${property.key}`}
										title="Property type"
										className="mt-4 shrink-0 rounded-[var(--radius-sm)] p-2 text-text-subtle outline-none hover:bg-control-bg-hovered hover:text-text-default"
									>
										{shapeOf(property.value) === "sequence" ? (
											<ListIcon className="size-14" />
										) : shapeOf(property.value) === "mapping" ? (
											<MappingIcon className="size-14" />
										) : (
											<TextIcon className="size-14" />
										)}
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start">
										<DropdownMenuItem
											data-testid="frontmatter-type-text"
											onSelect={() => convert(index, "text")}
										>
											<TextIcon className="size-14" /> Text
										</DropdownMenuItem>
										<DropdownMenuItem
											data-testid="frontmatter-type-sequence"
											onSelect={() => convert(index, "sequence")}
										>
											<ListIcon className="size-14" /> Sequence
										</DropdownMenuItem>
										<DropdownMenuItem
											data-testid="frontmatter-type-mapping"
											onSelect={() => convert(index, "mapping")}
										>
											<MappingIcon className="size-14" /> Mapping
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
								<div className="w-160 shrink-0 [&_input]:text-text-muted">
									<TextValue
										value={property.key}
										onCommit={(next) => renameKey(index, next)}
										testid="frontmatter-key"
									/>
								</div>
								{Array.isArray(property.value) ? (
									<ListValue items={property.value} onCommit={(next) => setValue(index, next)} />
								) : typeof property.value === "object" ? (
									<MappingValue
										entries={property.value}
										onCommit={(next) => setValue(index, next)}
									/>
								) : (
									<TextValue
										value={property.value}
										onCommit={(next) => setValue(index, next)}
										testid="frontmatter-value"
										suggestions={VALUE_SUGGESTIONS[property.key]}
									/>
								)}
								<button
									type="button"
									data-testid="frontmatter-remove"
									aria-label={`Remove property ${property.key}`}
									onClick={() => commit(properties.filter((_, at) => at !== index))}
									className="shrink-0 rounded-[var(--radius-sm)] p-2 text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
								>
									<X className="size-14" />
								</button>
							</div>
						))}
						<button
							type="button"
							data-testid="frontmatter-add"
							onClick={addProperty}
							className="mt-2 flex w-fit items-center gap-4 rounded-[var(--radius-sm)] px-4 py-2 tr-text-metadata text-text-subtle hover:bg-control-bg-hovered hover:text-text-default"
						>
							<Plus className="size-14" />
							Add property
						</button>
					</div>
				) : null}
			</div>
		</section>
	);
}
