import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginHostModule } from "@thinkrail/plugin-api/host";

const CONTENT_TYPES: Record<string, string> = {
	".js": "text/javascript",
	".mjs": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".map": "application/json",
};

function contentTypeFor(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot === -1
		? "application/octet-stream"
		: (CONTENT_TYPES[path.slice(dot)] ?? "application/octet-stream");
}

function resolvePathWithin(dir: string, subpath: string): string | null {
	const root = resolve(dir);
	const target = resolve(root, subpath.replace(/^\/+/, ""));
	if (target !== root && !target.startsWith(`${root}${sep}`)) return null;
	return target;
}

export async function importExternalHost(dir: string, entry: string): Promise<PluginHostModule> {
	const fullPath = join(dir, entry);
	const contentHash = createHash("sha256")
		.update(readFileSync(fullPath))
		.digest("hex")
		.slice(0, 16);
	const moduleUrl = `${pathToFileURL(fullPath).href}?v=${contentHash}`;
	const imported = (await import(moduleUrl)) as { default: PluginHostModule };
	return imported.default;
}

export function serveExternalFile(dir: string, subpath: string): Response {
	const target = resolvePathWithin(dir, subpath);
	if (!target) return new Response("Not found", { status: 404 });
	try {
		const body = readFileSync(target);
		return new Response(new Uint8Array(body), {
			headers: { "content-type": contentTypeFor(target) },
		});
	} catch {
		return new Response("Not found", { status: 404 });
	}
}
