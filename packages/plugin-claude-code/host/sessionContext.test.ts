import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendedPromptFiles } from "./sessionContext";

let dir: string;

beforeEach(() => {
	dir = realpathSync(mkdtempSync(join(tmpdir(), "claude-flags-")));
	writeFileSync(join(dir, "rules.md"), "x");
	mkdirSync(join(dir, "my prompts"));
	writeFileSync(join(dir, "my prompts", "a b.md"), "x");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("a plain claude was told to append nothing", () => {
	expect(appendedPromptFiles("claude", dir)).toEqual([]);
	expect(appendedPromptFiles("claude --model opus --resume", dir)).toEqual([]);
});

test("the file named after the flag is found, in either spelling, absolute or relative", () => {
	expect(appendedPromptFiles(`claude --append-system-prompt-file ${dir}/rules.md`, dir)).toEqual([
		join(dir, "rules.md"),
	]);
	expect(
		appendedPromptFiles("claude --append-system-prompt-file=rules.md --model opus", dir),
	).toEqual([join(dir, "rules.md")]);
});

test("a path with spaces, and a prompt word after it, still name the right file", () => {
	const command = `claude --append-system-prompt-file ${dir}/my prompts/a b.md fix the bug`;
	expect(appendedPromptFiles(command, dir)).toEqual([join(dir, "my prompts", "a b.md")]);
});

test("a flag naming a missing file, or the inline-text flag, contributes nothing", () => {
	expect(appendedPromptFiles("claude --append-system-prompt-file gone.md", dir)).toEqual([]);
	expect(appendedPromptFiles("claude --append-system-prompt rules.md", dir)).toEqual([]);
});

test("the same file named twice is one layer", () => {
	const command = `claude --append-system-prompt-file rules.md --append-system-prompt-file ${dir}/rules.md`;
	expect(appendedPromptFiles(command, dir)).toEqual([join(dir, "rules.md")]);
});
