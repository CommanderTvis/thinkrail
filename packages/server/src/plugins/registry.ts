import { basename } from "node:path";
import type {
	PluginOrigin,
	PluginRosterChannel,
	PluginRosterEntry,
	PluginStatus,
	TerminalAgentRecord,
	WorkspaceFsChangedPayload,
} from "@thinkrail/contracts";
import {
	PLUGIN_API_GENERATION,
	type PluginContract,
	type PluginManifest,
	type PluginToolDefinition,
	type TerminalRef,
} from "@thinkrail/plugin-api";
import type {
	PluginCall,
	PluginDisposer,
	PluginHostModule,
	RevivePrefill,
	TerminalEvent,
	WorkspaceEvent,
} from "@thinkrail/plugin-api/host";
import { Value } from "typebox/value";

export type MethodHandler = (params: unknown, call: PluginCall) => unknown | Promise<unknown>;
export type RouteHandler = (request: Request, subpath: string) => Response | Promise<Response>;
export type EnvContributor = (terminal: TerminalRef) => Record<string, string>;
export type ReviveHook = (
	terminal: TerminalRef,
	record: TerminalAgentRecord,
) => RevivePrefill | null;
export type TerminalObserver = (event: TerminalEvent) => void;
export type WorkspaceObserver = (event: WorkspaceEvent) => void;
export type FsObserver = (payload: WorkspaceFsChangedPayload) => void;
export type SettingsObserver = (next: Record<string, unknown>) => void;

export interface ActivationTables {
	activationId: number;
	disposer?: PluginDisposer;
	inFlight: number;
	drainWaiters: (() => void)[];
	methods: Map<string, MethodHandler>;
	route?: RouteHandler;
	tools: PluginToolDefinition[];
	envContributors: EnvContributor[];
	externalFiles: ((workspaceId: string) => readonly string[])[];
	terminalObservers: TerminalObserver[];
	reviveHooks: ReviveHook[];
	workspaceObservers: WorkspaceObserver[];
	fsObservers: FsObserver[];
	settingsObservers: SettingsObserver[];
}

export interface PluginEntry {
	manifest: PluginManifest;
	origin: PluginOrigin;
	dir?: string;
	module?: PluginHostModule;
	state: PluginStatus;
	reason?: string;
	activation?: ActivationTables;
	readonly localChannelListeners: Map<string, Set<(payload: unknown) => void>>;
}

function placeholderManifest(key: string): PluginManifest {
	return {
		id: key,
		label: key,
		icon: "puzzle",
		version: "0.0.0",
		apiGeneration: PLUGIN_API_GENERATION,
		wireVersion: 0,
		enabledByDefault: false,
		dependsOn: [],
		contributes: { sideTools: [], fileViewers: [] },
	};
}

function toRosterChannels(entry: PluginEntry): Record<string, PluginRosterChannel> {
	if (!entry.module) return {};
	const channels: Record<string, PluginRosterChannel> = {};
	for (const [name, spec] of Object.entries(entry.module.contract.channels)) {
		channels[name] =
			spec.kind === "state"
				? { kind: "state", snapshot: spec.snapshot, key: [...spec.key] }
				: { kind: "event" };
	}
	return channels;
}

function toRosterEntry(entry: PluginEntry): PluginRosterEntry {
	return {
		id: entry.manifest.id,
		label: entry.manifest.label,
		...(entry.manifest.description !== undefined
			? { description: entry.manifest.description }
			: {}),
		icon: entry.manifest.icon,
		version: entry.manifest.version,
		wireVersion: entry.manifest.wireVersion,
		origin: entry.origin,
		status: entry.state,
		...(entry.reason !== undefined ? { reason: entry.reason } : {}),
		dependsOn: entry.manifest.dependsOn.map((dep) => dep.id),
		modifiesSystemPrompt: entry.manifest.pi?.modifiesSystemPrompt ?? false,
		contributes: entry.manifest.contributes,
		channels: toRosterChannels(entry),
		...(entry.origin === "external" && entry.manifest.web !== undefined
			? {
					web: {
						module: entry.manifest.web,
						...(entry.manifest.styles !== undefined ? { styles: entry.manifest.styles } : {}),
					},
				}
			: {}),
		...(entry.manifest.assets !== undefined ? { assets: entry.manifest.assets } : {}),
	};
}

export type ContractIntake = { ok: true } | { refused: string };

export function validateContractIntake(contract: PluginContract): ContractIntake {
	const properties = contract.settings?.properties;
	if (typeof properties !== "object" || properties === null) {
		return {
			refused: `plugin ${contract.id} declares no settings schema (expected a typebox object)`,
		};
	}
	for (const [name, channel] of Object.entries(contract.channels ?? {})) {
		if (channel.kind === "state" && !(channel.snapshot in (contract.methods ?? {}))) {
			return {
				refused: `plugin ${contract.id} channel "${name}" names unknown snapshot method "${channel.snapshot}"`,
			};
		}
	}
	if ("enabled" in properties) {
		return { refused: `plugin ${contract.id} settings schema may not declare "enabled"` };
	}
	return { ok: true };
}

export class PluginRegistry {
	private readonly entries = new Map<string, PluginEntry>();
	private activationCounter = 0;

	nextActivationId(): number {
		this.activationCounter += 1;
		return this.activationCounter;
	}

