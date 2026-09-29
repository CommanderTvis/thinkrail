import type { PluginRosterEntry } from "@thinkrail/contracts";
import type { PluginManifest } from "@thinkrail/plugin-api";
import type {
	AgentLauncher,
	CompanionRegistration,
	CoreSlots,
	FileViewerRegistration,
	ProjectScopedActionRegistration,
	SettingsSectionRegistration,
	SideToolRegistration,
	TabDecoration,
	TabRef,
	TerminalAccessoryRegistration,
	WorkspaceScopedActionRegistration,
} from "@thinkrail/plugin-api/web";
import type { ComponentType } from "react";
import { create } from "zustand";
import { pluginAssetBase, pluginIcon } from "./icons";

export interface LayoutToolCatalogEntry {
	id: string;
	label: string;
	icon: ComponentType<{ className?: string | undefined }>;
	activeIcon?: ComponentType<{ className?: string | undefined }>;
	defaultSide: "left" | "right";
	dormant: boolean;
}

export interface FileViewerEntry extends FileViewerRegistration {
	read: "text" | "none";
}

export interface ResolvedFileViewer {
	pluginId: string;
	component: ComponentType<{ workspaceId: string; path: string; revision: number }>;
	open?: FileViewerRegistration["open"];
	read: "text" | "none";
}

interface StoredFileViewer extends ResolvedFileViewer {
	matches?: FileViewerRegistration["matches"];
}

type SlotName = keyof CoreSlots;
type SlotResolver = NonNullable<CoreSlots[SlotName]>;

interface Entry<T> {
	pluginId: string;
	value: T;
}

type CompanionsByHost = Record<
	"terminal" | "chat",
	(CompanionRegistration & { pluginId: string })[]
>;
type SlotResolvers = Record<SlotName, SlotResolver[]>;

interface PluginRegistryState {
	manifests: Record<string, PluginManifest>;
	roster: PluginRosterEntry[];
	httpBase: string;
	active: ReadonlySet<string>;
	sideTools: Entry<SideToolRegistration>[];
	settingsSections: Entry<SettingsSectionRegistration>[];
	companions: Entry<CompanionRegistration>[];
	fileViewers: StoredFileViewer[];
	tabDecorators: Entry<(tab: TabRef) => TabDecoration | null>[];
	launchers: Entry<AgentLauncher>[];
	workspaceActions: Entry<WorkspaceScopedActionRegistration>[];
	projectActions: Entry<ProjectScopedActionRegistration>[];
	terminalAccessories: Entry<TerminalAccessoryRegistration>[];
	slots: Record<SlotName, Entry<SlotResolver>[]>;
	toolRenderers: Entry<string>[];

	toolCatalog: LayoutToolCatalogEntry[];
	companionsByHost: CompanionsByHost;
	slotResolvers: SlotResolvers;
	launcherList: AgentLauncher[];

	registerManifest: (manifest: PluginManifest) => void;
	setRoster: (roster: PluginRosterEntry[], httpBase: string) => void;
	setActive: (pluginId: string, active: boolean) => void;
	addSideTool: (pluginId: string, value: SideToolRegistration) => void;
	addSettingsSection: (pluginId: string, value: SettingsSectionRegistration) => void;
	addCompanion: (pluginId: string, value: CompanionRegistration) => void;
	addFileViewer: (pluginId: string, value: FileViewerEntry) => void;
	addTabDecorator: (pluginId: string, value: (tab: TabRef) => TabDecoration | null) => void;
	addLauncher: (pluginId: string, value: AgentLauncher) => void;
	addWorkspaceAction: (pluginId: string, value: WorkspaceScopedActionRegistration) => void;
	addProjectAction: (pluginId: string, value: ProjectScopedActionRegistration) => void;
	addTerminalAccessory: (pluginId: string, value: TerminalAccessoryRegistration) => void;
	addSlot: <K extends SlotName>(
		pluginId: string,
		name: K,
		resolver: NonNullable<CoreSlots[K]>,
	) => void;
	addToolRenderer: (pluginId: string, name: string) => void;
	removePlugin: (id: string) => void;
}

const EMPTY_SLOTS: Record<SlotName, Entry<SlotResolver>[]> = {
	fileIcon: [],
	documentLink: [],
	writtenPathGroup: [],
};

function append<T>(list: Entry<T>[], pluginId: string, value: T): Entry<T>[] {
	return [...list, { pluginId, value }];
}

