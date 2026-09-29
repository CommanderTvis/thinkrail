import { expect, test } from "bun:test";
import { Type } from "typebox";
import { cascadeDisable, validatePluginNamespaces } from "./settings";

test("writing two namespaces in separate calls leaves both intact", () => {
	const first = validatePluginNamespaces(
		{ "spec-dialect": { enabled: true } },
		{},
		() => undefined,
	);
	if (!("namespaces" in first)) throw new Error("expected the update to be accepted");
	const second = validatePluginNamespaces(
		{ blueprint: { enabled: false } },
		first.namespaces,
		() => undefined,
	);
	if (!("namespaces" in second)) throw new Error("expected the update to be accepted");
	expect(second.namespaces).toEqual({
		"spec-dialect": { enabled: true },
		blueprint: { enabled: false },
	});
});

test("an invalid namespace refuses the whole update", () => {
	const schema = Type.Object({ theme: Type.String() });
	const result = validatePluginNamespaces({ "spec-dialect": { theme: 5 } }, {}, (id) =>
		id === "spec-dialect" ? schema : undefined,
	);
	expect("refused" in result).toBe(true);
});

test("a valid namespace fills in schema defaults, keeping enabled separate from the schema", () => {
	const schema = Type.Object({ theme: Type.Optional(Type.String({ default: "dark" })) });
	const result = validatePluginNamespaces({ "spec-dialect": { enabled: true } }, {}, () => schema);
	if (!("namespaces" in result)) throw new Error("expected the update to be accepted");
	expect(result.namespaces["spec-dialect"]).toEqual({ enabled: true, theme: "dark" });
});

test("cascadeDisable adds every transitive dependent of a plugin turned off", () => {
	const roster = [
		{ id: "spec-dialect", dependsOn: [] },
		{ id: "blueprint", dependsOn: ["spec-dialect"] },
		{ id: "claude-code", dependsOn: ["blueprint"] },
	];
	const result = cascadeDisable({ "spec-dialect": { enabled: false } }, roster);
	expect(result).toEqual({
		"spec-dialect": { enabled: false },
		blueprint: { enabled: false },
		"claude-code": { enabled: false },
	});
});

test("cascadeDisable leaves an unrelated plugin's update untouched", () => {
	const roster = [
		{ id: "spec-dialect", dependsOn: [] },
		{ id: "blueprint", dependsOn: ["spec-dialect"] },
	];
	const result = cascadeDisable(
		{ "spec-dialect": { enabled: false }, blueprint: { theme: "x" } },
		roster,
	);
	expect(result.blueprint).toEqual({ enabled: false, theme: "x" });
});
