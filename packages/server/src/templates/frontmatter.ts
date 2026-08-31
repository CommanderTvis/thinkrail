export interface Frontmatter {
	keys: ReadonlyMap<string, string>;
	malformed: boolean;
}

const FENCE = "---";

const BLOCK_SCALAR = /^[>|][-+0-9]*$/;

export function readFrontmatter(text: string): Frontmatter {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	if (lines[0]?.trim() !== FENCE) return { keys: new Map(), malformed: false };
	const keys = new Map<string, string>();
	for (let i = 1; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		if (line.trim() === FENCE) return { keys, malformed: false };
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		if (key.length === 0 || value.length === 0 || BLOCK_SCALAR.test(value)) continue;
		keys.set(key, unquote(value));
	}
	return { keys: new Map(), malformed: true };
}

function unquote(value: string): string {
	const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
	return quoted?.[1] ?? value;
}
