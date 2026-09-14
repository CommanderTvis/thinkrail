import type { HostProjection, PluginWebContext } from "@thinkrail/plugin-api/web";
import type { DiscordPresence, discordContract } from "../contracts";

const REPORT_DEBOUNCE_MS = 500;

function currentPresence(host: HostProjection): DiscordPresence | null {
	if (!host.activeWorkspaceId) return null;
	const project = host.projects.find((candidate) => candidate.id === host.contextProjectId);
	if (!project) return null;
	const editor = host.activeEditor;
	const filePath = editor && editor.kind !== "diff" ? editor.path : null;
	return { projectId: project.id, projectName: project.name, filePath };
}

function samePresence(a: DiscordPresence | null, b: DiscordPresence | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.projectId === b.projectId && a.filePath === b.filePath;
}

/** Pushes what to show on Discord on every focused-project/file change; the host decides what leaves. */
export function initDiscordPresenceReporting(ctx: PluginWebContext<typeof discordContract>): void {
	let last: DiscordPresence | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const report = () => {
		const presence = currentPresence(ctx.host());
		if (samePresence(presence, last)) return;
		last = presence;
		ctx.request("presence", { presence }).catch(() => {});
	};

	ctx.watchHost(
		(host) => currentPresence(host),
		() => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(report, REPORT_DEBOUNCE_MS);
		},
	);
	report();
}
