import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexLaunchLine } from "../launch";
import { reviveCommand, sessionExists } from "./agentResume";

const ID = "01957000-1234-7000-8000-123456789abc";
const options = { mcp: false, windows: false };
let home: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "codex-revive-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function rollout(root = "sessions", content = "{}\n") {
	const dir = join(home, root, "2026", "09", "18");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `rollout-2026-09-18T10-00-00-${ID}.jsonl`), content);
}

test("resumes a saved session across date directories and falls back when absent", () => {
	expect(reviveCommand("codex", ID, options, home)).toBe("codex resume --last");
	rollout();
	expect(reviveCommand("codex", ID, options, home)).toBe(`codex resume ${ID}`);
});

test("empty, archived and invalid sessions are not offered", () => {
	rollout("archived_sessions");
	rollout("sessions", "");
	expect(sessionExists(ID, home)).toBe(false);
	expect(reviveCommand("codex", "x; touch /tmp/injected", options, home)).toBe(
		"codex resume --last",
	);
	expect(sessionExists("../../outside", home)).toBe(false);
});

test("preserves quoted executable and option values without replaying prompts or images", () => {
	const command = `'path with spaces/codex' -c 'model_reasoning_effort="high"' --model gpt-5 --sandbox workspace-write --image 'old image.png' 'fix the build' --search`;
	expect(reviveCommand(command, undefined, options, home)).toBe(
		`'path with spaces/codex' -c 'model_reasoning_effort="high"' --model gpt-5 --sandbox workspace-write --search resume --last`,
	);
});

test("replaces resume and fork selectors, including last/all and positional prompts", () => {
	rollout();
	for (const selector of ["resume --last --all", "resume old-id", "fork old-id", "fork --last"]) {
		expect(reviveCommand(`codex ${selector} 'old prompt' --yolo`, ID, options, home)).toBe(
			`codex --yolo resume ${ID}`,
		);
	}
	const first = reviveCommand("codex -m model", ID, options, home);
	expect(reviveCommand(first ?? "", ID, options, home)).toBe(first);
});

test("refreshes MCP through the shared composer and honors platform and setting", () => {
	expect(reviveCommand("codex", undefined, { mcp: true, windows: false }, home)).toBe(
		codexLaunchLine("codex", { mcp: true, windows: false, resume: {} }),
	);
	expect(reviveCommand("codex", undefined, { mcp: true, windows: true }, home)).toBe(
		"codex resume --last",
	);
});

test("repeated revival refreshes the MCP override without accumulating stale values", () => {
	const enabled = { mcp: true, windows: false };
	const first = reviveCommand(
		"codex -c 'mcp_servers.thinkrail.url=\"http://old\"'",
		undefined,
		enabled,
		home,
	);
	expect(first).toBe(codexLaunchLine("codex", { ...enabled, resume: {} }));
	expect(reviveCommand(first ?? "", undefined, enabled, home)).toBe(first);
	expect(reviveCommand(first ?? "", undefined, options, home)).toBe("codex resume --last");
});

test("incomplete or compound commands produce no offer", () => {
	for (const command of [
		"",
		"  ",
		"codex --model",
		"codex 'broken",
		"codex; echo bad",
		"codex && echo bad",
		"codex --unknown value",
	]) {
		expect(reviveCommand(command, ID, options, home)).toBeNull();
	}
});

test("launch composer quotes session selectors", () => {
	expect(
		codexLaunchLine("codex", { ...options, resume: { sessionId: "$(touch /tmp/injected)" } }),
	).toBe("codex resume '$(touch /tmp/injected)'");
});

test("revival applies the current default permissions to the configured command", () => {
	expect(
		reviveCommand(
			"codex --model gpt-6-astra",
			undefined,
			{
				...options,
				permissionMode: "full-auto",
			},
			home,
		),
	).toBe(
		"codex --model gpt-6-astra resume --last --sandbox workspace-write --ask-for-approval on-request",
	);
});
