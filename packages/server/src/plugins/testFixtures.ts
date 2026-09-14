import { type AppConfig, DEFAULT_CONFIG } from "@thinkrail/contracts";
import {
	definePluginContract,
	definePluginManifest,
	PLUGIN_API_GENERATION,
	type PluginContract,
	type PluginDependency,
	type PluginManifest,
} from "@thinkrail/plugin-api";
import {
	definePluginHost,
	type PluginHostActivate,
	type PluginHostModule,
} from "@thinkrail/plugin-api/host";
import { Type } from "typebox";
import type { PluginHostSeams } from "./seams";

export function fixtureManifest(
	id: string,
	overrides: Partial<PluginManifest> = {},
): PluginManifest {
	return definePluginManifest({
		id,
		label: id,
		icon: "puzzle",
		version: "0.0.0",
		apiGeneration: PLUGIN_API_GENERATION,
		wireVersion: 1,
		enabledByDefault: true,
		dependsOn: [] as readonly PluginDependency[],
		contributes: { sideTools: [], fileViewers: [] },
		...overrides,
	});
}

export function fixtureContract(
	id: string,
	overrides: Partial<PluginContract> = {},
): PluginContract {
	return definePluginContract({
		id,
		wireVersion: 1,
		methods: {
			ping: { params: Type.Object({}), result: Type.Object({ pong: Type.Boolean() }) },
		},
		channels: {},
		settings: Type.Object({}),
		...overrides,
	});
}

export function fixtureModule(
	id: string,
	options: {
		manifest?: Partial<PluginManifest>;
		contract?: Partial<PluginContract>;
		activate?: PluginHostActivate<PluginContract>;
	} = {},
): PluginHostModule {
	const contract = fixtureContract(id, options.contract);
	return definePluginHost({
		manifest: fixtureManifest(id, options.manifest),
		contract,
		activate: options.activate ?? (() => undefined),
	}) as PluginHostModule;
}

export function fixtureSeams(
	overrides: Partial<PluginHostSeams> = {},
	config: Partial<AppConfig> = {},
): PluginHostSeams {
	const resolvedConfig: AppConfig = { ...DEFAULT_CONFIG, ...config };
	return {
		dataDir: "/tmp/thinkrail-plugin-tests",
		publish: () => {},
		publishRoster: () => {},
		publicBaseUrl: () => "http://localhost:0",
		terminal: {
			token: () => "token",
			forToken: () => null,
			agentRecord: () => null,
			setAgentRecord: () => {},
			write: () => {},
			list: () => [],
			workspaceForProcess: () => null,
		},
		sessions: { send: async () => {} },
		workspaces: {
			projects: () => [],
			list: () => [],
			get: () => null,
			watch: async () => {},
			suggestName: () => {},
		},
		git: async () => ({ ok: true, out: "", err: "" }),
		config: () => resolvedConfig,
		resourcesChanged: () => {},
		logger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
		bundledPluginRuntime: () => ({ factories: [], skillsDir: null, assetsDir: null }),
		...overrides,
	};
}
