import type { PluginRosterEntry } from "@thinkrail/contracts";
import type { PluginDisposer } from "@thinkrail/plugin-api/web";
import { unregisterToolRenderer } from "../../chat/toolRegistry";
import { useAppStore } from "../../store";
import { usePluginRegistry } from "../registry";
import { BUILTIN_WEB_PLUGINS } from "./builtin";
import { type ActivationGuard, createWebContext } from "./context";
import { loadExternalWeb, removeStylesheet } from "./external";
import { installPluginRuntime } from "./runtimeRegistry";

const disposers = new Map<string, PluginDisposer | undefined>();

async function mount(entry: PluginRosterEntry): Promise<void> {
	try {
		const builtin = BUILTIN_WEB_PLUGINS.find((candidate) => candidate.manifest.id === entry.id);
		if (builtin && builtin.manifest.wireVersion !== entry.wireVersion) {
			console.error(
				`plugin "${entry.id}" wireVersion mismatch: host declares ${entry.wireVersion}, client bundle is ${builtin.manifest.wireVersion} — staying dormant`,
			);
			return;
		}
		const module = builtin ? await builtin.load() : await loadExternalWeb(entry);
		const activation: ActivationGuard = { current: true, disposers: [] };
		const ctx = createWebContext(entry, activation);
		let disposer: PluginDisposer | undefined;
		try {
			disposer = module.activate(ctx) ?? undefined;
		} finally {
			activation.current = false;
		}
		disposers.set(entry.id, async () => {
			await disposer?.();
			for (const dispose of activation.disposers) await dispose();
		});
		usePluginRegistry.getState().setActive(entry.id, true);
	} catch (error) {
		console.error(`plugin "${entry.id}" failed to activate`, error);
	}
}

async function unmount(pluginId: string): Promise<void> {
	const registry = usePluginRegistry.getState();
	for (const entry of registry.toolRenderers) {
		if (entry.pluginId === pluginId) unregisterToolRenderer(entry.value);
	}
	if (registry.roster.find((candidate) => candidate.id === pluginId)?.web?.styles) {
		removeStylesheet(pluginId);
	}
	const disposer = disposers.get(pluginId);
	disposers.delete(pluginId);
	try {
		await disposer?.();
	} catch (error) {
		console.error(`plugin "${pluginId}" failed to dispose cleanly`, error);
	}
	registry.removePlugin(pluginId);
}

export async function reconcile(roster: readonly PluginRosterEntry[]): Promise<void> {
	const registry = usePluginRegistry.getState();
	for (const pluginId of registry.active) {
		const entry = roster.find((candidate) => candidate.id === pluginId);
		if (entry?.status !== "active") await unmount(pluginId);
	}
	for (const entry of roster) {
		if (entry.status === "active" && !usePluginRegistry.getState().active.has(entry.id)) {
			await mount(entry);
		}
	}
}

let queue: Promise<void> = Promise.resolve();

function scheduleReconcile(roster: readonly PluginRosterEntry[]): void {
	queue = queue.then(() => reconcile(roster));
}

export function initPluginLoader(): void {
	installPluginRuntime();
	for (const { manifest } of BUILTIN_WEB_PLUGINS)
		usePluginRegistry.getState().registerManifest(manifest);
	usePluginRegistry.getState().setRoster(useAppStore.getState().pluginRoster);
	scheduleReconcile(useAppStore.getState().pluginRoster);
	useAppStore.subscribe((state, previous) => {
		if (state.pluginRoster === previous.pluginRoster) return;
		usePluginRegistry.getState().setRoster(state.pluginRoster);
		scheduleReconcile(state.pluginRoster);
	});
}
