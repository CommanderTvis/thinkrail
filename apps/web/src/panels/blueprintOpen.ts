import type { BlueprintState } from "@thinkrail/contracts";
import { BLUEPRINT_FILE } from "@thinkrail/contracts";
import { primaryCenterGroupId } from "@/shell/layout";
import { terminalLayoutId } from "@/shell/terminalReconciliation";
import { blueprintTabId, chatTabId, useAppStore } from "@/store";
import { getTransport } from "@/transport";

export function isBlueprintPath(path: string): boolean {
	return path === BLUEPRINT_FILE;
}

/**
 * The spec has one surface. Opening `BLUEPRINT.md` — from Files, from Specs, from anywhere — brings back
 * the pair it belongs to rather than a second, plain view of the same document; and if the author's half
 * was closed, it is restored beside it. See panels/SPEC.md.
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
	const blueprintTab = blueprintTabId(workspaceId);
	useAppStore.getState().enqueueLayoutIntent({
		kind: "open",
		workspaceId,
		tab: { kind: "blueprint", id: blueprintTab, name: "Blueprint", workspaceId },
		intent: "keep",
		activate: true,
	});
	if (author) {
		useAppStore.getState().enqueueLayoutIntent({
			kind: "pane-with",
			workspaceId,
			tabId: blueprintTab,
			targetId: author,
			direction: "horizontal",
		});
	}
}

/** Returns the layout id of the author's tab, reopening it when the reader had closed it. */
async function restoreAuthor(workspaceId: string, state: BlueprintState): Promise<string | null> {
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
		return id;
	}

	const id = terminalLayoutId(author.tabKey);
	if (placed.some((tab) => tab.id === id)) return id;
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
	return id;
}
