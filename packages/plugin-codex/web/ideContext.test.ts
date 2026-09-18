import { expect, test } from "bun:test";
import type { EditorRef } from "@thinkrail/plugin-api/web";
import { editorContext } from "./ideContext";

const editor: EditorRef = {
	id: "one",
	workspaceId: "workspace",
	path: "src/main.ts",
	kind: "file",
	dirty: true,
};

test("IDE context includes unsaved selected text and converts editor coordinates exactly once", () => {
	expect(
		editorContext([editor], editor, {
			startLine: 3,
			startColumn: 2,
			endLine: 4,
			endColumn: 7,
			text: "unsaved selection",
		}),
	).toEqual({
		openTabs: [{ path: "src/main.ts", label: "main.ts" }],
		activeFile: {
			path: "src/main.ts",
			label: "main.ts",
			activeSelectionContent: "unsaved selection",
			selection: { start: { line: 2, character: 1 }, end: { line: 3, character: 6 } },
		},
	});
});

test("closed editors and diff views cannot leave stale selected text in context", () => {
	const selection = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 8, text: "private" };
	expect(editorContext([], editor, selection)).toEqual({ activeFile: null, openTabs: [] });
	const diff = { ...editor, kind: "diff" as const };
	expect(editorContext([diff], diff, selection)).toEqual({ activeFile: null, openTabs: [] });
});

test("external editor paths are retained and an unselected file starts at zero", () => {
	const external = { ...editor, path: "C:\\Users\\me\\AGENTS.md", kind: "external-file" as const };
	expect(editorContext([external], external, null)).toMatchObject({
		activeFile: {
			label: "AGENTS.md",
			path: external.path,
			activeSelectionContent: "",
			selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
		},
	});
});
