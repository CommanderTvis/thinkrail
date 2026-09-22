import { expect, test } from "bun:test";
import { validPathName } from "./PathNameDialog";

test("a name is a path under its folder, never out of it or blank", () => {
	for (const name of ["notes.md", ".env", "src/index.ts", "a b.txt"]) {
		expect(validPathName(name)).toBe(true);
	}
	for (const name of ["", " x", "x ", "..", "../x", "a//b", "/abs", "a/./b", "dir/"]) {
		expect(validPathName(name)).toBe(false);
	}
});
