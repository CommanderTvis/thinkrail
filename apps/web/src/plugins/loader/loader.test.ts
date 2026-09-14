import { beforeEach, expect, mock, test } from "bun:test";
import type { PluginRosterEntry } from "@thinkrail/contracts";
import type { PluginManifest } from "@thinkrail/plugin-api";
import type { PluginWebModule } from "@thinkrail/plugin-api/web";

let activateCalls: string[] = [];
let disposeCalls: string[] = [];

function fakeManifest(id: string, wireVersion = 1): PluginManifest {
	return {
		id,
		label: id,
		icon: "puzzle-2",
		version: "0.0.0",
		apiGeneration: 1,
		wireVersion,
		enabledByDefault: true,
		dependsOn: [],
		contributes: { sideTools: [], fileViewers: [] },
	};
}

function fakeModule(id: string): PluginWebModule {
	return {
		activate: () => {
			activateCalls.push(id);
			return () => {
				disposeCalls.push(id);
			};
		},
	};
}

mock.module("./builtin", () => ({
	BUILTIN_WEB_PLUGINS: [
		{ manifest: fakeManifest("demo"), load: async () => fakeModule("demo") },
		{ manifest: fakeManifest("skewed", 2), load: async () => fakeModule("skewed") },
	],
}));

const { reconcile } = await import("./loader");
const { usePluginRegistry } = await import("../registry");

function rosterEntry(id: string, overrides: Partial<PluginRosterEntry> = {}): PluginRosterEntry {
	return {
		id,
		label: id,
		icon: "puzzle-2",
		version: "0.0.0",
		wireVersion: 1,
		origin: "builtin",
		status: "active",
		dependsOn: [],
		modifiesSystemPrompt: false,
		contributes: { sideTools: [], fileViewers: [] },
		channels: {},
		...overrides,
	};
}

beforeEach(() => {
	activateCalls = [];
	disposeCalls = [];
	usePluginRegistry.setState({
		manifests: {},
		roster: [],
		active: new Set(),
		sideTools: [],
		settingsSections: [],
		companions: [],
		fileViewers: [],
		tabDecorators: [],
		launchers: [],
		workspaceActions: [],
		terminalAccessories: [],
		slots: { fileIcon: [], documentLink: [], writtenPathGroup: [] },
		toolRenderers: [],
	});
});

test("mounts an active roster entry and marks it active", async () => {
	await reconcile([rosterEntry("demo")]);
	expect(activateCalls).toEqual(["demo"]);
	expect(usePluginRegistry.getState().active.has("demo")).toBe(true);
});

test("unmounts a plugin that leaves the roster, running its disposer and clearing its rows", async () => {
	usePluginRegistry
		.getState()
		.addSideTool("demo", { tool: "plugin:demo:x", component: () => null });
	await reconcile([rosterEntry("demo")]);
	await reconcile([]);
	expect(disposeCalls).toEqual(["demo"]);
	expect(usePluginRegistry.getState().active.has("demo")).toBe(false);
	expect(usePluginRegistry.getState().sideTools).toEqual([]);
});

test("unmounts a plugin the roster marks disabled", async () => {
	await reconcile([rosterEntry("demo")]);
	await reconcile([rosterEntry("demo", { status: "disabled" })]);
	expect(disposeCalls).toEqual(["demo"]);
});

test("a wireVersion mismatch between the host and the client bundle stays dormant", async () => {
	await reconcile([rosterEntry("skewed", { wireVersion: 1 })]);
	expect(activateCalls).toEqual([]);
	expect(usePluginRegistry.getState().active.has("skewed")).toBe(false);
});
