// Type contract for the build-time-generated bundled-extensions module (`src/bundled-extensions.generated.ts`),
// which `bun run build:binary` writes just before `bun build --compile` and deletes afterward. This `.d.ts` is
// committed so `tsc` can resolve `compiled-entry`'s import when the generated `.ts` is absent (the normal
// state in the repo); the compiler (`bun build`) uses the real `.ts` instead.

import type { BundledExtensionFactory } from "@thinkrail/server";

/** The bundled pi extensions' default-export factories, value-imported, in load order. */
export declare const bundledExtensionFactories: BundledExtensionFactory[];

export declare const bundledWebAccessFactory: BundledExtensionFactory;

export interface EmbeddedSkillFile {
	/** Path relative to the staged skills root, posix-style — e.g. `spec-graph/SKILL.md`. */
	route: string;
	/** Embedded-file path (a Bun `import … with { type: "file" }`), readable at runtime via `Bun.file`. */
	data: string;
}

/** Every file under the bundled extensions' wired `skills/` dirs, embedded into the single-file binary. */
export declare const embeddedSkillFiles: EmbeddedSkillFile[];

/** Content hash of the embedded skills — keys the on-disk staging dir so a new build re-extracts. */
export declare const bundledSkillsVersion: string;

/** Per builtin plugin id: its pi extensions' default-export factories, in manifest order. */
export declare const bundledPluginFactories: Record<string, BundledExtensionFactory[]>;

/** Per builtin plugin id: its skills route under the staged plugins dir, or `null` when it has none. */
export declare const bundledPluginSkillRoutes: Record<string, string | null>;

/** Per builtin plugin id: its assets route under the staged plugins dir, or `null` when it has none. */
export declare const bundledPluginAssetRoutes: Record<string, string | null>;

/** Every builtin plugin's skill/asset files, embedded into the single-file binary under
 * `plugins/<id>/skills/...` / `plugins/<id>/assets/...` routes. */
export declare const embeddedPluginRuntimeFiles: EmbeddedSkillFile[];

/** Content hash of the embedded plugin runtime files — keys their on-disk staging dir. */
export declare const bundledPluginRuntimeVersion: string;
