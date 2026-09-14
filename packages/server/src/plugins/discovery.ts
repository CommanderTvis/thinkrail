import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginManifest } from "@thinkrail/plugin-api";
import { validateManifest } from "./manifest";

const MANIFEST_FILE = "thinkrail-plugin.json";

export interface DiscoveredPlugin {
	dir: string;
	manifest?: PluginManifest;
	refused?: string;
}

export function discoverExternalPlugins(roots: readonly string[]): DiscoveredPlugin[] {
	const discovered: DiscoveredPlugin[] = [];
	for (const root of roots) {
		let names: string[];
		try {
			names = readdirSync(root);
		} catch {
			continue;
		}
		for (const name of names) {
			const dir = join(root, name);
			let stat: ReturnType<typeof lstatSync>;
			try {
				stat = lstatSync(dir);
			} catch {
				continue;
			}
			if (stat.isSymbolicLink()) {
				discovered.push({ dir, refused: `plugin directory must not be a symlink: ${dir}` });
				continue;
			}
			if (!stat.isDirectory()) continue;
			const manifestPath = join(dir, MANIFEST_FILE);
			let raw: unknown;
			try {
				raw = JSON.parse(readFileSync(manifestPath, "utf8"));
			} catch (err) {
				discovered.push({
					dir,
					refused: `cannot read ${MANIFEST_FILE}: ${(err as Error).message}`,
				});
				continue;
			}
			const result = validateManifest(raw, "external", name);
			if ("refused" in result) discovered.push({ dir, refused: result.refused });
			else discovered.push({ dir, manifest: result.manifest });
		}
	}
	return discovered;
}
