import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type {
	AppConfig,
	PluginRosterEntry,
	PluginSettingsNamespace,
	TerminalAgentRecord,
	WorkspaceFsChangedPayload,
} from "@thinkrail/contracts";
import type { TerminalRef } from "@thinkrail/plugin-api";
import type {
	PluginCall,
	RevivePrefill,
	TerminalEvent,
	WorkspaceEvent,
} from "@thinkrail/plugin-api/host";
import type { McpToolHandle } from "../mcp";
import { deactivate, resolveAssetsDir } from "./activation";
import { BUILTIN_MANIFEST_ONLY_PLUGINS, BUILTIN_PLUGINS } from "./builtin";
import { discoverExternalPlugins } from "./discovery";
import { serveExternalFile } from "./external";
import { type PluginPiResources, pluginPiResources } from "./piResources";
import { PluginReconciler } from "./reconciler";
import { beginCall, endCall, PluginRegistry } from "./registry";
import type { PluginHostSeams } from "./seams";
import { validatePluginNamespaces } from "./settings";
import { pluginMcpTools, pluginToolsExtension } from "./tools";
import {
	callPluginMethod,
	handlePluginRequest,
	parsePluginMethod,
	pluginChannelNames,
	publishPlugin,
} from "./wire";

export { validateManifest } from "./manifest";
export type { PluginPiResources } from "./piResources";
export { PluginRegistry } from "./registry";
export type { PluginHostSeams } from "./seams";
export type { NamespaceValidation } from "./settings";
export { cascadeDisable, validatePluginNamespaces } from "./settings";

export interface PluginRuntime {
	roster(): PluginRosterEntry[];
	handleRequest(method: string, params: unknown, call: PluginCall): Promise<unknown>;
	serveRoute(request: Request, url: URL): Promise<Response>;
	channelNames(): string[];
	mcpTools(owner: TerminalRef, cwd: string): McpToolHandle[];
	terminalEnv(terminal: TerminalRef): Record<string, string>;
	onTerminalEvent(event: TerminalEvent): void;
	revivePrefill(terminal: TerminalRef, record: TerminalAgentRecord): RevivePrefill | null;
	workspaceEvent(event: WorkspaceEvent): void;
	fsChanged(payload: WorkspaceFsChangedPayload): void;
	settingsChanged(config: AppConfig): void;
	validateSettings(
		update: Record<string, PluginSettingsNamespace | null>,
		current: AppConfig["plugins"],
	): AppConfig["plugins"];
	reconcile(): Promise<void>;
	rescan(): Promise<PluginRosterEntry[]>;
	retry(id: string): Promise<PluginRosterEntry[]>;
	piResources(): PluginPiResources;
	toolsExtension: ExtensionFactory;
	dispose(): void;
}

const ROUTE_PATTERN = /^\/plugin\/([a-z0-9](?:-?[a-z0-9])*)(\/.*)?$/;

function isStaticAssetPath(
	manifest: { web?: string; styles?: string; assets?: string },
	subpath: string,
): boolean {
	if (subpath === manifest.web || subpath === manifest.styles) return true;
	return manifest.assets !== undefined && subpath.startsWith(`${manifest.assets}/`);
}

