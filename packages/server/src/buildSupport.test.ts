import { expect, test } from "bun:test";
import { basename } from "node:path";
import { resolveBuildRuntimeSources } from "./buildSupport";

test("runtime source manifest covers the launcher artifact surface", () => {
	const sources = resolveBuildRuntimeSources();
	expect(sources.extensions.map((extension) => extension.specifier)).toEqual([
		"pi-web-access/index.ts",
		"pi-visualize/index.ts",
		"pi-thinkrail-workflow/index.ts",
		"pi-todos/index.ts",
	]);
	expect(sources.extensions.filter((extension) => extension.skills)).toHaveLength(2);
	expect(
		Object.fromEntries(
			Object.entries(sources.ptyLibraries).map(([target, path]) => [target, basename(path)]),
		),
	).toEqual({
		"darwin-arm64": "librust_pty_arm64.dylib",
		"darwin-x64": "librust_pty.dylib",
		"linux-arm64": "librust_pty_arm64.so",
		"linux-x64": "librust_pty.so",
		"win32-x64": "rust_pty.dll",
	});
	expect(basename(sources.trashHelpers.macos)).toBe("macos-trash");
	expect(basename(sources.trashHelpers.windows)).toBe("windows-trash.exe");
	expect(sources.plugins.map((plugin) => plugin.id)).toEqual([
		"spec-dialect",
		"blueprint",
		"claude-code",
		"discord",
	]);
	const specDialect = sources.plugins[0];
	expect(specDialect?.assets).toBeNull();
	expect(specDialect?.pi.extensions.map((extension) => extension.specifier)).toEqual([
		"pi-spec-graph",
	]);
	expect(specDialect?.pi.skills).toHaveLength(1);
	const claudeCode = sources.plugins[2];
	expect(typeof claudeCode?.assets).toBe("string");
	expect(claudeCode?.pi.extensions).toEqual([]);
});
