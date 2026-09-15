export interface MergeResult {
	text: string;
	conflicts: number;
}

interface Hunk {
	/** Half-open range of base lines this side replaced. */
	start: number;
	end: number;
	lines: string[];
}

function lines(text: string): string[] {
	return text.split("\n");
}

/**
 * Longest common subsequence as index pairs, the usual dynamic-programming table over lines — flat, so
 * every read is a plain number and the table costs one allocation.
 */
function commonPairs(a: string[], b: string[]): Array<[number, number]> {
	const width = b.length + 1;
	const table = new Int32Array((a.length + 1) * width);
	const at = (row: number, column: number): number => table[row * width + column] ?? 0;
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i * width + j] =
				a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
		}
	}
	const pairs: Array<[number, number]> = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (at(i + 1, j) >= at(i, j + 1)) i++;
		else j++;
	}
	return pairs;
}

/** What one side did to the base, as replacements of base line ranges. */
function hunksAgainstBase(base: string[], side: string[]): Hunk[] {
	const hunks: Hunk[] = [];
	let baseCursor = 0;
	let sideCursor = 0;
	const push = (baseEnd: number, sideEnd: number) => {
		if (baseEnd === baseCursor && sideEnd === sideCursor) return;
		hunks.push({ start: baseCursor, end: baseEnd, lines: side.slice(sideCursor, sideEnd) });
	};
	for (const [baseIndex, sideIndex] of commonPairs(base, side)) {
		push(baseIndex, sideIndex);
		baseCursor = baseIndex + 1;
		sideCursor = sideIndex + 1;
	}
	push(base.length, side.length);
	return hunks;
}

const OURS_MARKER = "<<<<<<< your edits";
const BASE_MARKER = "=======";
const THEIRS_MARKER = ">>>>>>> on disk";

function sameLines(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((line, index) => line === b[index]);
}

/**
 * Three-way line merge. Each side is reduced to the base ranges it replaced; ranges only one side touched
 * are applied, ranges both touched are one copy when they agree and conflict markers when they do not.
 * Ranges that merely *touch* do not overlap, so edits on adjacent lines still merge. See lib/SPEC.md.
 */
export function mergeText(base: string, ours: string, theirs: string): MergeResult {
	if (ours === theirs) return { text: ours, conflicts: 0 };
	if (base === ours) return { text: theirs, conflicts: 0 };
	if (base === theirs) return { text: ours, conflicts: 0 };

	const baseLines = lines(base);
	const ourHunks = hunksAgainstBase(baseLines, lines(ours));
	const theirHunks = hunksAgainstBase(baseLines, lines(theirs));

	const out: string[] = [];
	let conflicts = 0;
	let cursor = 0;
	let o = 0;
	let t = 0;

	while (o < ourHunks.length || t < theirHunks.length) {
		const next = Math.min(
			ourHunks[o]?.start ?? Number.MAX_SAFE_INTEGER,
			theirHunks[t]?.start ?? Number.MAX_SAFE_INTEGER,
		);
		out.push(...baseLines.slice(cursor, next));

		let end = next;
		const ourGroup: Hunk[] = [];
		const theirGroup: Hunk[] = [];
		const reaches = (hunk: Hunk | undefined): hunk is Hunk =>
			hunk !== undefined && (hunk.start === next || hunk.start < end);
		let grew = true;
		while (grew) {
			grew = false;
			for (let hunk = ourHunks[o]; reaches(hunk); hunk = ourHunks[o]) {
				ourGroup.push(hunk);
				end = Math.max(end, hunk.end);
				o++;
				grew = true;
			}
			for (let hunk = theirHunks[t]; reaches(hunk); hunk = theirHunks[t]) {
				theirGroup.push(hunk);
				end = Math.max(end, hunk.end);
				t++;
				grew = true;
			}
		}

		const apply = (group: Hunk[]): string[] => {
			const result: string[] = [];
			let at = next;
			for (const hunk of group) {
				result.push(...baseLines.slice(at, hunk.start), ...hunk.lines);
				at = hunk.end;
			}
			result.push(...baseLines.slice(at, end));
			return result;
		};

		const ourText = apply(ourGroup);
		const theirText = apply(theirGroup);
		if (sameLines(ourText, theirText)) out.push(...ourText);
		else if (theirGroup.length === 0) out.push(...ourText);
		else if (ourGroup.length === 0) out.push(...theirText);
		else {
			conflicts++;
			out.push(OURS_MARKER, ...ourText, BASE_MARKER, ...theirText, THEIRS_MARKER);
		}
		cursor = end;
	}
	out.push(...baseLines.slice(cursor));

	return { text: out.join("\n"), conflicts };
}

export function hasConflictMarkers(text: string): boolean {
	return text.split("\n").some((line) => line === OURS_MARKER || line === THEIRS_MARKER);
}
