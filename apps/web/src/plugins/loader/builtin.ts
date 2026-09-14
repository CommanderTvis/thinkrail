import type { PluginManifest } from "@thinkrail/plugin-api";
import type { PluginWebModule } from "@thinkrail/plugin-api/web";

export interface BuiltinWebPlugin {
	manifest: PluginManifest;
	load: () => Promise<PluginWebModule>;
}

export const BUILTIN_WEB_PLUGINS: readonly BuiltinWebPlugin[] = [];
