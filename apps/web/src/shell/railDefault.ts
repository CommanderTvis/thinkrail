import { parsePluginToolId } from "@thinkrail/plugin-api";
import type { LayoutAttention } from "../lib";
import { readLayoutSelection } from "../lib";
import { selectSideTool, usePluginRegistry } from "../plugins/registry";
import { collectAllGroups, selectTab, type WorkspaceLayoutDocument } from "./layout";

async function pluginToolRailDefault(tool: string, workspaceId: string): Promise<boolean> {
	const parsed = parsePluginToolId(tool);
	if (!parsed) return true;
	const registry = usePluginRegistry.getState();
	if (!registry.active.has(parsed.pluginId)) return false;
	const registration = selectSideTool(registry, tool);
	if (!registration?.railDefault) return true;
	try {
		return await registration.railDefault(workspaceId);
	} catch {
		return true;
	}
}

export async function resolvePluginRailDefaults(
	document: WorkspaceLayoutDocument,
	attention: LayoutAttention,
	workspaceId: string,
): Promise<LayoutAttention> {
	let next = attention;
	for (const group of collectAllGroups(document)) {
		if (group.location.area === "center") continue;
		const selectedId = readLayoutSelection(next, group.location.groupId);
		const selected = group.tabs.find((tab) => tab.id === selectedId);
		if (selected?.kind !== "tool") continue;
		if (await pluginToolRailDefault(selected.tool, workspaceId)) continue;
		const other = group.tabs.find((tab) => tab.id !== selected.id);
		if (other) next = selectTab(next, group.location, other.id, false);
	}
	return next;
}
