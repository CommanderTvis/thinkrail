import type { PluginWebContext } from "@thinkrail/plugin-api/web";
import type {
	claudeCodeContract,
	IdeActionRequest,
	IdeActionResult,
	IdeCheckDocumentDirtyParams,
	IdeCloseTabParams,
	IdeOpenDiffParams,
	IdeOpenEditorInfo,
	IdeOpenFileParams,
	IdeSaveDocumentParams,
} from "../contracts";

type Ctx = PluginWebContext<typeof claudeCodeContract>;

function relative(ctx: Ctx, workspaceId: string, path: string): string {
	const worktreePath = Object.values(ctx.host().workspaces)
		.flat()
		.find((workspace) => workspace.id === workspaceId)?.worktreePath;
	if (!worktreePath) return path;
	const root = worktreePath.replace(/\/+$/, "");
	if (path === root) return "";
	return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function openEditors(ctx: Ctx, workspaceId: string): IdeOpenEditorInfo[] {
	return ctx.editors
		.list(workspaceId)
		.filter((editor) => editor.kind === "file" || editor.kind === "external-file")
		.map((editor) => ({ path: editor.path, isDirty: editor.dirty }));
}

async function run(ctx: Ctx, request: IdeActionRequest): Promise<unknown> {
	const { workspaceId, kind, params } = request;
	switch (kind) {
		case "openFile": {
			const p = params as IdeOpenFileParams;
			await ctx.editors.open(workspaceId, relative(ctx, workspaceId, p.path), {
				...(p.preview ? { preview: true } : {}),
			});
			return { success: true };
		}
		case "openDiff": {
			// Claude Code's openDiff proposes *unsaved* content for review, which our diff tabs cannot
			// represent — they read both sides from git. Opening the file is the honest subset. See SPEC.md.
			const p = params as IdeOpenDiffParams;
			const target = p.newPath ?? p.oldPath;
			if (!target) throw new Error("openDiff needs a file path");
			await ctx.editors.open(workspaceId, relative(ctx, workspaceId, target));
			return { success: true, diffShown: false };
		}
		case "getOpenEditors":
			return { editors: openEditors(ctx, workspaceId) };
		case "checkDocumentDirty": {
			const p = params as IdeCheckDocumentDirtyParams;
			const path = relative(ctx, workspaceId, p.path);
			const editor = ctx.editors.list(workspaceId).find((candidate) => candidate.path === path);
			return { success: editor !== undefined, isDirty: editor?.dirty ?? false };
		}
		case "saveDocument": {
			const p = params as IdeSaveDocumentParams;
			const path = relative(ctx, workspaceId, p.path);
			const editor = ctx.editors.list(workspaceId).find((candidate) => candidate.path === path);
			if (!editor) return { success: false, saved: false };
			const wasDirty = editor.dirty;
			if (wasDirty) await ctx.editors.save(editor.id);
			return { success: true, saved: wasDirty && !ctx.editors.isDirty(editor.id) };
		}
		case "closeTab": {
			const p = params as IdeCloseTabParams;
			const editor = ctx.editors
				.list(workspaceId)
				.find((candidate) => candidate.path.split("/").pop() === p.tabName);
			if (!editor) throw new Error(`No open tab named ${p.tabName}`);
			ctx.editors.close(editor.id);
			return { success: true };
		}
		case "closeAllDiffTabs": {
			const diffs = ctx.editors.list(workspaceId).filter((editor) => editor.kind === "diff");
			for (const editor of diffs) ctx.editors.close(editor.id);
			return { success: true, closed: diffs.length };
		}
		default:
			throw new Error(`Unsupported IDE action: ${kind satisfies never}`);
	}
}

/** Answers one host-dispatched action. Always replies — a thrown error becomes the CLI's tool error. */
export function createIdeActionHandler(ctx: Ctx): (request: IdeActionRequest) => Promise<void> {
	return async (request) => {
		let result: IdeActionResult;
		try {
			result = { ok: true, value: await run(ctx, request) };
		} catch (err) {
			result = { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
		void ctx.request("actionReply", { id: request.id, result }).catch(() => {});
	};
}
