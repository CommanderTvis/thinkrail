import { expect, test } from "bun:test";
import type { LayoutPreset } from "@thinkrail/contracts";
import { validateLayoutPreset } from "./layoutPresets";

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

test("validateLayoutPreset rejects an unknown tool id", () => {
	expect(() => validateLayoutPreset(preset(["not-a-real-tool"]))).toThrow();
});
