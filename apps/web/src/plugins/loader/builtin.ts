import type { PluginManifest } from "@thinkrail/plugin-api";
import type { PluginWebModule } from "@thinkrail/plugin-api/web";
import { manifest as specDialectManifest } from "@thinkrail/plugin-spec-dialect/manifest";

export interface BuiltinWebPlugin {
	manifest: PluginManifest;
	load: () => Promise<PluginWebModule>;
}

export const BUILTIN_WEB_PLUGINS: readonly BuiltinWebPlugin[] = [
	{
		manifest: specDialectManifest,
		load: () =>
			import("@thinkrail/plugin-spec-dialect/web").then(
				(module) => module.default as PluginWebModule,
			),
	},
];