export async function installPlugins(seams: PluginHostSeams): Promise<PluginRuntime> {
	const registry = new PluginRegistry();
	const reconciler = new PluginReconciler(registry, seams);
	let lastConfig: AppConfig | undefined;

	for (const module of BUILTIN_PLUGINS) registry.registerBuiltin(module);
	for (const manifest of BUILTIN_MANIFEST_ONLY_PLUGINS) registry.registerBuiltinManifest(manifest);
	for (const found of discoverExternalPlugins(seams.config().pluginPaths)) {
		if (found.refused !== undefined) registry.registerRefusedExternal(found.dir, found.refused);
		else if (found.manifest) registry.upsertExternal(found.manifest, found.dir);
	}

	await reconciler.schedule();

	const scope = (): { workspaceId: string | null; cwd: string } => ({
		workspaceId: null,
		cwd: seams.dataDir,
	});

	async function serveRoute(request: Request, url: URL): Promise<Response> {
		const match = ROUTE_PATTERN.exec(url.pathname);
		if (!match) return new Response("Not found", { status: 404 });
		const [, id, rawSubpath] = match;
		if (!id) return new Response("Not found", { status: 404 });
		const subpath = (rawSubpath ?? "").replace(/^\//, "");
		const entry = registry.get(id);
		if (!entry) return new Response("Not found", { status: 404 });
		if (entry.origin === "external" && entry.dir && isStaticAssetPath(entry.manifest, subpath)) {
			return serveExternalFile(entry.dir, subpath);
		}
		if (
			entry.origin === "builtin" &&
			entry.manifest.assets !== undefined &&
			subpath.startsWith(`${entry.manifest.assets}/`)
		) {
			const assetsDir = resolveAssetsDir(entry, seams, id);
			if (!assetsDir) return new Response("Not found", { status: 404 });
			return serveExternalFile(assetsDir, subpath.slice(entry.manifest.assets.length + 1));
		}
		const tables = entry.activation;
		if (entry.state !== "active" || !tables?.route)
			return new Response("Not found", { status: 404 });
		beginCall(tables);
		try {
			return await tables.route(request, subpath);
		} finally {
			endCall(tables);
		}
	}

	function terminalEnv(terminal: TerminalRef): Record<string, string> {
		const env: Record<string, string> = {};
		for (const entry of registry.all()) {
			if (entry.state !== "active") continue;
			for (const contributor of entry.activation?.envContributors ?? []) {
				Object.assign(env, contributor(terminal));
			}
		}
		return env;
	}

	function onTerminalEvent(event: TerminalEvent): void {
		for (const entry of registry.all()) {
			if (entry.state !== "active") continue;
			for (const observer of entry.activation?.terminalObservers ?? []) observer(event);
		}
	}

	function revivePrefill(terminal: TerminalRef, record: TerminalAgentRecord): RevivePrefill | null {
		let text: string | undefined;
		let submit = false;
		for (const entry of registry.all()) {
			if (entry.state !== "active") continue;
			for (const hook of entry.activation?.reviveHooks ?? []) {
				const result = hook(terminal, record);
				if (!result) continue;
				if (text === undefined && result.text !== undefined) text = result.text;
				if (result.submit) submit = true;
			}
		}
		if (text === undefined && !submit) return null;
		return { ...(text !== undefined ? { text } : {}), ...(submit ? { submit } : {}) };
	}

	function workspaceEvent(event: WorkspaceEvent): void {
		for (const entry of registry.all()) {
			if (entry.state !== "active") continue;
			for (const observer of entry.activation?.workspaceObservers ?? []) observer(event);
		}
	}

	function fsChanged(payload: WorkspaceFsChangedPayload): void {
		for (const entry of registry.all()) {
			if (entry.state !== "active") continue;
			for (const observer of entry.activation?.fsObservers ?? []) observer(payload);
		}
	}

	function validateSettings(
		update: Record<string, PluginSettingsNamespace | null>,
		current: AppConfig["plugins"],
	): AppConfig["plugins"] {
		const result = validatePluginNamespaces(
			update,
			current,
			(id) => registry.get(id)?.module?.contract.settings,
		);
		if ("refused" in result) throw new Error(result.refused);
		return result.namespaces;
	}

	function settingsChanged(config: AppConfig): void {
		const previous = lastConfig;
		lastConfig = config;
		for (const entry of registry.all()) {
			if (entry.state !== "active") continue;
			const id = entry.manifest.id;
			if (previous && previous.plugins[id] === config.plugins[id]) continue;
			const { enabled: _enabled, ...rest } = config.plugins[id] ?? {};
			for (const observer of entry.activation?.settingsObservers ?? []) observer(rest);
		}
		void reconciler.schedule();
	}

	async function rescan(): Promise<PluginRosterEntry[]> {
		const discovered = discoverExternalPlugins(seams.config().pluginPaths);
		const discoveredDirs = new Set(discovered.map((found) => found.dir));
		for (const entry of registry.all()) {
			if (entry.origin !== "external" || !entry.dir) continue;
			if (discoveredDirs.has(entry.dir)) continue;
			if (entry.state === "active") await deactivate(entry.manifest.id, registry, seams);
			registry.remove(entry.manifest.id);
		}
		for (const found of discovered) {
			const existing = registry.findByDir(found.dir);
			if (found.manifest) {
				if (existing && existing.state === "refused") registry.remove(existing.manifest.id);
				registry.upsertExternal(found.manifest, found.dir);
			} else if (found.refused !== undefined) {
				if (existing && existing.state !== "refused") {
					if (existing.state === "active") await deactivate(existing.manifest.id, registry, seams);
					registry.remove(existing.manifest.id);
				}
				if (existing?.state !== "refused")
					registry.registerRefusedExternal(found.dir, found.refused);
			}
		}
		await reconciler.schedule();
		seams.publishRoster(registry.roster());
		return registry.roster();
	}

	async function retry(id: string): Promise<PluginRosterEntry[]> {
		const entry = registry.get(id);
		if (entry?.state === "failed") registry.setState(id, "disabled");
		await reconciler.schedule();
		seams.publishRoster(registry.roster());
		return registry.roster();
	}

	return {
		roster: () => registry.roster(),
		handleRequest: (method, params, call) => handlePluginRequest(registry, method, params, call),
		serveRoute,
		channelNames: () => pluginChannelNames(registry),
		mcpTools: (owner, cwd) => pluginMcpTools(registry, owner, cwd),
		terminalEnv,
		onTerminalEvent,
		revivePrefill,
		workspaceEvent,
		fsChanged,
		settingsChanged,
		validateSettings,
		reconcile: () => reconciler.schedule(),
		rescan,
		retry,
		piResources: () => pluginPiResources(registry, scope, seams.bundledPluginRuntime),
		toolsExtension: pluginToolsExtension(registry, scope),
		dispose(): void {
			const { order, cycle } = registry.topologicalOrder();
			for (const id of [...[...order].reverse(), ...cycle]) {
				if (registry.get(id)?.state === "active") void deactivate(id, registry, seams);
			}
		},
	};
}

export { callPluginMethod, parsePluginMethod, publishPlugin };
