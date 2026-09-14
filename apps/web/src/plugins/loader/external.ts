import type { PluginRosterEntry } from "@thinkrail/contracts";
import { pluginRoute } from "@thinkrail/plugin-api";
import type { PluginWebModule } from "@thinkrail/plugin-api/web";
import { getTransport } from "../../transport";

const SECOND_REACT_PATTERN = /Symbol\.for\(["']react\./;

function styleElementId(pluginId: string): string {
	return `plugin-styles-${pluginId}`;
}

function installStylesheet(pluginId: string, styles: string): void {
	removeStylesheet(pluginId);
	const link = document.createElement("link");
	link.id = styleElementId(pluginId);
	link.rel = "stylesheet";
	link.dataset.plugin = pluginId;
	link.href = `${getTransport().httpBase()}${pluginRoute(pluginId, styles)}`;
	document.head.append(link);
}

export function removeStylesheet(pluginId: string): void {
	document.getElementById(styleElementId(pluginId))?.remove();
}

// See plugins/loader/SPEC.md and plugin-api/SPEC.md's "Trust" section.
export async function loadExternalWeb(entry: PluginRosterEntry): Promise<PluginWebModule> {
	const web = entry.web;
	if (!web) throw new Error(`plugin "${entry.id}" has no external web module declared`);
	const url = `${getTransport().httpBase()}${pluginRoute(entry.id, web.module)}`;
	const source = await fetch(url).then((res) => {
		if (!res.ok) throw new Error(`could not fetch ${url}: ${res.status}`);
		return res.text();
	});
	if (SECOND_REACT_PATTERN.test(source)) {
		throw new Error(`plugin "${entry.id}" bundles its own React — refused`);
	}
	if (web.styles) installStylesheet(entry.id, web.styles);
	const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
	try {
		return (await import(/* @vite-ignore */ blobUrl)) as PluginWebModule;
	} finally {
		URL.revokeObjectURL(blobUrl);
	}
}
