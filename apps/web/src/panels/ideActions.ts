import type {
	IdeActionRequest,
	IdeActionResult,
	IdeCheckDocumentDirtyParams,
	IdeCloseTabParams,
	IdeOpenDiffParams,
	IdeOpenEditorInfo,
	IdeOpenFileParams,
} from "@thinkrail/contracts";
import { projectRelativePath } from "../lib";
import { selectWorkspaceById, useAppStore } from "../store";
import { getTransport } from "../transport";
import { openFileInTab } from "./openTabs";

function relative(workspaceId: string, path: string): string {
	return projectRelativePath(
		path,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
}

function openEditors(workspaceId: string): IdeOpenEditorInfo[] {
	const tabs = useAppStore.getState().tabsByWorkspace[workspaceId] ?? [];
	return tabs
		.filter((tab) => tab.kind === "file" || tab.kind === "external-file")
		.map((tab) => ({ path: (tab as { path: string }).path, isDirty: false }));
}

async function run(request: IdeActionRequest): Promise<unknown> {
	const { workspaceId, kind, params } = request;
	switch (kind) {
		case "openFile": {
			const p = params as IdeOpenFileParams;
			await openFileInTab(
				workspaceId,
				relative(workspaceId, p.path),
				p.preview ? "preview" : "keep",
			);
			return { success: true };
		}
		case "openDiff": {
			// Claude Code's openDiff proposes *unsaved* content for review, which our diff tabs cannot
			// represent — they read both sides from git. Opening the file is the honest subset. See SPEC.md.
			const p = params as IdeOpenDiffParams;
			const target = p.newPath ?? p.oldPath;
			if (!target) throw new Error("openDiff needs a file path");
			await openFileInTab(workspaceId, relative(workspaceId, target), "keep");
			return { success: true, diffShown: false };
		}
		case "getOpenEditors":
			return { editors: openEditors(workspaceId) };
		case "checkDocumentDirty": {
			const p = params as IdeCheckDocumentDirtyParams;
			const path = relative(workspaceId, p.path);
			const open = openEditors(workspaceId).some((editor) => editor.path === path);
			// Every editor here is read-only against the host's copy, so an open file is never dirty.
			return { success: open, isDirty: false };
		}
		case "saveDocument":
			// Nothing to flush: edits go to disk through the agent, not this editor. See SPEC.md.
			return { success: true, saved: false };
		case "closeTab": {
			const p = params as IdeCloseTabParams;
			const tabs = useAppStore.getState().tabsByWorkspace[workspaceId] ?? [];
			const match = tabs.find((tab) => tab.name === p.tabName);
			if (!match) throw new Error(`No open tab named ${p.tabName}`);
			useAppStore.getState().closeTab(match.id, true, true, workspaceId);
			return { success: true };
		}
		case "closeAllDiffTabs": {
			const tabs = useAppStore.getState().tabsByWorkspace[workspaceId] ?? [];
			const diffs = tabs.filter((tab) => tab.kind === "diff");
			for (const tab of diffs) useAppStore.getState().closeTab(tab.id, true, false, workspaceId);
			return { success: true, closed: diffs.length };
		}
		default:
			throw new Error(`Unsupported IDE action: ${kind satisfies never}`);
	}
}

/** Answers one host-dispatched action. Always replies — a thrown error becomes the CLI's tool error. */
export async function handleIdeAction(request: IdeActionRequest): Promise<void> {
	let result: IdeActionResult;
	try {
		result = { ok: true, value: await run(request) };
	} catch (err) {
		result = { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
	void getTransport()
		.request("ideBridge.actionReply", { id: request.id, result })
		.catch(() => {});
}
