import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { PluginRegistry } from "./registry";
import type { PluginHostSeams } from "./seams";
import { type PluginToolScope, pluginToolsExtension } from "./tools";

export interface PluginPiResources {
	factories: ExtensionFactory[];
	extensionPaths: string[];
	skillPaths: string[];
	childFactories: ExtensionFactory[];
	toolsExtension: ExtensionFactory;
}

const require = createRequire(import.meta.url);

interface PluginBuildSupport {
	assets?: string | null;
	pi?: { extensions: readonly { specifier: string; entry: string }[]; skills: readonly string[] };
}

function loadBuiltinBuildSupport(id: string): PluginBuildSupport {
	return (require(`@thinkrail/plugin-${id}/build-support`) as { buildSupport: PluginBuildSupport })
		.buildSupport;
}

export function devBuiltinAssetsDir(id: string): string | null {
	try {
		return loadBuiltinBuildSupport(id).assets ?? null;
	} catch {
		return null;
	}
}

export function pluginPiResources(
	registry: PluginRegistry,
	scope: () => PluginToolScope,
	bundledPluginRuntime: PluginHostSeams["bundledPluginRuntime"],
): PluginPiResources {
	const factories: ExtensionFactory[] = [];
	const extensionPaths: string[] = [];
	const skillPaths: string[] = [];
	const childFactories: ExtensionFactory[] = [];

	for (const entry of registry.all()) {
		if (entry.state !== "active" || !entry.manifest.pi) continue;
		const pi = entry.manifest.pi;

		if (entry.origin === "external" && entry.dir) {
			for (const specifier of pi.extensions) extensionPaths.push(resolve(entry.dir, specifier));
			for (const specifier of pi.skills) skillPaths.push(resolve(entry.dir, specifier));
			continue;
		}
		if (entry.origin !== "builtin") continue;

		const runtime = bundledPluginRuntime(entry.manifest.id);
		if (runtime.factories.length > 0 || runtime.skillsDir !== null) {
			factories.push(...runtime.factories);
			if (pi.reachesSubagents) childFactories.push(...runtime.factories);
			if (runtime.skillsDir) skillPaths.push(runtime.skillsDir);
			continue;
		}

		try {
			const buildSupport = loadBuiltinBuildSupport(entry.manifest.id);
			for (const extension of buildSupport.pi?.extensions ?? []) {
				extensionPaths.push(extension.entry);
				if (pi.reachesSubagents) {
					const loaded = require(extension.entry) as { default: ExtensionFactory };
					childFactories.push(loaded.default);
				}
			}
			for (const dir of buildSupport.pi?.skills ?? []) skillPaths.push(dir);
		} catch {}
	}

	return {
		factories,
		extensionPaths,
		skillPaths,
		childFactories,
		toolsExtension: pluginToolsExtension(registry, scope),
	};
}
