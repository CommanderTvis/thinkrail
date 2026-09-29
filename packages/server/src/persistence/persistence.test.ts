import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir, readPluginState, writePluginState } from "./persistence";

let dir: string;
const saved = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "trpi-persistence-test-"));
	process.env.THINKRAIL_DATA_DIR = dir;
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	if (saved === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = saved;
});

test("readPluginState falls back when nothing was written yet", () => {
	expect(readPluginState("blueprint", "state", { count: 0 })).toEqual({ count: 0 });
});

test("writePluginState is namespaced by plugin id and readable back", () => {
	writePluginState("blueprint", "state", { count: 3 });
	expect(readPluginState("blueprint", "state", { count: 0 })).toEqual({ count: 3 });
	expect(readPluginState("other-plugin", "state", { count: 0 })).toEqual({ count: 0 });
	const raw = readFileSync(join(dataDir(), "plugin-state", "blueprint", "state.json"), "utf8");
	expect(JSON.parse(raw)).toEqual({ count: 3 });
});
