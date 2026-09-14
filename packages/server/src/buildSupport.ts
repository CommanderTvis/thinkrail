import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { buildSupport as blueprintBuildSupport } from "@thinkrail/plugin-blueprint/build-support";
import { buildSupport as branchGraphBuildSupport } from "@thinkrail/plugin-branch-graph/build-support";
import { buildSupport as claudeCodeBuildSupport } from "@thinkrail/plugin-claude-code/build-support";
import { buildSupport as discordBuildSupport } from "@thinkrail/plugin-discord/build-support";
import { buildSupport as specDialectBuildSupport } from "@thinkrail/plugin-spec-dialect/build-support";
import { buildSupport as visualizeBuildSupport } from "@thinkrail/plugin-visualize/build-support";

export type DesktopRuntimeTarget =
	| "darwin-arm64"
	| "darwin-x64"
	| "linux-arm64"
	| "linux-x64"
	| "win32-x64";

export interface BundledExtensionSource {
	readonly specifier: string;
	readonly entry: string;
	readonly skills?: string;
}

export interface BuildRuntimePlugin {
	readonly id: string;
	readonly assets: string | null;
	readonly pi: {
		readonly extensions: readonly BundledExtensionSource[];
		readonly skills: readonly string[];
	};
}

export interface BuildRuntimeSources {
	readonly extensions: readonly BundledExtensionSource[];
	readonly ptyLibraries: Readonly<Record<DesktopRuntimeTarget, string>>;
	readonly trashHelpers: {
		readonly macos: string;
		readonly windows: string;
	};
	readonly plugins: readonly BuildRuntimePlugin[];
}

const BUILTIN_PLUGIN_BUILD_SUPPORT = [
	specDialectBuildSupport,
	blueprintBuildSupport,
	claudeCodeBuildSupport,
	discordBuildSupport,
	visualizeBuildSupport,
	branchGraphBuildSupport,
];

const require = createRequire(import.meta.url);

function requiredPath(path: string): string {
	if (!existsSync(path)) throw new Error(`required runtime source is missing: ${path}`);
	return path;
}

export function resolveBuildRuntimeSources(): BuildRuntimeSources {
	const extensions = [
		{ specifier: "pi-web-access/index.ts" },
		{ specifier: "pi-visualize/index.ts" },
		{ specifier: "pi-thinkrail-workflow/index.ts", skills: true },
		{ specifier: "pi-todos/index.ts", skills: true },
	].map(({ specifier, skills }) => {
		const entry = require.resolve(specifier);
		return {
			specifier,
			entry,
			...(skills ? { skills: requiredPath(join(dirname(entry), "skills")) } : {}),
		};
	});
	const ptyRelease = join(
		dirname(require.resolve("bun-pty")),
		"..",
		"rust-pty",
		"target",
		"release",
	);
	const trashLib = join(dirname(require.resolve("trash")), "lib");
	const plugins = BUILTIN_PLUGIN_BUILD_SUPPORT.map((plugin) => ({
		id: plugin.id,
		assets: plugin.assets,
		pi: {
			extensions: plugin.pi.extensions.map(({ specifier, entry }) => ({ specifier, entry })),
			skills: [...plugin.pi.skills],
		},
	}));
	return {
		extensions,
		ptyLibraries: {
			"darwin-arm64": requiredPath(join(ptyRelease, "librust_pty_arm64.dylib")),
			"darwin-x64": requiredPath(join(ptyRelease, "librust_pty.dylib")),
			"linux-arm64": requiredPath(join(ptyRelease, "librust_pty_arm64.so")),
			"linux-x64": requiredPath(join(ptyRelease, "librust_pty.so")),
			"win32-x64": requiredPath(join(ptyRelease, "rust_pty.dll")),
		},
		trashHelpers: {
			macos: requiredPath(join(trashLib, "macos-trash")),
			windows: requiredPath(join(trashLib, "windows-trash.exe")),
		},
		plugins,
	};
}
