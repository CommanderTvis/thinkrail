import { expect, test } from "bun:test";
import type { LayoutPreset } from "@thinkrail/contracts";
import { normalizeStoredCustomLayoutPresets, validateLayoutPreset } from "./layoutPresets";

function preset(tools: string[]): LayoutPreset {
	return {
		id: "custom",
		name: "Custom",
		center: { kind: "group", id: "custom-center" },
		left: { visible: false, width: 0.2, groups: [] },
		right: {
			visible: true,
			width: 0.2,
			groups: [{ id: "custom-right", weight: 1, folded: false, tools: tools as never }],
		},
		bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
	};
}

test("validateLayoutPreset accepts a plugin tool id", () => {
	expect(() => validateLayoutPreset(preset(["plugin:spec-dialect:specs"]))).not.toThrow();
});

test("validateLayoutPreset rejects a tool id that is neither builtin nor plugin-shaped", () => {
	expect(() => validateLayoutPreset(preset(["not-a-real-tool"]))).toThrow();
});

test("normalizeStoredCustomLayoutPresets migrates the legacy specs and claude tool ids", () => {
	const [migrated] = normalizeStoredCustomLayoutPresets([preset(["specs", "claude"])]);
	expect(migrated?.right.groups[0]?.tools).toEqual([
		"plugin:spec-dialect:specs",
		"plugin:claude-code:config",
	]);
});
