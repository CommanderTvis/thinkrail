/**
 * The shape a plugin id must have: lowercase alphanumeric segments joined by hyphens.
 * For an external plugin the id must equal its directory name under `<dataDir>/plugins`, so an
 * id cannot claim more than the user placed there. Every namespaced name below is built from an
 * id matching this pattern.
 */
export const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Reports whether `value` is a well-formed plugin id.
 * @param value the candidate id
 * @returns `true` when `value` matches {@link PLUGIN_ID_PATTERN}
 */
export function isPluginId(value: string): boolean {
	return PLUGIN_ID_PATTERN.test(value);
}

/**
 * Builds the wire name of one of a plugin's WS request methods, `plugin.<id>.<name>`. Use this on
 * both sides of a call: registering the handler with {@link PluginHostContext.method} and issuing
 * the request from a web half's {@link PluginWebContext}.
 * @param id the plugin's id
 * @param name the method name declared in the plugin's {@link PluginContract}
 * @returns the wire method name
 */
export function pluginMethodName<I extends string, N extends string>(
	id: I,
	name: N,
): `plugin.${I}.${N}` {
	return `plugin.${id}.${name}`;
}

/**
 * Builds the wire name of one of a plugin's channels, `plugin.<id>.<name>`. Use this to publish
 * from {@link PluginHostContext.publish} and to subscribe from a web half.
 * @param id the plugin's id
 * @param name the channel name declared in the plugin's {@link PluginContract}
 * @returns the wire channel name
 */
export function pluginChannelName<I extends string, N extends string>(
	id: I,
	name: N,
): `plugin.${I}.${N}` {
	return `plugin.${id}.${name}`;
}

/**
 * Builds a plugin's HTTP route, `/plugin/<id>` or `/plugin/<id>/<subpath>`. This is the path a
 * host route registered with {@link PluginHostContext.route} is mounted under, and the path an
 * external plugin's served web module, stylesheet, and assets are read from.
 * @param id the plugin's id
 * @param subpath the path segment under the plugin's route, omitted for the route root
 * @returns the HTTP route
 */
export function pluginRoute(id: string, subpath = ""): `/plugin/${string}` {
	return subpath ? `/plugin/${id}/${subpath}` : `/plugin/${id}`;
}

/**
 * Builds the id of a plugin-contributed side tool as it appears in the layout, `plugin:<id>:<tool>`.
 * The tool name must match one declared in the manifest's `contributes.sideTools`.
 * @param id the plugin's id
 * @param tool the tool name from the manifest's `contributes.sideTools`
 * @returns the layout tool id
 */
export function pluginToolId<I extends string, T extends string>(
	id: I,
	tool: T,
): `plugin:${I}:${T}` {
	return `plugin:${id}:${tool}`;
}

/**
 * Parses a layout tool id built by {@link pluginToolId} back into its plugin id and tool name.
 * Used by the layout engine to route a `plugin:` tab to its owning plugin, including one whose
 * plugin has since been removed.
 * @param value the layout tool id to parse
 * @returns the plugin id and tool name, or `null` when `value` is not a plugin tool id
 */
export function parsePluginToolId(value: string): { pluginId: string; tool: string } | null {
	const match = /^plugin:([a-z0-9-]+):(.+)$/.exec(value);
	if (!match) return null;
	const [, pluginId, tool] = match;
	if (!pluginId || !tool) return null;
	return { pluginId, tool };
}

/**
 * Builds a client-local preference key namespaced to a plugin, `plugin:<id>:<key>`. The key is
 * further endpoint-qualified by the stable-preference adapter it is stored through; nothing
 * plugin-local crosses the wire.
 * @param id the plugin's id
 * @param key the preference name, chosen by the plugin
 * @returns the preference key
 */
export function pluginPreferenceKey(id: string, key: string): `plugin:${string}:${string}` {
	return `plugin:${id}:${key}`;
}

/**
 * Builds the path of a plugin's host state file, relative to the data directory:
 * `plugin-state/<id>/<name>.json`. This is the path {@link PluginHostContext.readState} and
 * {@link PluginHostContext.writeState} resolve `name` against; it survives the plugin being
 * replaced, since code and state live in sibling trees.
 * @param id the plugin's id
 * @param name the state file name, chosen by the plugin
 * @returns the state file's path relative to the data directory
 */
export function pluginStateFile(id: string, name: string): string {
	return `plugin-state/${id}/${name}.json`;
}
