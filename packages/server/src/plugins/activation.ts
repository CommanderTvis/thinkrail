import { resolve } from "node:path";
import { type PluginContract, pluginChannelName } from "@thinkrail/plugin-api";
import type { DependencyHandle, PluginHostContext, PluginLogger } from "@thinkrail/plugin-api/host";
import { readPluginState, writePluginState } from "../persistence";
import { importExternalHost } from "./external";
import { devBuiltinAssetsDir } from "./piResources";
import {
	type ActivationTables,
	drain,
	type MethodHandler,
	type PluginRegistry,
	validateContractIntake,
} from "./registry";
import type { PluginHostSeams } from "./seams";
import { callPluginMethod } from "./wire";

export const DRAIN_TIMEOUT_MS = 5000;
export const DISPOSE_TIMEOUT_MS = 5000;

/** Resolves a plugin's assets directory, shared by `PluginHostContext.assetsDir` and `serveRoute`'s static asset serving. */
export function resolveAssetsDir(
	entry: { origin: string; dir?: string; manifest: { assets?: string } } | undefined,
	seams: PluginHostSeams,
	id: string,
): string | null {
	if (entry?.origin === "external") {
		if (!entry.dir || entry.manifest.assets === undefined) return null;
		return resolve(entry.dir, entry.manifest.assets);
	}
	if (entry?.origin === "builtin") {
		return seams.bundledPluginRuntime(id).assetsDir ?? devBuiltinAssetsDir(id);
	}
	return null;
}

async function withTimeout(promise: Promise<void>, ms: number): Promise<"settled" | "timeout"> {
	return Promise.race([
		promise.then((): "settled" => "settled"),
		new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
	]);
}

function toPluginLogger(base: ReturnType<PluginHostSeams["logger"]>): PluginLogger {
	return {
		debug: (msg, fields) => base.debug(msg, fields),
		info: (msg, fields) => base.info(msg, fields),
		warn: (msg, fields) => base.warn(msg, fields),
		error: (msg, fields) => base.error(msg, fields),
	};
}

function emptyTables(activationId: number): ActivationTables {
	return {
		activationId,
		inFlight: 0,
		drainWaiters: [],
		methods: new Map(),
		tools: [],
		envContributors: [],
		terminalObservers: [],
		reviveHooks: [],
		workspaceObservers: [],
		fsObservers: [],
		settingsObservers: [],
	};
}

function createHostContext(
	id: string,
	seams: PluginHostSeams,
	registry: PluginRegistry,
	activationId: number,
): PluginHostContext<PluginContract> {
	const isLive = () => registry.activationOf(id)?.activationId === activationId;
	const live = () => registry.activationOf(id);

	return {
		id,
		log: toPluginLogger(seams.logger(id)),
		get assetsDir(): string | null {
			return resolveAssetsDir(registry.get(id), seams, id);
		},

		method(name, handler) {
			if (!isLive()) return;
			live()?.methods.set(name, handler as MethodHandler);
		},

		publish(channel, payload, target) {
			if (!isLive()) return;
			const name = pluginChannelName(id, channel);
			seams.publish(name, payload, target);
			registry.publishLocal(id, name, payload);
		},

		route(handler) {
			if (!isLive()) return;
			const tables = live();
			if (tables) tables.route = handler;
		},
		publicBaseUrl: () => seams.publicBaseUrl(),

		tool(definition) {
			if (!isLive()) return;
			live()?.tools.push(definition);
		},

		terminalEnv(contributor) {
			if (!isLive()) return;
			live()?.envContributors.push(contributor);
		},

		terminalToken: (terminal) => seams.terminal.token(terminal),
		terminalForToken: (token) => seams.terminal.forToken(token),

		agentRecord: (terminal) => seams.terminal.agentRecord(terminal),
		setAgentRecord: (terminal, record) => seams.terminal.setAgentRecord(terminal, record),

		onTerminal(handler) {
			if (!isLive()) return;
			live()?.terminalObservers.push(handler);
		},
		terminals: () => seams.terminal.list(),
		workspaceForProcess: (pid) => seams.terminal.workspaceForProcess(pid),

		revivePrefill(hook) {
			if (!isLive()) return;
			live()?.reviveHooks.push(hook);
		},

		writeTerminal: (terminal, data) => seams.terminal.write(terminal, data),

		sendToSession: (sessionId, text) => seams.sessions.send(sessionId, text),

		projects: () => seams.workspaces.projects(),
		workspaces: (projectId) => seams.workspaces.list(projectId),
		workspace: (workspaceId) => seams.workspaces.get(workspaceId),
		watchWorkspace: (workspaceId) => seams.workspaces.watch(workspaceId),
		onWorkspace(handler) {
			if (!isLive()) return;
			live()?.workspaceObservers.push(handler);
		},
		onFsChanged(handler) {
			if (!isLive()) return;
			live()?.fsObservers.push(handler);
		},
		suggestWorkspaceName: (workspaceId, hint) => seams.workspaces.suggestName(workspaceId, hint),

		settings: () => {
			const { enabled: _enabled, ...rest } = seams.config().plugins[id] ?? {};
			return rest;
		},
		onSettings(handler) {
			if (!isLive()) return;
			live()?.settingsObservers.push(handler as (next: Record<string, unknown>) => void);
		},

		readState: (name, fallback) => readPluginState(id, name, fallback),
		writeState: (name, value) => writePluginState(id, name, value),

		git: (cwd, args, options) => seams.git(cwd, args, options),

		dependency<D extends PluginContract>(depContract: D): DependencyHandle<D> {
			return {
				request: (name, params) =>
					callPluginMethod(registry, depContract.id, name as string, params, {
						clientKey: `plugin:${id}`,
					}) as ReturnType<DependencyHandle<D>["request"]>,
				subscribe: (channel, handler) =>
					registry.subscribeLocal(
						depContract.id,
						pluginChannelName(depContract.id, channel as string),
						handler as (payload: unknown) => void,
					),
			};
		},
	};
}

