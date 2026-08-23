import { expect, test } from "bun:test";
import { attachPath, cwdLabel } from "./terminalCwd";

const worktree = "/w/repo";

test("the chip says where the agent started, whole, with home written as ~", () => {
	expect(cwdLabel("/Users/ada/job-search")).toBe("~/job-search");
	expect(cwdLabel("/home/ada/job-search")).toBe("~/job-search");
	expect(cwdLabel("/w/repo/packages/server")).toBe("/w/repo/packages/server");
	// A fragment of the path relative to the worktree reads as a path to nowhere, so there isn't one.
	expect(cwdLabel(worktree)).toBe(worktree);
});

test("a long path loses its middle, not the end that identifies it", () => {
	expect(cwdLabel("/var/folders/ph/7mrpl8cs1pd49nvgnbhyfzgm0000gn/T/e2e/sample-project")).toBe(
		"/…/e2e/sample-project",
	);
	expect(cwdLabel("/Users/ada/work/clients/axel-springer/applications/2026/spring")).toBe(
		"~/…/2026/spring",
	);
});

test("nothing to say without a directory", () => {
	expect(cwdLabel(undefined)).toBeNull();
});

test("an attached path is written the way the agent will resolve it", () => {
	expect(attachPath("src/a.ts", worktree, worktree)).toBe("src/a.ts");
	expect(attachPath("packages/server/src/a.ts", worktree, "/w/repo/packages/server")).toBe(
		"src/a.ts",
	);
	// Inside the worktree but outside the agent's directory: absolute, which Claude accepts and which
	// cannot be misread as relative to the wrong place.
	expect(attachPath("apps/web/a.ts", worktree, "/w/repo/packages/server")).toBe(
		"/w/repo/apps/web/a.ts",
	);
	expect(attachPath("src/a.ts", worktree, "/elsewhere")).toBe("/w/repo/src/a.ts");
	expect(attachPath("src/a.ts", worktree, undefined)).toBe("/w/repo/src/a.ts");
});

test("a path from outside the worktree is kept whole, unless the agent is standing in it", () => {
	expect(attachPath("/etc/hosts", worktree, worktree)).toBe("/etc/hosts");
	expect(attachPath("/w/other/notes.md", worktree, "/w/other")).toBe("notes.md");
	expect(attachPath("C:\\repo\\a.ts", undefined, undefined)).toBe("C:\\repo\\a.ts");
});
