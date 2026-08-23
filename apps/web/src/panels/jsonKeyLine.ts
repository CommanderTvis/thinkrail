export function jsonKeyLine(text: string, keyPath: readonly string[]): number | null {
	if (keyPath.length === 0) return null;
	let i = 0;

	const isSpace = (ch: string): boolean => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

	const skipSpace = (): void => {
		while (i < text.length && isSpace(text[i] as string)) i++;
	};

	const readString = (): string | null => {
		if (text[i] !== '"') return null;
		i++;
		let out = "";
		while (i < text.length) {
			const ch = text[i] as string;
			if (ch === "\\") {
				const next = text[i + 1];
				if (next === undefined) return null;
				if (next === "u") {
					out += String.fromCharCode(Number.parseInt(text.slice(i + 2, i + 6), 16));
					i += 6;
					continue;
				}
				out += ESCAPES[next] ?? next;
				i += 2;
				continue;
			}
			if (ch === '"') {
				i++;
				return out;
			}
			out += ch;
			i++;
		}
		return null;
	};

	const skipValue = (): void => {
		skipSpace();
		const ch = text[i];
		if (ch === '"') {
			readString();
			return;
		}
		if (ch === "{" || ch === "[") {
			let depth = 0;
			while (i < text.length) {
				const c = text[i] as string;
				if (c === '"') {
					if (readString() === null) return;
					continue;
				}
				if (c === "{" || c === "[") depth++;
				else if (c === "}" || c === "]") {
					depth--;
					if (depth === 0) {
						i++;
						return;
					}
				}
				i++;
			}
			return;
		}
		while (i < text.length) {
			const c = text[i] as string;
			if (c === "," || c === "}" || c === "]" || isSpace(c)) return;
			i++;
		}
	};

	const findInObject = (depth: number): number | null => {
		if (text[i] !== "{") return null;
		i++;
		while (i < text.length) {
			skipSpace();
			const ch = text[i];
			if (ch === "}") {
				i++;
				return null;
			}
			if (ch === ",") {
				i++;
				continue;
			}
			if (ch !== '"') return null;
			const keyStart = i;
			const key = readString();
			if (key === null) return null;
			skipSpace();
			if (text[i] !== ":") return null;
			i++;
			skipSpace();
			if (key !== keyPath[depth]) {
				skipValue();
				continue;
			}
			if (depth === keyPath.length - 1) return lineOf(text, keyStart);
			if (text[i] !== "{") {
				skipValue();
				continue;
			}
			const found = findInObject(depth + 1);
			if (found !== null) return found;
		}
		return null;
	};

	skipSpace();
	return findInObject(0);
}

const ESCAPES: Record<string, string> = {
	b: "\b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "\t",
};

function lineOf(text: string, index: number): number {
	let line = 1;
	for (let k = 0; k < index; k++) if (text.charCodeAt(k) === 10) line++;
	return line;
}
