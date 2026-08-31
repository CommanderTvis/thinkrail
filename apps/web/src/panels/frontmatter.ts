export interface FrontmatterProperty {
	key: string;
	value: string | string[] | Record<string, string>;
}

export interface FrontmatterBlock {
	properties: FrontmatterProperty[];
	/** The block's inner text as written; what the read-only fallback shows. */
	raw: string;
	/** False when the YAML uses shapes this editor does not speak — the block renders read-only. */
	editable: boolean;
}

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const KEY = /^([A-Za-z0-9_][A-Za-z0-9_ ./-]*):(.*)$/;
const LIST_ITEM = /^[ \t]+-[ \t]?(.*)$/;
const MAP_ITEM = /^[ \t]+([A-Za-z0-9_][A-Za-z0-9_ ./-]*):(.*)$/;

function isQuoted(text: string): boolean {
	return /^".*"$/.test(text) || /^'.*'$/.test(text);
}

function parseScalar(text: string): string {
	const trimmed = text.trim();
	const quoted = /^"(.*)"$/.exec(trimmed) ?? /^'(.*)'$/.exec(trimmed);
	if (!quoted) return trimmed;
	const inner = quoted[1] ?? "";
	return trimmed.startsWith('"') ? inner.replace(/\\"/g, '"') : inner.replace(/''/g, "'");
}

function parseInlineList(text: string): string[] | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
	const inner = trimmed.slice(1, -1).trim();
	if (inner.includes("[") || inner.includes("{")) return null;
	if (inner === "") return [];
	return inner.split(",").map(parseScalar);
}

/**
 * The properties a document opens with, or null when it has no frontmatter at all. Only the shapes the
 * editor can round-trip parse as editable — top-level `key: scalar`, `key: [a, b]`, a block list of
 * scalars, and a one-level mapping of scalars; anything else (deeper nesting, multiline strings,
 * anchors) keeps the whole block read-only rather than risking a rewrite that drops what it did not
 * understand. See SPEC.md.
 */
export function parseFrontmatter(content: string): FrontmatterBlock | null {
	const open = OPEN.exec(content);
	if (!open) return null;
	const rest = content.slice(open[0].length);
	const lines = rest.split(/\r?\n/);
	const closeIndex = lines.findIndex((line) => CLOSE.test(line));
	if (closeIndex < 0) return null;
	const body = lines.slice(0, closeIndex);
	const raw = body.join("\n");

	const properties: FrontmatterProperty[] = [];
	for (let index = 0; index < body.length; index += 1) {
		const line = body[index] ?? "";
		if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
		const match = KEY.exec(line);
		if (!match) return { properties: [], raw, editable: false };
		const key = (match[1] ?? "").trim();
		const after = match[2] ?? "";
		if (after.trim() === "") {
			const items: string[] = [];
			let cursor = index + 1;
			while (cursor < body.length) {
				const item = LIST_ITEM.exec(body[cursor] ?? "");
				if (!item) break;
				const itemText = (item[1] ?? "").trim();
				if (!isQuoted(itemText) && itemText.includes(": "))
					return { properties: [], raw, editable: false };
				items.push(parseScalar(itemText));
				cursor += 1;
			}
			if (items.length > 0) {
				properties.push({ key, value: items });
				index = cursor - 1;
				continue;
			}
			// One level of `sub: scalar` lines is a mapping; anything deeper keeps the block read-only.
			const entries: [string, string][] = [];
			while (cursor < body.length) {
				const entry = MAP_ITEM.exec(body[cursor] ?? "");
				if (!entry) break;
				const subKey = (entry[1] ?? "").trim();
				const subAfter = (entry[2] ?? "").trim();
				if (
					subAfter === "" ||
					entries.some(([existing]) => existing === subKey) ||
					(!isQuoted(subAfter) &&
						(subAfter.includes(": ") || subAfter.startsWith("{") || subAfter.startsWith("&")))
				)
					return { properties: [], raw, editable: false };
				entries.push([subKey, parseScalar(subAfter)]);
				cursor += 1;
			}
			// A bare `key:` with no items is an empty value, not a structure.
			properties.push({
				key,
				value: entries.length > 0 ? Object.fromEntries(entries) : "",
			});
			index = cursor - 1;
			continue;
		}
		const inline = parseInlineList(after);
		if (inline) {
			properties.push({ key, value: inline });
			continue;
		}
		const scalar = after.trim();
		if (
			!isQuoted(scalar) &&
			(scalar.includes(": ") || scalar.startsWith("{") || scalar.startsWith("&"))
		)
			return { properties: [], raw, editable: false };
		properties.push({ key, value: parseScalar(after) });
	}
	return { properties, raw, editable: true };
}

function serializeScalar(value: string): string {
	if (value === "") return '""';
	const needsQuoting =
		/^[\s>|&*?#@`'"%{}[\],-]|[:#]\s|\s$|^\s/.test(value) ||
		value.includes("\n") ||
		/^(true|false|null|~|yes|no)$/i.test(value);
	return needsQuoting ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;
}

export function serializeFrontmatter(properties: readonly FrontmatterProperty[]): string {
	return properties
		.map((property) => {
			if (Array.isArray(property.value)) {
				return [
					`${property.key}:`,
					...property.value.map((item) => `  - ${serializeScalar(item)}`),
				].join("\n");
			}
			if (typeof property.value === "object") {
				return [
					`${property.key}:`,
					...Object.entries(property.value).map(
						([subKey, subValue]) => `  ${subKey}: ${serializeScalar(subValue)}`,
					),
				].join("\n");
			}
			return `${property.key}: ${serializeScalar(property.value)}`;
		})
		.join("\n");
}

/** The document with its frontmatter replaced (or created, when it had none and gains properties). */
export function withFrontmatter(
	content: string,
	properties: readonly FrontmatterProperty[],
): string {
	const serialized = serializeFrontmatter(properties);
	const open = OPEN.exec(content);
	if (!open) {
		if (properties.length === 0) return content;
		return `---\n${serialized}\n---\n\n${content}`;
	}
	const rest = content.slice(open[0].length);
	const lines = rest.split(/\r?\n/);
	const closeIndex = lines.findIndex((line) => CLOSE.test(line));
	if (closeIndex < 0) return content;
	const after = lines.slice(closeIndex + 1).join("\n");
	if (properties.length === 0) return after.replace(/^\r?\n/, "");
	return `---\n${serialized}\n---\n${after}`;
}
