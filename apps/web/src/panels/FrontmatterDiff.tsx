import { type FrontmatterProperty, parseFrontmatter } from "@thinkrail/ui/markdown";
import { diffArrays, diffLines, diffWordsWithSpace } from "diff";
import type { ReactNode } from "react";

type Value = FrontmatterProperty["value"];

export interface FrontmatterDiffRow {
	key: string;
	state: "same" | "added" | "removed" | "changed";
	before?: Value;
	after?: Value;
}

export type FrontmatterDiffModel =
	| { kind: "rows"; rows: FrontmatterDiffRow[]; changed: boolean }
	| { kind: "raw"; before: string; after: string; changed: boolean };

function entries(value: Record<string, string>): string[] {
	return Object.entries(value).map(([key, item]) => `${key}: ${item}`);
}

function sameValue(left: Value, right: Value): boolean {
	if (typeof left === "string" || typeof right === "string") return left === right;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	const a = Array.isArray(left) ? left : entries(left);
	const b = Array.isArray(right) ? right : entries(right as Record<string, string>);
	return a.length === b.length && a.every((item, index) => item === b[index]);
}

function rows(before: FrontmatterProperty[], after: FrontmatterProperty[]): FrontmatterDiffRow[] {
	const beforeByKey = new Map(before.map((property) => [property.key, property.value]));
	const afterByKey = new Map(after.map((property) => [property.key, property.value]));
	const out: FrontmatterDiffRow[] = [];
	for (const part of diffArrays(
		before.map((property) => property.key),
		after.map((property) => property.key),
	)) {
		for (const key of part.value) {
			const prev = beforeByKey.get(key);
			const next = afterByKey.get(key);
			if (part.removed) {
				// A key that only moved is drawn once, where the new side has it.
				if (next === undefined && prev !== undefined) {
					out.push({ key, state: "removed", before: prev });
				}
			} else if (next !== undefined) {
				if (prev === undefined) out.push({ key, state: "added", after: next });
				else {
					out.push({
						key,
						state: sameValue(prev, next) ? "same" : "changed",
						before: prev,
						after: next,
					});
				}
			}
		}
	}
	return out;
}

/** What changed between two documents' frontmatter, or null when neither has any. See panels/SPEC.md. */
export function frontmatterDiff(before: string, after: string): FrontmatterDiffModel | null {
	const left = parseFrontmatter(before);
	const right = parseFrontmatter(after);
	if (!left && !right) return null;
	if ((left && !left.editable) || (right && !right.editable)) {
		const raw = { before: left?.raw ?? "", after: right?.raw ?? "" };
		return { kind: "raw", ...raw, changed: raw.before !== raw.after };
	}
	const list = rows(left?.properties ?? [], right?.properties ?? []);
	return { kind: "rows", rows: list, changed: list.some((row) => row.state !== "same") };
}

function Marked({
	parts,
	lines = false,
}: {
	parts: { value: string; added?: boolean; removed?: boolean }[];
	/** Each marked part is whole lines, drawn as its own row rather than run into its neighbour. */
	lines?: boolean;
}) {
	return parts.map((part, index) => {
		const key = `${index}:${part.value}`;
		if (!part.added && !part.removed) return <span key={key}>{part.value}</span>;
		const text = lines ? part.value.replace(/\n$/, "") : part.value;
		const className = lines ? "block" : undefined;
		return part.added ? (
			<ins key={key} className={className}>
				{text}
			</ins>
		) : (
			<del key={key} className={className}>
				{text}
			</del>
		);
	});
}

function Items({
	before,
	after,
	open,
	close,
}: {
	before: string[];
	after: string[];
	open: string;
	close: string;
}) {
	const items = diffArrays(before, after).flatMap((part) =>
		part.value.map((value) => ({ value, added: part.added, removed: part.removed })),
	);
	return (
		<>
			{open}
			{items.map((item, index) => {
				const key = `${index}:${item.value}`;
				const text = item.added ? (
					<ins data-testid="frontmatter-diff-item">{item.value}</ins>
				) : item.removed ? (
					<del data-testid="frontmatter-diff-item">{item.value}</del>
				) : (
					<span data-testid="frontmatter-diff-item">{item.value}</span>
				);
				return (
					<span key={key}>
						{index > 0 ? ", " : null}
						{text}
					</span>
				);
			})}
			{close}
		</>
	);
}

function plain(value: Value): ReactNode {
	if (typeof value === "string") return value;
	return Array.isArray(value) ? (
		<Items before={value} after={value} open="[" close="]" />
	) : (
		<Items before={entries(value)} after={entries(value)} open="{" close="}" />
	);
}

function ChangedValue({ before, after }: { before: Value; after: Value }) {
	if (typeof before === "string" && typeof after === "string") {
		return <Marked parts={diffWordsWithSpace(before, after)} />;
	}
	if (Array.isArray(before) && Array.isArray(after)) {
		return <Items before={before} after={after} open="[" close="]" />;
	}
	if (
		typeof before === "object" &&
		typeof after === "object" &&
		!Array.isArray(before) &&
		!Array.isArray(after)
	) {
		return <Items before={entries(before)} after={entries(after)} open="{" close="}" />;
	}
	// The value changed shape — a scalar became a list, say — so there is nothing finer to compare.
	return (
		<>
			<del>{plain(before)}</del> <ins>{plain(after)}</ins>
		</>
	);
}

function Row({ row }: { row: FrontmatterDiffRow }) {
	const value =
		row.state === "added" && row.after !== undefined ? (
			<ins>{plain(row.after)}</ins>
		) : row.state === "removed" && row.before !== undefined ? (
			<del>{plain(row.before)}</del>
		) : row.state === "changed" && row.before !== undefined && row.after !== undefined ? (
			<ChangedValue before={row.before} after={row.after} />
		) : row.after !== undefined ? (
			plain(row.after)
		) : null;
	return (
		<div
			data-testid="frontmatter-property"
			data-state={row.state}
			className="flex min-h-28 items-start gap-8 tr-code-text"
		>
			<span className="w-160 shrink-0 truncate text-text-muted">
				{row.state === "added" ? (
					<ins>{row.key}</ins>
				) : row.state === "removed" ? (
					<del>{row.key}</del>
				) : (
					row.key
				)}
			</span>
			<span className="min-w-0 flex-1 break-words text-text-default">{value}</span>
		</div>
	);
}

/**
 * The frontmatter of both sides as one properties table: a row per key, marked by what happened to it.
 * Compared as data rather than as rendered text, so a list changes by item and a renamed key reads as
 * one key leaving and another arriving.
 */
export function FrontmatterDiff({ model }: { model: FrontmatterDiffModel }) {
	return (
		<section
			data-testid="frontmatter-properties"
			data-changed={model.changed || undefined}
			className="mb-16 border-border-muted border-b pb-8"
		>
			<div className="tr-text-metadata text-text-subtle">Properties</div>
			{model.kind === "raw" ? (
				<pre className="mt-4 overflow-x-auto rounded-[var(--radius-sm)] bg-container-content-bg p-8 tr-code-text text-text-muted">
					<Marked parts={diffLines(model.before, model.after)} lines />
				</pre>
			) : (
				<div className="mt-4 flex flex-col">
					{model.rows.map((row) => (
						<Row key={`${row.state}:${row.key}`} row={row} />
					))}
				</div>
			)}
		</section>
	);
}
