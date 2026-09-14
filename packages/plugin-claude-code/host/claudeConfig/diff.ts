export interface DiffLine {
	kind: "context" | "add" | "remove" | "gap";
	text: string;
}

const CONTEXT_LINES = 3;

/**
 * A line diff, so an edit can be read before it is written.
 *
 * The point is spotting what an edit *removed* — a generated config change that quietly drops a key is
 * exactly the failure this whole approval step exists to catch, and a summary sentence cannot show it.
 */
export function diffLines(before: string, after: string): DiffLine[] {
	const from = before === "" ? [] : before.split("\n");
	const to = after === "" ? [] : after.split("\n");
	const lcs = longestCommonSubsequence(from, to);

	const lines: DiffLine[] = [];
	let i = 0;
	let j = 0;
	for (const [fromIndex, toIndex] of lcs) {
		while (i < fromIndex) lines.push({ kind: "remove", text: from[i++] as string });
		while (j < toIndex) lines.push({ kind: "add", text: to[j++] as string });
		lines.push({ kind: "context", text: from[fromIndex] as string });
		i = fromIndex + 1;
		j = toIndex + 1;
	}
	while (i < from.length) lines.push({ kind: "remove", text: from[i++] as string });
	while (j < to.length) lines.push({ kind: "add", text: to[j++] as string });
	return elide(lines);
}

/** Collapse unchanged runs far from any change — `~/.claude.json` holds tokens; see SPEC.md. */
function elide(lines: DiffLine[]): DiffLine[] {
	const near = new Set<number>();
	lines.forEach((line, index) => {
		if (line.kind === "context") return;
		for (let at = index - CONTEXT_LINES; at <= index + CONTEXT_LINES; at += 1) near.add(at);
	});

	const out: DiffLine[] = [];
	let skipped = 0;
	const flush = () => {
		if (skipped === 0) return;
		out.push({ kind: "gap", text: `${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
		skipped = 0;
	};
	lines.forEach((line, index) => {
		if (near.has(index)) {
			flush();
			out.push(line);
			return;
		}
		skipped += 1;
	});
	flush();
	return out;
}

function longestCommonSubsequence(from: string[], to: string[]): [number, number][] {
	const table: number[][] = Array.from({ length: from.length + 1 }, () =>
		new Array<number>(to.length + 1).fill(0),
	);
	for (let i = from.length - 1; i >= 0; i -= 1) {
		for (let j = to.length - 1; j >= 0; j -= 1) {
			const row = table[i] as number[];
			const next = table[i + 1] as number[];
			row[j] =
				from[i] === to[j]
					? (next[j + 1] as number) + 1
					: Math.max(next[j] as number, row[j + 1] as number);
		}
	}
	const pairs: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < from.length && j < to.length) {
		if (from[i] === to[j]) {
			pairs.push([i, j]);
			i += 1;
			j += 1;
			continue;
		}
		const down = (table[i + 1] as number[])[j] as number;
		const right = (table[i] as number[])[j + 1] as number;
		if (down >= right) i += 1;
		else j += 1;
	}
	return pairs;
}

/**
 * Re-serialize JSON the way the file already writes it, so an edit shows as the lines it changed rather
 * than as a wholesale reformat — which would bury the one line that matters.
 */
export function formatJson(existing: string, value: unknown): string {
	const indentMatch = /\n([ \t]+)\S/.exec(existing);
	const indent = indentMatch?.[1] ?? "  ";
	const trailingNewline = existing === "" || existing.endsWith("\n");
	return `${JSON.stringify(value, null, indent)}${trailingNewline ? "\n" : ""}`;
}
