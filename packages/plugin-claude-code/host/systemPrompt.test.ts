import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { THINKRAIL_WORKTREES_ENV } from "../contracts";
import { SYSTEM_PROMPT, systemPromptPath, worktreesDirOf, writeSystemPrompt } from "./systemPrompt";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-claude-prompt-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("the prompt file lands in the data dir, and rewriting it replaces a stale one", () => {
	const file = writeSystemPrompt();
	expect(file).toBe(join(dataDir, "claude-code", "system-prompt.md"));
	expect(file).toBe(systemPromptPath());
	expect(readFileSync(file, "utf8")).toBe(SYSTEM_PROMPT);
	writeSystemPrompt();
	expect(readFileSync(file, "utf8")).toBe(SYSTEM_PROMPT);
});

test("a project's worktrees folder is the one ThinkRail creates workspaces in", () => {
	expect(worktreesDirOf("repo")).toBe(join(dataDir, "worktrees", "repo"));
});

test("the prompt tells the agent where to create worktrees and where not to", () => {
	expect(SYSTEM_PROMPT).toContain(
		`git worktree add "$${THINKRAIL_WORKTREES_ENV}/<branch>" -b <branch>`,
	);
	expect(SYSTEM_PROMPT).toContain(".claude/worktrees");
	expect(SYSTEM_PROMPT).toContain("not a bare shell");
	for (const tool of ["visualize", "spec_grep", "blueprint_check", "resolve_comment"]) {
		expect(SYSTEM_PROMPT).toContain(`\`${tool}\``);
	}
});
