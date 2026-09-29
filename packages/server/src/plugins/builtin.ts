import type { PluginManifest } from "@thinkrail/plugin-api";
import type { PluginHostModule } from "@thinkrail/plugin-api/host";

export const BUILTIN_PLUGINS: readonly PluginHostModule[] = [];

/** Builtin plugins that ship no host half at all — see {@link PluginRegistry.registerBuiltinManifest}. */
export const BUILTIN_MANIFEST_ONLY_PLUGINS: readonly PluginManifest[] = [];