	registerBuiltin(module: PluginHostModule): void {
		this.entries.set(module.manifest.id, {
			manifest: module.manifest,
			origin: "builtin",
			module,
			state: "disabled",
			localChannelListeners: new Map(),
		});
	}

	/** Registers a builtin plugin that ships no host half at all — its manifest declares no `host`. */
	registerBuiltinManifest(manifest: PluginManifest): void {
		this.entries.set(manifest.id, {
			manifest,
			origin: "builtin",
			state: "disabled",
			localChannelListeners: new Map(),
		});
	}

	registerRefusedBuiltin(id: string, reason: string): void {
		this.entries.set(id, {
			manifest: placeholderManifest(id),
			origin: "builtin",
			state: "refused",
			reason,
			localChannelListeners: new Map(),
		});
	}

	upsertExternal(manifest: PluginManifest, dir: string): void {
		const existing = this.entries.get(manifest.id);
		if (existing && existing.origin === "external") {
			existing.dir = dir;
			if (Bun.deepEquals(existing.manifest, manifest)) return;
			existing.manifest = manifest;
			delete existing.module;
			existing.state = "disabled";
			delete existing.reason;
			return;
		}
		this.entries.set(manifest.id, {
			manifest,
			origin: "external",
			dir,
			state: "disabled",
			localChannelListeners: new Map(),
		});
	}

	registerRefusedExternal(dir: string, reason: string): void {
		const key = `__refused:${basename(dir)}`;
		this.entries.set(key, {
			manifest: placeholderManifest(key),
			origin: "external",
			dir,
			state: "refused",
			reason,
			localChannelListeners: new Map(),
		});
	}

	get(id: string): PluginEntry | undefined {
		return this.entries.get(id);
	}

	all(): PluginEntry[] {
		return [...this.entries.values()];
	}

	ids(): string[] {
		return [...this.entries.keys()];
	}

	findByDir(dir: string): PluginEntry | undefined {
		return this.all().find((entry) => entry.dir === dir);
	}

	remove(id: string): void {
		this.entries.delete(id);
	}

	setState(id: string, state: PluginStatus, reason?: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		entry.state = state;
		if (reason === undefined) delete entry.reason;
		else entry.reason = reason;
	}

	setModule(id: string, module: PluginHostModule): void {
		const entry = this.entries.get(id);
		if (entry) entry.module = module;
	}

	setActivation(id: string, tables: ActivationTables | undefined): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		if (tables === undefined) delete entry.activation;
		else entry.activation = tables;
	}

	activationOf(id: string): ActivationTables | undefined {
		return this.entries.get(id)?.activation;
	}

	roster(): PluginRosterEntry[] {
		return this.all().map(toRosterEntry);
	}

	topologicalOrder(): { order: string[]; cycle: string[] } {
		const ids = this.ids();
		const idSet = new Set(ids);
		const inDegree = new Map(ids.map((id) => [id, 0]));
		const dependents = new Map<string, string[]>(ids.map((id) => [id, []]));
		for (const id of ids) {
			const entry = this.entries.get(id);
			if (!entry) continue;
			for (const dep of entry.manifest.dependsOn) {
				if (!idSet.has(dep.id)) continue;
				dependents.get(dep.id)?.push(id);
				inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
			}
		}
		const queue = ids.filter((id) => inDegree.get(id) === 0);
		const order: string[] = [];
		while (queue.length > 0) {
			const id = queue.shift();
			if (id === undefined) break;
			order.push(id);
			for (const next of dependents.get(id) ?? []) {
				const remaining = (inDegree.get(next) ?? 0) - 1;
				inDegree.set(next, remaining);
				if (remaining === 0) queue.push(next);
			}
		}
		const ordered = new Set(order);
		return { order, cycle: ids.filter((id) => !ordered.has(id)) };
	}

	subscribeLocal(id: string, channelName: string, handler: (payload: unknown) => void): () => void {
		const entry = this.entries.get(id);
		if (!entry) return () => {};
		let listeners = entry.localChannelListeners.get(channelName);
		if (!listeners) {
			listeners = new Set();
			entry.localChannelListeners.set(channelName, listeners);
		}
		listeners.add(handler);
		return () => listeners?.delete(handler);
	}

	publishLocal(id: string, channelName: string, payload: unknown): void {
		const listeners = this.entries.get(id)?.localChannelListeners.get(channelName);
		if (!listeners) return;
		for (const handler of listeners) handler(payload);
	}
}

export function beginCall(activation: ActivationTables): void {
	activation.inFlight += 1;
}

export function endCall(activation: ActivationTables): void {
	activation.inFlight -= 1;
	if (activation.inFlight === 0) {
		const waiters = activation.drainWaiters.splice(0);
		for (const waiter of waiters) waiter();
	}
}

export function drain(activation: ActivationTables, timeoutMs: number): Promise<void> {
	if (activation.inFlight === 0) return Promise.resolve();
	return new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		activation.drainWaiters.push(finish);
		setTimeout(finish, timeoutMs);
	});
}

export function validatePluginParams(
	contract: PluginContract,
	name: string,
	params: unknown,
): { ok: true } | { error: string } {
	const spec = contract.methods[name];
	if (!spec) return { error: "Unknown method" };
	if (Value.Check(spec.params, params)) return { ok: true };
	const [first] = Value.Errors(spec.params, params);
	return {
		error: first ? `${first.instancePath || "params"}: ${first.message}` : "invalid params",
	};
}
