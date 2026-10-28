import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
	PluginRosterChannel,
	PluginRosterEntry,
	PluginSettingsNamespace,
	PluginStatus,
	Project,
	Workspace,
	WorkspaceFsChangedPayload,
} from "@thinkrail/contracts";
import {
	type PluginContract,
	type PluginManifest,
	type PluginToolDefinition,
	pluginChannelName,
} from "@thinkrail/plugin-api";
import type {
	PluginCall,
	PluginDisposer,
	PluginHostContext,
	PluginHostModule,
	WorkspaceEvent,
} from "@thinkrail/plugin-api/host";
import { Value } from "typebox/value";
import { joinPath, type TabFs } from "./fs";

/** What a plugin running in the tab reaches of the tab host; everything a process host would add is absent. */
export interface TabPluginSeams {
	fs: TabFs;
	publish(channel: string, data: unknown): void;
	plugins(): Record<string, PluginSettingsNamespace>;
	projects(): readonly Project[];
	workspaces(projectId?: string): readonly Workspace[];
	sendToSession(sessionId: string, text: string): Promise<void>;
	persist(): void;
}

type Handler = (params: unknown, call: PluginCall) => unknown;

interface Activation {
	methods: Map<string, Handler>;
	tools: PluginToolDefinition[];
	workspaceObservers: ((event: WorkspaceEvent) => void)[];
	fsObservers: ((payload: WorkspaceFsChangedPayload) => void)[];
	settingsObservers: ((next: Record<string, unknown>) => void)[];
	disposer?: PluginDisposer;
}

interface Entry {
	manifest: PluginManifest;
	module?: PluginHostModule;
	status: PluginStatus;
	reason?: string;
	activation?: Activation;
}

const STATE_DIR = "/.thinkrail/plugins";

export function unsupportedInTab(manifest: PluginManifest): string {
	return `${manifest.label} needs a host process; it can't run in the ThinkRail Playground`;
}

export class TabPlugins {
	private readonly entries = new Map<string, Entry>();
	private readonly local = new Map<string, Set<(payload: unknown) => void>>();

	constructor(
		private readonly seams: TabPluginSeams,
		modules: readonly PluginHostModule[],
		manifests: readonly PluginManifest[],
	) {
		for (const manifest of manifests) {
			this.entries.set(
				manifest.id,
				manifest.runsInBrowserTab === false
					? { manifest, status: "refused", reason: unsupportedInTab(manifest) }
					: { manifest, status: "disabled" },
			);
		}
		for (const module of modules) {
			const entry = this.entries.get(module.manifest.id);
			if (entry && entry.status !== "refused") entry.module = module;
			else if (!entry)
				this.entries.set(module.manifest.id, {
					manifest: module.manifest,
					module,
					status: "disabled",
				});
		}
	}

	private enabled(manifest: PluginManifest): boolean {
		return this.seams.plugins()[manifest.id]?.enabled ?? manifest.enabledByDefault;
	}

	async reconcile(): Promise<void> {
		for (const entry of this.entries.values()) {
			if (entry.status === "refused") continue;
			const want = this.enabled(entry.manifest);
			if (want && entry.status !== "active") await this.activate(entry);
			if (!want && entry.status === "active") await this.deactivate(entry);
			if (want && entry.status === "active") {
				for (const observer of entry.activation?.settingsObservers ?? [])
					observer(this.settingsOf(entry.manifest.id));
			}
		}
	}

	private settingsOf(id: string): Record<string, unknown> {
		const { enabled: _enabled, ...rest } = this.seams.plugins()[id] ?? {};
		const schema = this.entries.get(id)?.module?.contract.settings;
		return schema ? (Value.Default(schema, rest) as Record<string, unknown>) : rest;
	}

	private async activate(entry: Entry): Promise<void> {
		const missing = entry.manifest.dependsOn.find(
			(dep) => this.entries.get(dep.id)?.status !== "active",
		);
		if (missing) {
			entry.status = "refused";
			entry.reason = `depends on ${missing.id}, which is not active`;
			return;
		}
		if (!entry.module) {
			entry.status = "active";
			return;
		}
		const activation: Activation = {
			methods: new Map(),
			tools: [],
			workspaceObservers: [],
			fsObservers: [],
			settingsObservers: [],
		};
		entry.activation = activation;
		try {
			const disposer = await entry.module.activate(this.context(entry, activation));
			if (disposer) activation.disposer = disposer;
			entry.status = "active";
			delete entry.reason;
		} catch (error) {
			delete entry.activation;
			entry.status = "failed";
			entry.reason = (error as Error).message;
		}
	}

	private async deactivate(entry: Entry): Promise<void> {
		const disposer = entry.activation?.disposer;
		delete entry.activation;
		entry.status = "disabled";
		await disposer?.();
	}

