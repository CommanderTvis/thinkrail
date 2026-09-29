import { expect, test } from "bun:test";
import type { PluginRosterEntry } from "@thinkrail/contracts";
import { activeDependents, pluginsToEnable } from "./PluginsSettings";

function entry(
	id: string,
	status: PluginRosterEntry["status"],
	dependsOn: string[] = [],
): PluginRosterEntry {
	return {
		id,
		label: id,
		icon: "puzzle",
		version: "0.0.0",
		wireVersion: 1,
		origin: "builtin",
		status,
		dependsOn,
		modifiesSystemPrompt: false,
		contributes: { sideTools: [], fileViewers: [] },
		channels: {},
	};
}

test("pluginsToEnable is empty when a plugin has no disabled dependencies", () => {
	const roster = [
		entry("blueprint", "disabled", ["spec-dialect"]),
		entry("spec-dialect", "active"),
	];
	expect(pluginsToEnable("blueprint", roster)).toEqual([]);
});

test("pluginsToEnable lists disabled dependencies, transitively", () => {
	const roster = [
		entry("c", "disabled", ["b"]),
		entry("b", "disabled", ["a"]),
		entry("a", "disabled"),
	];
	expect(pluginsToEnable("c", roster).sort()).toEqual(["a", "b"]);
});

test("activeDependents lists enabled plugins reachable through dependsOn, transitively", () => {
	const roster = [
		entry("spec-dialect", "active"),
		entry("blueprint", "active", ["spec-dialect"]),
		entry("claude-code", "disabled"),
	];
	expect(activeDependents("spec-dialect", roster)).toEqual(["blueprint"]);
});

test("activeDependents excludes a dependent that is itself disabled", () => {
	const roster = [
		entry("spec-dialect", "active"),
		entry("blueprint", "disabled", ["spec-dialect"]),
	];
	expect(activeDependents("spec-dialect", roster)).toEqual([]);
});
