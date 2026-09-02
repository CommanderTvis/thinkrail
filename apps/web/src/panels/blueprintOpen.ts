import type { BlueprintState } from "@thinkrail/contracts";
import { BLUEPRINT_FILE } from "@thinkrail/contracts";
import { primaryCenterGroupId } from "@/shell/layout";
import { terminalLayoutId } from "@/shell/terminalReconciliation";
import { chatTabId, embeddedHostKey, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { openFileInTab } from "./openTabs";

export function isBlueprintPath(path: string): boolean {
	return path === BLUEPRINT_FILE;
}

/**
 * The spec has one surface: an embedded pane on its author. Opening `BLUEPRINT.md` — from Files, from
 * Specs, from anywhere — brings the author back with the blueprint beside it rather than a second,
 * plain view of the same document; and if the author's tab was closed, it is restored first. See
 * panels/SPEC.md.
 */
export async function openBlueprintPair(workspaceId: string): Promise<void> {
	const store = useAppStore.getState();
	const state =
		store.blueprintByWorkspace[workspaceId] ??
		(await getTransport()
			.request("blueprint.get", { workspaceId })
			.catch(() => null));
	if (!state) return;
	store.setWorkspaceBlueprint(state);

	const author = await restoreAuthor(workspaceId, state);
	if (!author) {
		// No author on record (a blueprint imported from outside the start flows): there is no host to
		// embed into, so the file itself is the only honest surface left.
		await openFileInTab(workspaceId, BLUEPRINT_FILE, "keep", undefined, {
			rawBlueprintSource: true,
		});
		return;
	}
	useAppStore.getState().enqueueLayoutIntent({
		kind: "select",
		workspaceId,
		tabId: author.tabId,
		keep: true,
	});
	useAppStore.getState().focusEmbeddedPane(workspaceId, author.hostKey, "blueprint");
}

interface RestoredAuthor {
	tabId: string;
	hostKey: string;
}

/** The author's tab id and embedded-pane host key, reopening the tab when the reader had closed it. */
async function restoreAuthor(
	workspaceId: string,
	state: BlueprintState,
): Promise<RestoredAuthor | null> {
	const author = state.author;
	if (!author) return null;
	const store = useAppStore.getState();
	const placed = store.tabsByWorkspace[workspaceId] ?? [];

	if (author.kind === "chat") {
		const id = chatTabId(workspaceId, author.sessionId);
		if (!placed.some((tab) => tab.id === id)) {
			// pi keeps the transcript on disk, so reopening the session is the whole restore.
			await getTransport()
				.request("session.getMessages", { workspaceId, sessionId: author.sessionId })
				.catch(() => null);
		}
		return { tabId: id, hostKey: embeddedHostKey("chat", author.sessionId) };
	}

	const id = terminalLayoutId(author.tabKey);
	const hostKey = embeddedHostKey("terminal", author.tabKey);
	if (placed.some((tab) => tab.id === id)) return { tabId: id, hostKey };
	// The terminal module's own resume offer only survives a host restart — closing the tab kills the
	// PTY, so the recorded id has to come from the blueprint. See panels/SPEC.md.
	const resumed = await getTransport()
		.request("blueprint.authorCommand", { workspaceId })
		.catch(() => null);
	const document = store.layoutDocumentsByWorkspace[workspaceId];
	store.addTerminal(
		workspaceId,
		resumed?.command ?? undefined,
		document ? primaryCenterGroupId(document) : undefined,
		"center",
		true,
		author.tabKey,
	);
	return { tabId: id, hostKey };
}