export async function activate(
	id: string,
	registry: PluginRegistry,
	seams: PluginHostSeams,
): Promise<void> {
	const entry = registry.get(id);
	if (!entry) return;
	let module = entry.module;
	if (!module) {
		if (!entry.manifest.host) {
			registry.setState(id, "active");
			return;
		}
		if (entry.origin === "builtin") {
			registry.setState(id, "failed", `plugin ${id} has no host module registered`);
			return;
		}
		if (!entry.dir) {
			registry.setState(id, "active");
			return;
		}
		try {
			module = await importExternalHost(entry.dir, entry.manifest.host);
			registry.setModule(id, module);
		} catch (err) {
			registry.setState(id, "failed", `failed to load ${id}: ${(err as Error).message}`);
			return;
		}
	}

	const intake = validateContractIntake(module.contract);
	if ("refused" in intake) {
		registry.setState(id, "refused", intake.refused);
		return;
	}

	const activationId = registry.nextActivationId();
	const tables = emptyTables(activationId);
	registry.setActivation(id, tables);
	const ctx = createHostContext(id, seams, registry, activationId);
	try {
		const disposer = await module.activate(ctx);
		if (registry.activationOf(id)?.activationId !== activationId) return;
		if (disposer !== undefined) tables.disposer = disposer;
		registry.setState(id, "active");
	} catch (err) {
		registry.setActivation(id, undefined);
		registry.setState(id, "failed", (err as Error).message);
	}
}

export async function deactivate(
	id: string,
	registry: PluginRegistry,
	seams: PluginHostSeams,
	drainTimeoutMs = DRAIN_TIMEOUT_MS,
	disposeTimeoutMs = DISPOSE_TIMEOUT_MS,
): Promise<void> {
	const entry = registry.get(id);
	if (!entry) return;
	const tables = entry.activation;
	registry.setState(id, "disabled");
	if (!tables) return;
	await drain(tables, drainTimeoutMs);
	if (tables.disposer) {
		const outcome = await withTimeout(
			Promise.resolve()
				.then(() => tables.disposer?.())
				.then(() => undefined),
			disposeTimeoutMs,
		);
		if (outcome === "timeout") {
			seams.logger(id).warn(`plugin ${id} disposer did not settle within ${disposeTimeoutMs}ms`);
		}
	}
	if (registry.activationOf(id)?.activationId === tables.activationId)
		registry.setActivation(id, undefined);
}
