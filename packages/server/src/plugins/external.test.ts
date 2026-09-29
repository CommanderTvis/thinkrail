import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importExternalHost, serveExternalFile } from "./external";

const dirs: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-plugin-external-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("importExternalHost loads the default export of a plugin's host file", async () => {
	const dir = tempDir();
	writeFileSync(
		join(dir, "host.js"),
		`export default {
			manifest: { id: "fixture", label: "Fixture", icon: "puzzle", version: "0.0.0", apiGeneration: 1, wireVersion: 1, enabledByDefault: false, dependsOn: [], contributes: { sideTools: [], fileViewers: [] } },
			contract: { id: "fixture", wireVersion: 1, methods: {}, channels: {}, settings: {} },
			activate: () => undefined,
		};`,
	);
	const module = await importExternalHost(dir, "host.js");
	expect(module.manifest.id).toBe("fixture");
});

test("serveExternalFile serves a file under the plugin's directory", () => {
	const dir = tempDir();
	writeFileSync(join(dir, "web.js"), "export const hi = 1;");
	const response = serveExternalFile(dir, "web.js");
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toBe("text/javascript");
});

test("serveExternalFile refuses a path that escapes the plugin's directory", () => {
	const dir = tempDir();
	const response = serveExternalFile(dir, "../../etc/passwd");
	expect(response.status).toBe(404);
});

test("serveExternalFile answers 404 for a file that does not exist", () => {
	const dir = tempDir();
	const response = serveExternalFile(dir, "nope.js");
	expect(response.status).toBe(404);
});
