import { describe, expect, test } from "bun:test";
import {
	isPluginId,
	PLUGIN_ID_PATTERN,
	parsePluginToolId,
	pluginChannelName,
	pluginMethodName,
	pluginPreferenceKey,
	pluginRoute,
	pluginStateFile,
	pluginToolId,
} from "./identity";

describe("PLUGIN_ID_PATTERN / isPluginId", () => {
	test("accepts lowercase alphanumeric with hyphens", () => {
		expect(isPluginId("spec-dialect")).toBe(true);
		expect(isPluginId("claude-code")).toBe(true);
		expect(isPluginId("blueprint")).toBe(true);
	});

	test("rejects uppercase, underscores, leading/trailing hyphens, and empty strings", () => {
		expect(isPluginId("Spec-Dialect")).toBe(false);
		expect(isPluginId("spec_dialect")).toBe(false);
		expect(isPluginId("-spec")).toBe(false);
		expect(isPluginId("spec-")).toBe(false);
		expect(isPluginId("")).toBe(false);
	});

	test("PLUGIN_ID_PATTERN matches isPluginId", () => {
		expect(PLUGIN_ID_PATTERN.test("blueprint")).toBe(true);
	});
});

test("pluginMethodName builds plugin.<id>.<name>", () => {
	expect(pluginMethodName("blueprint", "check")).toBe("plugin.blueprint.check");
});

test("pluginChannelName builds plugin.<id>.<name>", () => {
	expect(pluginChannelName("blueprint", "changed")).toBe("plugin.blueprint.changed");
});

test("pluginRoute builds /plugin/<id>[/<subpath>]", () => {
	expect(pluginRoute("blueprint")).toBe("/plugin/blueprint");
	expect(pluginRoute("blueprint", "assets/icon.svg")).toBe("/plugin/blueprint/assets/icon.svg");
});

test("pluginToolId builds plugin:<id>:<tool>", () => {
	expect(pluginToolId("spec-dialect", "specs")).toBe("plugin:spec-dialect:specs");
});

describe("parsePluginToolId", () => {
	test("round-trips with pluginToolId", () => {
		const id = pluginToolId("spec-dialect", "specs");
		expect(parsePluginToolId(id)).toEqual({ pluginId: "spec-dialect", tool: "specs" });
	});

	test("returns null for a string with no plugin: prefix", () => {
		expect(parsePluginToolId("specs")).toBeNull();
	});

	test("returns null for a malformed id", () => {
		expect(parsePluginToolId("plugin:spec-dialect")).toBeNull();
		expect(parsePluginToolId("plugin::specs")).toBeNull();
	});
});

test("pluginPreferenceKey builds plugin:<id>:<key>", () => {
	expect(pluginPreferenceKey("blueprint", "collapsed")).toBe("plugin:blueprint:collapsed");
});

test("pluginStateFile builds plugin-state/<id>/<name>.json", () => {
	expect(pluginStateFile("blueprint", "layout")).toBe("plugin-state/blueprint/layout.json");
});