	private context(entry: Entry, activation: Activation): PluginHostContext<PluginContract> {
		const id = entry.manifest.id;
		const live = () => entry.activation === activation;
		const unsupported = (what: string) => () => {
			throw new Error(`${what} is not available in the ThinkRail Playground`);
		};
		const statePath = (name: string) => joinPath(STATE_DIR, id, `${name}.json`);
		const { fs } = this.seams;
		const log = (level: string) => (msg: string, fields?: object) =>
			console[
				level === "debug"
					? "debug"
					: level === "info"
						? "info"
						: level === "warn"
							? "warn"
							: "error"
			](`[plugin ${id}] ${msg}`, fields ?? "");
		return {
			id,
			log: { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") },
			assetsDir: null,
			method: (name, handler) => {
				if (live()) activation.methods.set(name, handler as Handler);
			},
			publish: (channel, payload) => {
				if (!live()) return;
				const name = pluginChannelName(id, channel);
				this.seams.publish(name, payload);
				for (const handler of this.local.get(name) ?? []) handler(payload);
			},
			route: () => undefined,
			publicBaseUrl: () => location.origin,
			externalFiles: () => undefined,
			tool: (definition) => {
				if (live()) activation.tools.push(definition);
			},
			terminalEnv: () => undefined,
			terminalToken: unsupported("Terminals"),
			terminalForToken: () => null,
			agentRecord: () => null,
			setAgentRecord: () => undefined,
			onTerminal: () => undefined,
			terminals: () => [],
			workspaceForProcess: () => null,
			revivePrefill: () => undefined,
			writeTerminal: unsupported("Terminals"),
			sendToSession: (sessionId, text) => this.seams.sendToSession(sessionId, text),
			projects: () => this.seams.projects(),
			workspaces: (projectId) => this.seams.workspaces(projectId),
			workspace: (workspaceId) => this.seams.workspaces().find((w) => w.id === workspaceId) ?? null,
			watchWorkspace: async () => undefined,
			onWorkspace: (handler) => {
				if (live()) activation.workspaceObservers.push(handler);
			},
			onFsChanged: (handler) => {
				if (live()) activation.fsObservers.push(handler);
			},
			settings: () => this.settingsOf(id) as never,
			onSettings: (handler) => {
				if (live())
					activation.settingsObservers.push(handler as (next: Record<string, unknown>) => void);
			},
			readState: <T>(name: string, fallback: T): T => {
				try {
					return JSON.parse(fs.readFileSync(statePath(name), "utf8") as string) as T;
				} catch {
					return fallback;
				}
			},
			writeState: (name, value) => {
				fs.mkdirSync(joinPath(STATE_DIR, id), { recursive: true });
				fs.writeFileSync(statePath(name), JSON.stringify(value));
				this.seams.persist();
			},
			git: async () => ({
				ok: false,
				out: "",
				err: "git CLI is not available in a browser tab",
				failure: "launch",
			}),
			dependency: (contract) => ({
				request: (name, params) =>
					this.call(contract.id, name as string, params, { clientKey: `plugin:${id}` }) as never,
				subscribe: (channel, handler) => {
					const name = pluginChannelName(contract.id, channel as string);
					const set = this.local.get(name) ?? new Set();
					this.local.set(name, set);
					set.add(handler as (payload: unknown) => void);
					return () => set.delete(handler as (payload: unknown) => void);
				},
			}),
		};
	}

	async call(id: string, name: string, params: unknown, call: PluginCall): Promise<unknown> {
		const entry = this.entries.get(id);
		const spec = entry?.module?.contract.methods[name];
		if (!entry || !spec) throw new Error("Unknown method");
		if (entry.status !== "active" || !entry.activation)
			throw new Error(`Plugin ${id} is ${entry.status}`);
		if (!Value.Check(spec.params, params)) {
			const [first] = Value.Errors(spec.params, params);
			throw new Error(`Invalid params for plugin.${id}.${name}: ${first?.message ?? "invalid"}`);
		}
		const handler = entry.activation.methods.get(name);
		if (!handler) throw new Error("Unknown method");
		return handler(params, call);
	}

	roster(): PluginRosterEntry[] {
		return [...this.entries.values()].map(({ manifest, module, status, reason }) => {
			const channels: Record<string, PluginRosterChannel> = {};
			for (const [name, spec] of Object.entries(module?.contract.channels ?? {})) {
				channels[name] =
					spec.kind === "state"
						? { kind: "state", snapshot: spec.snapshot, key: [...spec.key] }
						: { kind: "event" };
			}
			return {
				id: manifest.id,
				label: manifest.label,
				...(manifest.description !== undefined ? { description: manifest.description } : {}),
				icon: manifest.icon,
				version: manifest.version,
				wireVersion: manifest.wireVersion,
				origin: "builtin",
				status,
				...(reason !== undefined ? { reason } : {}),
				dependsOn: manifest.dependsOn.map((dep) => dep.id),
				modifiesSystemPrompt: manifest.pi?.modifiesSystemPrompt ?? false,
				contributes: manifest.contributes,
				channels,
				...(manifest.assets !== undefined ? { assets: manifest.assets } : {}),
				...(manifest.runsInBrowserTab === false ? { runsInBrowserTab: false as const } : {}),
			};
		});
	}

	agentTools(cwd: string): AgentTool[] {
		const tools: AgentTool[] = [];
		for (const entry of this.entries.values()) {
			for (const definition of entry.activation?.tools ?? []) {
				if (!definition.surfaces.includes("agent")) continue;
				tools.push({
					name: definition.name,
					label: definition.label,
					description: definition.description,
					parameters: definition.parameters,
					execute: async (_toolCallId, params) => {
						const result = await definition.run(params as never, { cwd } as never);
						return {
							content: [{ type: "text", text: result.text }],
							details: (result.details ?? {}) as never,
						};
					},
				} as AgentTool);
			}
		}
		return tools;
	}

	workspaceEvent(event: WorkspaceEvent): void {
		for (const entry of this.entries.values())
			for (const observer of entry.activation?.workspaceObservers ?? []) observer(event);
	}

	fsChanged(payload: WorkspaceFsChangedPayload): void {
		for (const entry of this.entries.values())
			for (const observer of entry.activation?.fsObservers ?? []) observer(payload);
	}
}
