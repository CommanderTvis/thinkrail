import type { ClaudeConfigOrigin, ClaudeSettingValue } from "@thinkrail/contracts";
import { isObject } from "./json";

export interface ScopedDocument {
	origin: ClaudeConfigOrigin;
	data: Record<string, unknown>;
}

export interface FlatValue {
	value: unknown;
	keyPath: readonly string[];
}

export function flatten(
	data: Record<string, unknown>,
	prefix: readonly string[] = [],
	out: Map<string, FlatValue> = new Map(),
): Map<string, FlatValue> {
	for (const [key, value] of Object.entries(data)) {
		const keyPath = [...prefix, key];
		if (isObject(value)) flatten(value, keyPath, out);
		else out.set(keyPath.join("."), { value, keyPath });
	}
	return out;
}

const UNIONED =
	/^(permissions\.(allow|deny|ask|additionalDirectories)|deniedMcpServers|.*\.(allowedDomains|deniedDomains))$/;

export function isUnionKey(key: string): boolean {
	return UNIONED.test(key);
}

export function resolveSettings(documents: readonly ScopedDocument[]): ClaudeSettingValue[] {
	const flattened = documents.map((doc) => ({ origin: doc.origin, values: flatten(doc.data) }));
	const keys = new Set<string>();
	for (const doc of flattened) for (const key of doc.values.keys()) keys.add(key);

	const located = (
		doc: { origin: ClaudeConfigOrigin; values: Map<string, FlatValue> },
		key: string,
	): ClaudeConfigOrigin => {
		const keyPath = doc.values.get(key)?.keyPath;
		return keyPath ? { ...doc.origin, keyPath } : doc.origin;
	};

	const resolved: ClaudeSettingValue[] = [];
	for (const key of [...keys].sort()) {
		const present = flattened.filter((doc) => doc.values.has(key));
		const first = present[0];
		if (!first) continue;

		const shadowed = present.slice(1).map((doc) => ({
			value: doc.values.get(key)?.value,
			origin: located(doc, key),
		}));

		if (isUnionKey(key) && present.every((doc) => Array.isArray(doc.values.get(key)?.value))) {
			const merged: unknown[] = [];
			for (const doc of present) {
				for (const entry of doc.values.get(key)?.value as unknown[]) {
					if (!merged.some((seen) => seen === entry)) merged.push(entry);
				}
			}
			resolved.push({ key, value: merged, origin: located(first, key), shadowed });
			continue;
		}

		resolved.push({
			key,
			value: first.values.get(key)?.value,
			origin: located(first, key),
			shadowed,
		});
	}
	return resolved;
}