function dropPlugin<T extends { pluginId: string }>(list: T[], id: string): T[] {
	return list.filter((entry) => entry.pluginId !== id);
}

function buildToolCatalog(
	roster: readonly PluginRosterEntry[],
	active: ReadonlySet<string>,
	httpBase: string,
): LayoutToolCatalogEntry[] {
	return roster.flatMap((entry) =>
		entry.contributes.sideTools.map((tool) => ({
			id: tool.tool,
			label: tool.label,
			icon: pluginIcon(tool.icon, false, pluginAssetBase(entry, httpBase)),
			activeIcon: pluginIcon(tool.icon, true, pluginAssetBase(entry, httpBase)),
			defaultSide: tool.defaultSide,
			dormant: entry.status !== "active" || !active.has(entry.id),
			...(tool.requiresGit ? { requiresGit: true as const } : {}),
		})),
	);
}

function buildCompanionsByHost(companions: Entry<CompanionRegistration>[]): CompanionsByHost {
	const forHost = (hostKind: "terminal" | "chat") =>
		companions
			.filter((entry) => entry.value.hosts.includes(hostKind))
			.map((entry) => ({ ...entry.value, pluginId: entry.pluginId }));
	return { terminal: forHost("terminal"), chat: forHost("chat") };
}

function buildSlotResolvers(slots: Record<SlotName, Entry<SlotResolver>[]>): SlotResolvers {
	return {
		fileIcon: slots.fileIcon.map((entry) => entry.value),
		documentLink: slots.documentLink.map((entry) => entry.value),
		writtenPathGroup: slots.writtenPathGroup.map((entry) => entry.value),
	};
}

function buildLauncherList(launchers: Entry<AgentLauncher>[]): AgentLauncher[] {
	return launchers.map((entry) => entry.value);
}

export const usePluginRegistry = create<PluginRegistryState>((set) => ({
	manifests: {},
	roster: [],
	httpBase: "",
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
	slots: EMPTY_SLOTS,
	toolRenderers: [],

	toolCatalog: [],
	companionsByHost: { terminal: [], chat: [] },
	slotResolvers: { fileIcon: [], documentLink: [], writtenPathGroup: [] },
	launcherList: [],

	registerManifest: (manifest) =>
		set((s) => ({ manifests: { ...s.manifests, [manifest.id]: manifest } })),
	setRoster: (roster, httpBase) =>
		set((s) => ({ roster, httpBase, toolCatalog: buildToolCatalog(roster, s.active, httpBase) })),
	setActive: (pluginId, active) =>
		set((s) => {
			const next = new Set(s.active);
			if (active) next.add(pluginId);
			else next.delete(pluginId);
			return { active: next, toolCatalog: buildToolCatalog(s.roster, next, s.httpBase) };
		}),
	addSideTool: (pluginId, value) =>
		set((s) => ({ sideTools: append(s.sideTools, pluginId, value) })),
	addSettingsSection: (pluginId, value) =>
		set((s) => ({ settingsSections: append(s.settingsSections, pluginId, value) })),
	addCompanion: (pluginId, value) =>
		set((s) => {
			const companions = append(s.companions, pluginId, value);
			return { companions, companionsByHost: buildCompanionsByHost(companions) };
		}),
	addFileViewer: (pluginId, value) =>
		set((s) => ({
			fileViewers: [
				...s.fileViewers,
				{
					pluginId,
					component: value.component,
					read: value.read,
					...(value.matches ? { matches: value.matches } : {}),
					...(value.open ? { open: value.open } : {}),
				},
			],
		})),
	addTabDecorator: (pluginId, value) =>
		set((s) => ({ tabDecorators: append(s.tabDecorators, pluginId, value) })),
	addLauncher: (pluginId, value) =>
		set((s) => {
			const launchers = append(s.launchers, pluginId, value);
			return { launchers, launcherList: buildLauncherList(launchers) };
		}),
	addWorkspaceAction: (pluginId, value) =>
		set((s) => ({ workspaceActions: append(s.workspaceActions, pluginId, value) })),
	addProjectAction: (pluginId, value) =>
		set((s) => ({ projectActions: append(s.projectActions, pluginId, value) })),
	addTerminalAccessory: (pluginId, value) =>
		set((s) => ({ terminalAccessories: append(s.terminalAccessories, pluginId, value) })),
	addSlot: (pluginId, name, resolver) =>
		set((s) => {
			const slots = {
				...s.slots,
				[name]: append(s.slots[name], pluginId, resolver as SlotResolver),
			};
			return { slots, slotResolvers: buildSlotResolvers(slots) };
		}),
	addToolRenderer: (pluginId, name) =>
		set((s) => ({ toolRenderers: append(s.toolRenderers, pluginId, name) })),
	removePlugin: (id) =>
		set((s) => {
			const active = new Set(s.active);
			active.delete(id);
			const companions = dropPlugin(s.companions, id);
			const launchers = dropPlugin(s.launchers, id);
			const slots = {
				fileIcon: dropPlugin(s.slots.fileIcon, id),
				documentLink: dropPlugin(s.slots.documentLink, id),
				writtenPathGroup: dropPlugin(s.slots.writtenPathGroup, id),
			};
			return {
				active,
				sideTools: dropPlugin(s.sideTools, id),
				settingsSections: dropPlugin(s.settingsSections, id),
				companions,
				fileViewers: dropPlugin(s.fileViewers, id),
				tabDecorators: dropPlugin(s.tabDecorators, id),
				launchers,
				workspaceActions: dropPlugin(s.workspaceActions, id),
				projectActions: dropPlugin(s.projectActions, id),
				terminalAccessories: dropPlugin(s.terminalAccessories, id),
				slots,
				toolRenderers: dropPlugin(s.toolRenderers, id),
				toolCatalog: buildToolCatalog(s.roster, active, s.httpBase),
				companionsByHost: buildCompanionsByHost(companions),
				slotResolvers: buildSlotResolvers(slots),
				launcherList: buildLauncherList(launchers),
			};
		}),
}));

