import { expect, test } from "bun:test";
import git from "isomorphic-git";
import { createTabFs, createTabFsMirror, normalizePath } from "./fs";
import { memoryDirectory } from "./testing";

test("normalizePath folds dots and empty segments", () => {
	expect(normalizePath("/w/./a//b/../c")).toBe("/w/a/c");
	expect(normalizePath("w/.")).toBe("/w");
});

test("isomorphic-git commits and reports status over the tab fs", async () => {
	const fs = createTabFs();
	fs.mkdirSync("/w");
	await git.init({ fs, dir: "/w", defaultBranch: "main" });
	fs.writeFileSync("/w/a.txt", "hi\n");
	await git.add({ fs, dir: "/w", filepath: "a.txt" });
	await git.commit({ fs, dir: "/w", message: "m", author: { name: "a", email: "a@b" } });
	fs.writeFileSync("/w/a.txt", "changed\n");
	expect(await git.statusMatrix({ fs, dir: "/w" })).toEqual([["a.txt", 1, 2, 1]]);
});

test("a flushed volume is restored, binary files and deletions included", async () => {
	const root = memoryDirectory();
	const fs = createTabFs();
	const mirror = createTabFsMirror(fs, root);
	fs.mkdirSync("/w/sub", { recursive: true });
	fs.writeFileSync("/w/sub/blob", new Uint8Array([0, 255, 7]));
	fs.writeFileSync("/w/gone.txt", "x");
	await mirror.flush();
	fs.unlinkSync("/w/gone.txt");
	fs.writeFileSync("/w/kept.txt", "kept");
	await mirror.flush();

	const restored = createTabFs();
	await createTabFsMirror(restored, root).restore();
	expect([...(restored.readFileSync("/w/sub/blob") as Uint8Array)]).toEqual([0, 255, 7]);
	expect(restored.readFileSync("/w/kept.txt", "utf8")).toBe("kept");
	expect(restored.existsSync("/w/gone.txt")).toBe(false);
});
