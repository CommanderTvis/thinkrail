import { expect, test } from "bun:test";
import { Type } from "typebox";
import { activate } from "./activation";
import { PluginRegistry } from "./registry";
import { fixtureModule, fixtureSeams } from "./testFixtures";
import {
	callPluginMethod,
	handlePluginRequest,
	parsePluginMethod,
	pluginChannelNames,
} from "./wire";

const CALL = { clientKey: "test" };

test("parsePluginMethod splits plugin.<id>.<name>", () => {
	expect(parsePluginMethod("plugin.spec-dialect.getTree")).toEqual({
		id: "spec-dialect",
		name: "getTree",
	});
	expect(parsePluginMethod("plugins.list")).toBeNull();
});

test("an unknown plugin id answers Unknown method", async () => {
	const registry = new PluginRegistry();
	await expect(handlePluginRequest(registry, "plugin.nope.getTree", {}, CALL)).rejects.toThrow(
		"Unknown method",
	);
});

test("a known plugin with an unknown method name answers Unknown method", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(fixtureModule("spec-dialect", { manifest: { enabledByDefault: true } }));
	await activate("spec-dialect", registry, fixtureSeams());
	await expect(callPluginMethod(registry, "spec-dialect", "notAMethod", {}, CALL)).rejects.toThrow(
		"Unknown method",
	);
});

test("a known method on a disabled plugin answers the disabled error", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(fixtureModule("spec-dialect"));
	await expect(callPluginMethod(registry, "spec-dialect", "ping", {}, CALL)).rejects.toThrow(
		"Plugin spec-dialect is disabled",
	);
});

test("a validation error names the offending path", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			manifest: { enabledByDefault: true },
			contract: {
				methods: {
					setName: { params: Type.Object({ name: Type.String() }), result: Type.Object({}) },
				},
			},
			activate: (ctx) => {
				ctx.method("setName", () => ({}));
				return undefined;
			},
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());
	await expect(
		callPluginMethod(registry, "spec-dialect", "setName", { name: 5 }, CALL),
	).rejects.toThrow(/\/name/);
});

test("a registered handler runs and returns its result", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			manifest: { enabledByDefault: true },
			activate: (ctx) => {
				ctx.method("ping", () => ({ pong: true }));
				return undefined;
			},
		}),
	);
	await activate("spec-dialect", registry, fixtureSeams());
	expect(await callPluginMethod(registry, "spec-dialect", "ping", {}, CALL)).toEqual({
		pong: true,
	});
});

test("pluginChannelNames lists only active plugins' channels, wire-named", async () => {
	const registry = new PluginRegistry();
	registry.registerBuiltin(
		fixtureModule("spec-dialect", {
			manifest: { enabledByDefault: true },
			contract: {
				methods: { getTree: { params: Type.Object({}), result: Type.Object({}) } },
				channels: {
					tree: { kind: "state", payload: Type.Object({}), snapshot: "getTree", key: [] },
				},
			},
		}),
	);
	registry.registerBuiltin(fixtureModule("blueprint"));
	await activate("spec-dialect", registry, fixtureSeams());
	expect(pluginChannelNames(registry)).toEqual(["plugin.spec-dialect.tree"]);
});
