import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEVELOPER_INSTRUCTIONS,
	developerInstructionsJson,
	developerInstructionsPath,
	worktreesDirOf,
	writeDeveloperInstructions,
} from "./systemPrompt";

let dir: string;
const previous = process.env.THINKRAIL_DATA_DIR;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "codex-prompt-"));
	process.env.THINKRAIL_DATA_DIR = dir;
});
afterEach(() => {
	if (previous === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = previous;
	rmSync(dir, { recursive: true, force: true });
});

test("the generated source is inspectable and terminal encoding reads its current contents", () => {
	writeDeveloperInstructions();
	expect(developerInstructionsPath()).toBe(join(dir, "codex", "developer-instructions.md"));
	expect(readFileSync(developerInstructionsPath(), "utf8")).toBe(DEVELOPER_INSTRUCTIONS);
	writeFileSync(developerInstructionsPath(), 'Edited instructions with "quotes"\n');
	expect(JSON.parse(developerInstructionsJson())).toBe('Edited instructions with "quotes"\n');
	expect(worktreesDirOf("project")).toBe(join(dir, "worktrees", "project"));
	writeDeveloperInstructions();
	expect(JSON.parse(developerInstructionsJson())).toBe(DEVELOPER_INSTRUCTIONS);
});
