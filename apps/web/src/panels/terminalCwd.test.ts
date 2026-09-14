import { expect, test } from "bun:test";
import { attachPath } from "./terminalCwd";

const worktree = "/w/repo";

test("a dropped path is written the way a shell in cwd will resolve it", () => {
	expect(attachPath("src/a.ts", worktree, worktree)).toBe("src/a.ts");
	expect(attachPath("packages/server/src/a.ts", worktree, "/w/repo/packages/server")).toBe(
		"src/a.ts",
	);
	// Inside the worktree but outside cwd: absolute, which cannot be misread as relative to the wrong place.
	expect(attachPath("apps/web/a.ts", worktree, "/w/repo/packages/server")).toBe(
		"/w/repo/apps/web/a.ts",
	);
	expect(attachPath("src/a.ts", worktree, "/elsewhere")).toBe("/w/repo/src/a.ts");
	expect(attachPath("src/a.ts", worktree, undefined)).toBe("/w/repo/src/a.ts");
});

test("a path from outside the worktree is kept whole, unless cwd is standing in it", () => {
	expect(attachPath("/etc/hosts", worktree, worktree)).toBe("/etc/hosts");
	expect(attachPath("/w/other/notes.md", worktree, "/w/other")).toBe("notes.md");
	expect(attachPath("C:\\repo\\a.ts", undefined, undefined)).toBe("C:\\repo\\a.ts");
});
