// The wire between ThinkRail's host and its own web client for the Claude Code IDE-integration bridge
// (packages/server/src/ideBridge/SPEC.md). The bridge's OTHER side — the WebSocket+MCP server a `claude`
// CLI actually connects to — is not this file: that protocol is Anthropic's (undocumented, reverse
// engineered), and everything here is ThinkRail's own, ordinary request/push shape.

export interface IdeSelection {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

/** Pushed by the client on every selection/active-file change, live, while `claudeCodeEnabled`. */
export interface IdeSelectionChanged {
	workspaceId: string;
	path: string;
	text: string;
	selection: IdeSelection;
}

/** Pushed by the client when a tab holding one of these paths closes. */
export interface IdeDocumentClosed {
	workspaceId: string;
	path: string;
}

export type IdeActionKind =
	| "openFile"
	| "openDiff"
	| "getOpenEditors"
	| "checkDocumentDirty"
	| "saveDocument"
	| "closeTab"
	| "closeAllDiffTabs";

export interface IdeOpenFileParams {
	path: string;
	preview?: boolean;
	startText?: string;
	endText?: string;
}

export interface IdeOpenDiffParams {
	oldPath?: string;
	newPath?: string;
	newContent?: string;
}

export interface IdeCheckDocumentDirtyParams {
	path: string;
}

export interface IdeSaveDocumentParams {
	path: string;
}

export interface IdeCloseTabParams {
	tabName: string;
}

export type IdeActionParams =
	| IdeOpenFileParams
	| IdeOpenDiffParams
	| IdeCheckDocumentDirtyParams
	| IdeSaveDocumentParams
	| IdeCloseTabParams
	| Record<string, never>;

/** A host-initiated action, pushed to every client for the workspace; exactly one replies. */
export interface IdeActionRequest {
	id: string;
	workspaceId: string;
	kind: IdeActionKind;
	params: IdeActionParams;
}

export interface IdeOpenEditorInfo {
	path: string;
	isDirty: boolean;
}

export type IdeActionResult = { ok: true; value: unknown } | { ok: false; error: string };

export interface IdeActionReply {
	id: string;
	result: IdeActionResult;
}
