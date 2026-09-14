import type { PluginContributions } from "@thinkrail/contracts";

/**
 * Declares that a plugin is built on another plugin, by id and exact wire version. A plugin whose
 * dependency is absent, disabled, failed, or at a different `wireVersion` is refused, naming this
 * dependency as the reason. Activation runs dependency-first and disposal dependent-first; a cycle
 * among declared dependencies is refused at load. See {@link PluginHostContext.dependency} for what
 * the dependency then grants at runtime.
 */
export interface PluginDependency {
	/** The id of the plugin depended on. */
	id: string;
	/** The exact `wireVersion` the dependency must be running for this plugin to load. */
	wireVersion: number;
}

/**
 * Declares the pi resources a plugin contributes to agent sessions, loaded alongside the host's
 * own resources. Shown in Settings on the row where the user enables the plugin, so the trust
 * decision is made with this information in front of them.
 */
export interface PluginPiBlock {
	/** Extension entries fed to pi's resource loader (value-imported for a builtin plugin, real paths for an external one). */
	extensions: readonly string[];
	/** Skill directories fed to pi's resource loader; loaded skills carry `group = <plugin id>`. */
	skills: readonly string[];
	/** Whether these extensions and skills also reach delegated sub-agent sessions. Off by default. */
	reachesSubagents: boolean;
	/** Whether any extension appends to the system prompt via `before_agent_start`. Surfaced to the user next to the enable toggle. */
	modifiesSystemPrompt: boolean;
}

/**
 * The static description of a plugin: identity, versioning, its two entry points, and what it
 * declares up front without running any code. The same fields are carried by a builtin plugin's
 * `definePluginManifest`-wrapped export and by an external plugin's `thinkrail-plugin.json`.
 * `contributes` exists because the file-open dispatcher and the layout engine each need a
 * contribution to be known before the plugin's own code runs; a contribution's component or finer
 * predicate is registered separately by the web half during activation.
 */
export interface PluginManifest {
	/** The plugin's namespace for every wire method, channel, route, tool id, and settings key. For an external plugin this must equal its directory name. */
	id: string;
	/** Shown in the roster, the Settings list, and a dormant tool placeholder. */
	label: string;
	/** One sentence on what the plugin does, shown under its label in Settings. */
	description?: string;
	/** A Remix Icon name; an unrecognised name falls back to a generic glyph. */
	icon: string;
	/** The plugin's own version, informational only. */
	version: string;
	/** The {@link PLUGIN_API_GENERATION} this manifest was built against; a mismatch is refused before load. */
	apiGeneration: number;
	/** Incremented whenever the plugin's methods or channels change, so a separately shipped web half can detect drift. */
	wireVersion: number;
	/** Honoured for a builtin plugin; an external plugin always arrives disabled regardless of this value. */
	enabledByDefault: boolean;
	/** Other plugins this one is built on, by id and exact wire version; see {@link PluginDependency}. */
	dependsOn: readonly PluginDependency[];
	/** Relative path to the host half's ES module entry. Absent when the plugin has no host half. */
	host?: string;
	/** Relative path to the web half's ES module entry. Absent when the plugin has no web half. */
	web?: string;
	/** Relative path to the web half's compiled stylesheet. */
	styles?: string;
	/** Relative path to an assets directory the host serves or hands to the plugin. */
	assets?: string;
	/** The statically known parts of what the plugin contributes: side tools and file viewers. */
	contributes: PluginContributions;
	/** Agent-facing resources this plugin loads into sessions; see {@link PluginPiBlock}. */
	pi?: PluginPiBlock;
}

/**
 * Identity helper that returns `manifest` unchanged while inferring its literal types. Wrap a
 * plugin's manifest value in this so downstream consumers (the roster, the loader) see the exact
 * literal shape rather than a widened `PluginManifest`.
 * @param manifest the plugin's manifest
 * @returns `manifest`, unchanged
 * @example
 * ```ts
 * export const manifest = definePluginManifest({
 *   id: "todo-board",
 *   label: "Todo Board",
 *   icon: "checkbox-circle-line",
 *   version: "1.0.0",
 *   apiGeneration: PLUGIN_API_GENERATION,
 *   wireVersion: 1,
 *   enabledByDefault: false,
 *   dependsOn: [],
 *   host: "./host.js",
 *   web: "./web.js",
 *   styles: "./web.css",
 *   contributes: { sideTools: [], fileViewers: [] },
 * });
 * ```
 */
export function definePluginManifest<const M extends PluginManifest>(manifest: M): M {
	return manifest;
}
