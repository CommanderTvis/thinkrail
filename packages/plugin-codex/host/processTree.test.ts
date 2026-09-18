import { expect, test } from "bun:test";
import { runsInsideAgent, snapshotFromRows } from "./processTree";

const tab = (inner: string, outer: string) =>
	snapshotFromRows([
		{ pid: 10, ppid: 1, name: "zsh" },
		{ pid: 20, ppid: 10, name: outer },
		{ pid: 30, ppid: 20, name: "node" },
		{ pid: 40, ppid: 30, name: inner },
	]);

test("Codex that Claude Code started leaves the tab to Claude Code", () => {
	expect(runsInsideAgent(tab("codex", "claude"), 10, "codex", "claude")).toBe(true);
});

test("Codex is the tab's agent when nothing named by the record sits above it", () => {
	expect(runsInsideAgent(tab("claude", "codex"), 10, "codex", "claude")).toBe(false);
	expect(runsInsideAgent(tab("codex", "bash"), 10, "codex", "claude")).toBe(false);
	expect(runsInsideAgent(tab("bash", "claude"), 10, "codex", "claude")).toBe(false);
});
