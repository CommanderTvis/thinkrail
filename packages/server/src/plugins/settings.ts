import type { PluginSettingsNamespace } from "@thinkrail/contracts";
import type { TObject } from "typebox";
import { Value } from "typebox/value";

export type NamespaceValidation =
	| { namespaces: Record<string, PluginSettingsNamespace> }
	| { refused: string };

export function validatePluginNamespaces(
	update: Record<string, PluginSettingsNamespace | null>,
	current: Record<string, PluginSettingsNamespace>,
	schemaFor: (id: string) => TObject | undefined,
): NamespaceValidation {
	const next: Record<string, PluginSettingsNamespace> = { ...current };
	for (const [id, patch] of Object.entries(update)) {
		if (patch === null) {
			next[id] = {};
			continue;
		}
		const merged: PluginSettingsNamespace = { ...next[id], ...patch };
		const schema = schemaFor(id);
		if (!schema) {
			next[id] = merged;
			continue;
		}
		const { enabled, ...rest } = merged;
		if (!Value.Check(schema, rest)) {
			const [first] = Value.Errors(schema, rest);
			return {
				refused: `plugin ${id} settings ${first?.instancePath || "value"}: ${first?.message ?? "is invalid"}`,
			};
		}
		next[id] = {
			...(enabled !== undefined ? { enabled } : {}),
			...(Value.Default(schema, rest) as Omit<PluginSettingsNamespace, "enabled">),
		};
	}
	return { namespaces: next };
}

export function cascadeDisable(
	update: Record<string, PluginSettingsNamespace | null>,
	roster: readonly { id: string; dependsOn: readonly string[] }[],
): Record<string, PluginSettingsNamespace | null> {
	const dependentsOf = new Map<string, string[]>();
	for (const entry of roster) {
		for (const dep of entry.dependsOn) {
			const list = dependentsOf.get(dep);
			if (list) list.push(entry.id);
			else dependentsOf.set(dep, [entry.id]);
		}
	}
	const result: Record<string, PluginSettingsNamespace | null> = { ...update };
	const seen = new Set<string>();
	const queue: string[] = [];
	for (const [id, patch] of Object.entries(update)) {
		if (patch !== null && patch.enabled === false && !seen.has(id)) {
			seen.add(id);
			queue.push(id);
		}
	}
	while (queue.length > 0) {
		const id = queue.shift();
		if (id === undefined) break;
		for (const dependent of dependentsOf.get(id) ?? []) {
			if (seen.has(dependent)) continue;
			seen.add(dependent);
			queue.push(dependent);
			const currentPatch = result[dependent];
			result[dependent] =
				currentPatch === null || currentPatch === undefined
					? { enabled: false }
					: { ...currentPatch, enabled: false };
		}
	}
	return result;
}
