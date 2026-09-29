import { beforeEach, describe, expect, test } from "bun:test";
import type { LayoutAttention } from "../lib";
import { usePluginRegistry } from "../plugins/registry";
import type { WorkspaceLayoutDocument } from "./layout";
import { resolvePluginRailDefaults } from "./railDefault";

const PLUGIN_TOOL = "plugin:demo:panel" as const;

function document(): WorkspaceLayoutDocument {
	return {
		version: 2,
		center: { kind: "group", id: "center-a", tabs: [] },
		left: { visible: true, width: 0.18, groups: [] },
		right: {
			visible: true,
			width: 0.28,
			groups: [
				{
					id: "right-a",
					weight: 1,
					folded: false,
					tabs: [
						{ kind: "tool", id: "tool:files", name: "Files", tool: "files" },
						{ kind: "tool", id: `tool:${PLUGIN_TOOL}`, name: "Demo", tool: PLUGIN_TOOL },
					],
				},
			],
		},
		bottom: { visible: false, height: 0.3, alignment: "center", groups: [] },
		toolRestoreTargets: {},
	};
}

function attentionOn(tabId: string): LayoutAttention {
	return {
		selectedByGroup: { "right-a": tabId },
		lastFocusedCenterGroupId: "center-a",
		lastFocusedSideGroupId: {},
		navigationClockByGroup: {},
	};
}

beforeEach(() => {
	usePluginRegistry.setState({
		roster: [],
		active: new Set(),
		sideTools: [],
	});
});

describe("resolvePluginRailDefaults", () => {
	test("leaves the selection alone when the plugin is active and declares no railDefault", () => {
		usePluginRegistry.getState().setActive("demo", true);
		const attention = attentionOn(`tool:${PLUGIN_TOOL}`);
		return resolvePluginRailDefaults(document(), attention, "w1").then((next) => {
			expect(next).toBe(attention);
		});
	});

	test("moves off a dormant plugin tool (the plugin never mounted) onto the next tab in its group", async () => {
		const attention = attentionOn(`tool:${PLUGIN_TOOL}`);
		const next = await resolvePluginRailDefaults(document(), attention, "w1");
		expect(next.selectedByGroup["right-a"]).toBe("tool:files");
	});

	test("moves off a plugin tool whose own railDefault refuses this workspace", async () => {
		usePluginRegistry.getState().setActive("demo", true);
		usePluginRegistry.getState().addSideTool("demo", {
			tool: PLUGIN_TOOL,
			component: () => null,
			railDefault: async (workspaceId) => workspaceId !== "w1",
		});
		const attention = attentionOn(`tool:${PLUGIN_TOOL}`);
		const next = await resolvePluginRailDefaults(document(), attention, "w1");
		expect(next.selectedByGroup["right-a"]).toBe("tool:files");
	});

	test("keeps the plugin tool selected when its railDefault accepts the workspace", async () => {
		usePluginRegistry.getState().setActive("demo", true);
		usePluginRegistry.getState().addSideTool("demo", {
			tool: PLUGIN_TOOL,
			component: () => null,
			railDefault: async (workspaceId) => workspaceId === "w1",
		});
		const attention = attentionOn(`tool:${PLUGIN_TOOL}`);
		const next = await resolvePluginRailDefaults(document(), attention, "w1");
		expect(next.selectedByGroup["right-a"]).toBe(`tool:${PLUGIN_TOOL}`);
	});

	test("never touches the builtin specs tab — that stays the specless effect's job", async () => {
		const withSpecs = document();
		withSpecs.right.groups[0]?.tabs.push({
			kind: "tool",
			id: "tool:specs",
			name: "Specs",
			tool: "specs",
		});
		const attention = attentionOn("tool:specs");
		const next = await resolvePluginRailDefaults(withSpecs, attention, "w1");
		expect(next).toBe(attention);
	});
});
