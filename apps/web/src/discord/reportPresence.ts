import type { DiscordPresence } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { selectActiveEditorTab, selectContextProject } from "../store/selectors";
import { getTransport } from "../transport";

const REPORT_DEBOUNCE_MS = 500;

function currentPresence(): DiscordPresence | null {
	const state = useAppStore.getState();
	const workspaceId = state.activeWorkspaceId;
	if (!workspaceId) return null;
	const project = selectContextProject(state);
	if (!project) return null;
	const tab = selectActiveEditorTab(state, workspaceId);
	const filePath = tab && (tab.kind === "file" || tab.kind === "external-file") ? tab.path : null;
	return { projectId: project.id, projectName: project.name, filePath };
}

function samePresence(a: DiscordPresence | null, b: DiscordPresence | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.projectId === b.projectId && a.filePath === b.filePath;
}

/** Pushes what to show on Discord on every focused-project/file change; the host decides what leaves. */
export function initDiscordPresenceReporting(): void {
	let last: DiscordPresence | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const report = () => {
		const presence = currentPresence();
		if (samePresence(presence, last)) return;
		last = presence;
		getTransport()
			.request("discord.presence", { presence })
			.catch(() => {});
	};

	useAppStore.subscribe(() => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(report, REPORT_DEBOUNCE_MS);
	});
	report();
}
