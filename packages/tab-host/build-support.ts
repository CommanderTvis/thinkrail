import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const shim = (name: string) => fileURLToPath(new URL(`./src/node/${name}.ts`, import.meta.url));

function packageDir(from: string, name: string): string {
	for (let dir = from; ; dir = dirname(dir)) {
		const candidate = join(dir, "node_modules", name);
		if (existsSync(candidate)) return realpathSync(candidate);
		if (dirname(dir) === dir) throw new Error(`${name} is not installed above ${from}`);
	}
}

const piCodingAgent = packageDir(
	fileURLToPath(new URL("../spec-graph", import.meta.url)),
	"@earendil-works/pi-coding-agent",
);

/**
 * Node builtins as the tab-host worker sees them: the tab's own volume and browser stand-ins. Plus
 * `pi-coding-agent`, whose root loads host-only config: spec-graph's tools need only its truncation,
 * a dependency-free module, so the worker gets that file alone; anything else fails the build.
 */
export const TAB_HOST_NODE_SHIMS: Readonly<Record<string, string>> = Object.fromEntries([
	...["fs", "path", "events", "buffer", "stream", "url", "os", "zlib"].map((name) => [
		`node:${name}`,
		shim(name),
	]),
	...["fs", "path", "stream", "os"].map((name) => [name, shim(name)]),
	["node:fs/promises", shim("fs-promises")],
	["fs/promises", shim("fs-promises")],
	["@earendil-works/pi-coding-agent", join(piCodingAgent, "dist", "core", "tools", "truncate.js")],
]);

const packages = fileURLToPath(new URL("..", import.meta.url));

/**
 * Each builtin plugin's `assets` directory by plugin id, for a Playground build: no host serves
 * `/plugin/<id>/assets/`, so the build ships them at that path itself.
 */
export function builtinPluginAssets(): { id: string; dir: string }[] {
	return readdirSync(packages)
		.filter((name) => name.startsWith("plugin-") && name !== "plugin-api")
		.map((name) => ({ id: name.slice("plugin-".length), dir: join(packages, name, "assets") }))
		.filter(({ dir }) => existsSync(dir));
}