function extensionOf(path: string): string {
	const base = path.split("/").pop() ?? path;
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot + 1) : "";
}

function baseNameOf(path: string): string {
	return path.split("/").pop() ?? path;
}

function manifestDeclaresPath(
	roster: readonly PluginRosterEntry[],
	pluginId: string,
	path: string,
): boolean {
	const entry = roster.find((candidate) => candidate.id === pluginId);
	if (!entry) return false;
	const ext = extensionOf(path);
	const name = baseNameOf(path);
	return entry.contributes.fileViewers.some(
		(viewer) => viewer.extensions.includes(ext) || viewer.names.includes(name),
	);
}

export function selectToolCatalog(state: PluginRegistryState): LayoutToolCatalogEntry[] {
	return state.toolCatalog;
}

export function selectSideTool(
	state: PluginRegistryState,
	tool: string,
): SideToolRegistration | undefined {
	return state.sideTools.find((entry) => entry.value.tool === tool)?.value;
}

export function selectSettingsSections(
	state: PluginRegistryState,
): Entry<SettingsSectionRegistration>[] {
	return state.settingsSections;
}

export function selectCompanions(
	state: PluginRegistryState,
	hostKind: "terminal" | "chat",
): (CompanionRegistration & { pluginId: string })[] {
	return state.companionsByHost[hostKind];
}

export function selectFileViewer(
	state: PluginRegistryState,
	path: string,
): ResolvedFileViewer | null {
	for (const viewer of state.fileViewers) {
		const eligible = viewer.matches
			? viewer.matches(path)
			: manifestDeclaresPath(state.roster, viewer.pluginId, path);
		if (eligible) return viewer;
	}
	return null;
}

export function selectTabDecorators(
	state: PluginRegistryState,
): Entry<(tab: TabRef) => TabDecoration | null>[] {
	return state.tabDecorators;
}

export function selectLaunchers(state: PluginRegistryState): AgentLauncher[] {
	return state.launcherList;
}

export function selectWorkspaceActions(
	state: PluginRegistryState,
): Entry<WorkspaceScopedActionRegistration>[] {
	return state.workspaceActions;
}

export function selectProjectActions(
	state: PluginRegistryState,
): Entry<ProjectScopedActionRegistration>[] {
	return state.projectActions;
}

export function selectTerminalAccessories(
	state: PluginRegistryState,
): Entry<TerminalAccessoryRegistration>[] {
	return state.terminalAccessories;
}

export function selectSlot<K extends SlotName>(
	state: PluginRegistryState,
	name: K,
): NonNullable<CoreSlots[K]>[] {
	return state.slotResolvers[name] as NonNullable<CoreSlots[K]>[];
}
