/**
 * @packageDocumentation
 * The shared root of `@thinkrail/plugin-api`: identity helpers, the manifest, the wire contract
 * vocabulary, and the pi-free tool-definition shape. Both a plugin's host half and its web half
 * import from here; ring-specific capabilities live in `./host` and `./web`.
 */

/**
 * The shape of the plugin API this package's types and helpers were built against. A plugin
 * declares the generation it was built against in its manifest's `apiGeneration`; a mismatch
 * against this constant is refused before the plugin loads, rather than allowed to half-load.
 * Incremented with any breaking change to this package.
 */
export const PLUGIN_API_GENERATION = 1;

/**
 * The roster and contribution shapes a plugin shares with the wire, re-exported from
 * `@thinkrail/contracts` so a plugin never depends on that package directly; each is documented where
 * it is declared.
 */
export type {
	PluginContributions,
	PluginFileViewerContribution,
	PluginOrigin,
	PluginRosterEntry,
	PluginSideToolContribution,
	PluginStatus,
	TerminalAgentRecord,
} from "@thinkrail/contracts";

export type {
	ChannelPayload,
	MethodParams,
	MethodResult,
	PluginChannelSpec,
	PluginContract,
	PluginMethodSpec,
	PluginSettings,
} from "./contract";
export { definePluginContract } from "./contract";
export {
	isPluginId,
	PLUGIN_ID_PATTERN,
	parsePluginToolId,
	pluginChannelName,
	pluginMethodName,
	pluginPreferenceKey,
	pluginRoute,
	pluginStateFile,
	pluginToolId,
} from "./identity";
export type { PluginDependency, PluginManifest, PluginPiBlock } from "./manifest";
export { definePluginManifest } from "./manifest";
export type {
	PluginToolContext,
	PluginToolDefinition,
	PluginToolResult,
	PluginToolSurface,
	TerminalRef,
} from "./tool";
export { definePluginTool } from "./tool";
