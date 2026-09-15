import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
