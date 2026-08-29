import { expect, test } from "bun:test";
import { fileIconName } from "./fileIcon";

test("an extension names the icon, whatever case it arrives in", () => {
	expect(fileIconName("src/Main.kt")).toBe("kotlin");
	expect(fileIconName("data.JSON")).toBe("json");
	expect(fileIconName("/abs/path/app.tsx")).toBe("react_ts");
});

test("a whole filename wins over its extension", () => {
	expect(fileIconName("vitest.config.ts")).toBe("vitest");
	expect(fileIconName("Dockerfile")).toBe("docker");
	// package.json is Node's, not JSON's — which is the whole reason names are consulted first.
	expect(fileIconName("package.json")).toBe("nodejs");
});

test("a longer extension wins over a shorter one", () => {
	expect(fileIconName("types/api.d.ts")).toBe("typescript-def");
	expect(fileIconName("types/api.ts")).toBe("typescript");
});

test("a dotfile is read the same way", () => {
	expect(fileIconName(".gitignore")).toBe("git");
	expect(fileIconName(".env")).toBe("tune");
});

test("anything unrecognised falls back to the plain file icon", () => {
	expect(fileIconName("notes.qqqq")).toBe("file");
	expect(fileIconName("LICENSE-something")).toBe("file");
});
