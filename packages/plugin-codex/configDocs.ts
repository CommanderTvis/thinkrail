import { CODEX_CONFIG_DOCS_URL, CODEX_CONFIG_KEYS } from "./configKeys";

function documentedAncestor(key: string): string | undefined {
	let candidate = key;
	while (!(candidate in CODEX_CONFIG_KEYS)) {
		const cut = candidate.lastIndexOf(".");
		if (cut === -1) return undefined;
		candidate = candidate.slice(0, cut);
	}
	return candidate;
}

export function codexDocsUrl(key: string): string | undefined {
	const documented = documentedAncestor(key);
	if (!documented) return undefined;
	const type = CODEX_CONFIG_KEYS[documented]?.split(/[\s|<(]/)[0] ?? "";
	const suffix = type ? `,-${encodeURIComponent(type)}` : "";
	return `${CODEX_CONFIG_DOCS_URL}#:~:text=${encodeURIComponent(documented)}${suffix}`;
}

export function codexEnumValues(key: string): readonly string[] | undefined {
	const type = CODEX_CONFIG_KEYS[key];
	if (!type) return undefined;
	const values = type
		.split(" | ")
		.map((part) => part.trim())
		.filter((part) => /^[a-z0-9_-]+$/.test(part) && part !== "string" && part !== "boolean");
	return values.length >= 2 ? values : undefined;
}

export function codexValueShape(key: string): "text" | "number" | "switch" | "list" | undefined {
	const type = CODEX_CONFIG_KEYS[key];
	if (!type || codexEnumValues(key)) return undefined;
	if (type.startsWith("boolean")) return "switch";
	if (type.startsWith("number") || type.startsWith("integer")) return "number";
	if (type.startsWith("array<string>")) return "list";
	if (type.startsWith("string")) return "text";
	return undefined;
}

export const CODEX_ADDABLE_KEYS: readonly string[] = Object.keys(CODEX_CONFIG_KEYS).filter(
	(key) =>
		!key.includes("<") &&
		(codexEnumValues(key) !== undefined || codexValueShape(key) !== undefined),
);
