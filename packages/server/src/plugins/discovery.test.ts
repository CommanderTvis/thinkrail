import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_API_GENERATION } from "@thinkrail/plugin-api";
import { discoverExternalPlugins } from "./discovery";

const dirs: string[] = [];
function tempRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-plugin-discovery-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function manifest(id: string): string {
	return JSON.stringify({
		id,
		label: id,
		icon: "puzzle",
		version: "0.0.0",
		apiGeneration: PLUGIN_API_GENERATION,
		wireVersion: 1,
		enabledByDefault: false,
		dependsOn: [],
		contributes: { sideTools: [], fileViewers: [] },
	});
}

test("discovers a valid manifest under a directory named after its id", () => {
	const root = tempRoot();
	mkdirSync(join(root, "widgets"));
	writeFileSync(join(root, "widgets", "thinkrail-plugin.json"), manifest("widgets"));
	const found = discoverExternalPlugins([root]);
	expect(found).toHaveLength(1);
	expect(found[0]?.manifest?.id).toBe("widgets");
	expect(found[0]?.refused).toBeUndefined();
});

test("refuses a directory with an unreadable manifest instead of skipping it", () => {
	const root = tempRoot();
	mkdirSync(join(root, "broken"));
	writeFileSync(join(root, "broken", "thinkrail-plugin.json"), "not json");
	const found = discoverExternalPlugins([root]);
	expect(found).toHaveLength(1);
	expect(found[0]?.refused).toBeDefined();
});

test("refuses a directory with no manifest file at all, rather than silently skipping it", () => {
	const root = tempRoot();
	mkdirSync(join(root, "not-a-plugin"));
	const found = discoverExternalPlugins([root]);
	expect(found).toHaveLength(1);
	expect(found[0]?.refused).toBeDefined();
});

test("refuses a symlinked plugin directory instead of following it outside the scanned root", () => {
	const root = tempRoot();
	const outside = tempRoot();
	mkdirSync(join(outside, "real"));
	writeFileSync(join(outside, "real", "thinkrail-plugin.json"), manifest("real"));
	symlinkSync(join(outside, "real"), join(root, "looks-legit"));

	const found = discoverExternalPlugins([root]);
	expect(found).toHaveLength(1);
	expect(found[0]?.manifest).toBeUndefined();
	expect(found[0]?.refused).toContain("symlink");
});

test("ignores roots that do not exist rather than throwing", () => {
	expect(discoverExternalPlugins([join(tmpdir(), "does-not-exist-at-all")])).toHaveLength(0);
});
