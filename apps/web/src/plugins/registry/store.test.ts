import { beforeEach, describe, expect, it } from "bun:test";
import type { PluginRosterEntry } from "@thinkrail/contracts";
import {
	selectCompanions,
	selectFileViewer,
	selectLaunchers,
	selectProjectActions,
	selectSettingsSections,
	selectSideTool,
	selectSlot,
	selectTabDecorators,
	selectTerminalAccessories,
	selectToolCatalog,
	selectWorkspaceActions,
	usePluginRegistry,
} from "./store";

function roster(overrides: Partial<PluginRosterEntry> = {}): PluginRosterEntry {
	return {
		id: "demo",
		label: "Demo",
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
		projectActions: [],
		terminalAccessories: [],
		slots: { fileIcon: [], documentLink: [], writtenPathGroup: [] },
		toolRenderers: [],
	});
});

describe("selectToolCatalog", () => {
	it("lists plugin side tools in roster order, dormant unless the plugin is active", () => {
		usePluginRegistry.getState().setRoster([
			roster({
				id: "a",
				contributes: {
					sideTools: [{ tool: "plugin:a:x", label: "X", icon: "flask", defaultSide: "right" }],
					fileViewers: [],
				},
			}),
			roster({
				id: "b",
				status: "disabled",
				contributes: {
					sideTools: [
						{ tool: "plugin:b:y", label: "Y", icon: "bug", defaultSide: "left", requiresGit: true },
					],
					fileViewers: [],
				},
			}),
		]);
		usePluginRegistry.getState().setActive("a", true);

		const catalog = selectToolCatalog(usePluginRegistry.getState());
		expect(catalog.map((entry) => entry.id)).toEqual(["plugin:a:x", "plugin:b:y"]);
		expect(catalog[0]?.dormant).toBe(false);
		expect(catalog[0]?.requiresGit).toBeUndefined();
		expect(catalog[1]?.dormant).toBe(true);
		expect(catalog[1]?.requiresGit).toBe(true);
	});
});

describe("selectSideTool", () => {
	it("finds the registered component for a tool id", () => {
		const Component = () => null;
		usePluginRegistry.getState().addSideTool("a", { tool: "plugin:a:x", component: Component });
		expect(selectSideTool(usePluginRegistry.getState(), "plugin:a:x")?.component).toBe(Component);
		expect(selectSideTool(usePluginRegistry.getState(), "plugin:a:missing")).toBeUndefined();
	});
});

describe("selectFileViewer", () => {
	it("resolves in registration order using the manifest's declared extensions when no matches fn is given", () => {
		usePluginRegistry.getState().setRoster([
			roster({
				id: "a",
				contributes: {
					sideTools: [],
					fileViewers: [{ extensions: ["md"], names: [], read: "text" }],
				},
			}),
		]);
		const Component = () => null;
		usePluginRegistry.getState().addFileViewer("a", { component: Component, read: "text" });

		expect(selectFileViewer(usePluginRegistry.getState(), "notes.md")?.component).toBe(Component);
		expect(selectFileViewer(usePluginRegistry.getState(), "notes.txt")).toBeNull();
	});

	it("prefers an explicit matches predicate, first eligible registration wins", () => {
		const First = () => null;
		const Second = () => null;
		usePluginRegistry.getState().addFileViewer("core", {
			matches: (path) => path.endsWith(".png"),
			component: First,
			read: "none",
		});
		usePluginRegistry.getState().addFileViewer("plugin", {
			matches: () => true,
			component: Second,
			read: "text",
		});

		expect(selectFileViewer(usePluginRegistry.getState(), "a.png")?.component).toBe(First);
		expect(selectFileViewer(usePluginRegistry.getState(), "a.bin")?.component).toBe(Second);
	});
});

describe("referential stability", () => {
	it("returns the same reference for every list selector until a write changes it, per useSyncExternalStore's Object.is check", () => {
		usePluginRegistry.getState().setRoster([
			roster({
				id: "a",
				contributes: {
					sideTools: [{ tool: "plugin:a:x", label: "X", icon: "flask", defaultSide: "right" }],
					fileViewers: [],
				},
			}),
		]);
		usePluginRegistry.getState().setActive("a", true);
		usePluginRegistry
			.getState()
			.addSettingsSection("a", { label: "A", icon: () => null, component: () => null });
		usePluginRegistry.getState().addCompanion("a", {
			kind: "a",
			hosts: ["terminal"],
			title: "A",
			icon: () => null,
			component: () => null,
			useAvailable: () => true,
		});
		usePluginRegistry.getState().addTabDecorator("a", () => null);
		usePluginRegistry.getState().addLauncher("a", {
			id: "a",
			label: "A",
			icon: () => null,
			terminalCommand: () => "a",
		});
		usePluginRegistry.getState().addWorkspaceAction("a", { id: "a", component: () => null });
		usePluginRegistry
			.getState()
			.addProjectAction("a", { id: "a", scope: "project", component: () => null });
		usePluginRegistry.getState().addTerminalAccessory("a", { component: () => null });
		usePluginRegistry.getState().addSlot("a", "fileIcon", () => null);

		const state = usePluginRegistry.getState();
		expect(selectToolCatalog(state)).toBe(selectToolCatalog(usePluginRegistry.getState()));
		expect(selectSettingsSections(state)).toBe(
			selectSettingsSections(usePluginRegistry.getState()),
		);
		expect(selectCompanions(state, "terminal")).toBe(
			selectCompanions(usePluginRegistry.getState(), "terminal"),
		);
		expect(selectTabDecorators(state)).toBe(selectTabDecorators(usePluginRegistry.getState()));
		expect(selectLaunchers(state)).toBe(selectLaunchers(usePluginRegistry.getState()));
		expect(selectWorkspaceActions(state)).toBe(
			selectWorkspaceActions(usePluginRegistry.getState()),
		);
		expect(selectProjectActions(state)).toBe(selectProjectActions(usePluginRegistry.getState()));
		expect(selectTerminalAccessories(state)).toBe(
			selectTerminalAccessories(usePluginRegistry.getState()),
		);
		expect(selectSlot(state, "fileIcon")).toBe(
			selectSlot(usePluginRegistry.getState(), "fileIcon"),
		);

		const catalogBefore = selectToolCatalog(state);
		usePluginRegistry.getState().setActive("a", false);
		expect(selectToolCatalog(usePluginRegistry.getState())).not.toBe(catalogBefore);
	});
});

describe("removePlugin", () => {
	it("drops every table row tagged with that plugin id", () => {
		const registry = usePluginRegistry.getState();
		registry.setActive("a", true);
		registry.addSideTool("a", { tool: "plugin:a:x", component: () => null });
		registry.addFileViewer("a", { component: () => null, read: "text", matches: () => true });
		registry.addSlot("a", "fileIcon", () => null);
		registry.addSideTool("b", { tool: "plugin:b:y", component: () => null });

		usePluginRegistry.getState().removePlugin("a");

		const state = usePluginRegistry.getState();
		expect(state.active.has("a")).toBe(false);
		expect(state.sideTools.map((entry) => entry.pluginId)).toEqual(["b"]);
		expect(state.fileViewers).toEqual([]);
		expect(state.slots.fileIcon).toEqual([]);
	});
});
