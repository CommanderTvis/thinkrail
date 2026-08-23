import { afterEach, expect, test } from "bun:test";
import type { IdeActionRequest, IdeSelectionChanged } from "@thinkrail/contracts";
import {
	__testing,
	applyDocumentClosed,
	applySelectionChanged,
	setIdeBridgeDeps,
	settleAction,
} from "./ideBridge";

afterEach(() => {
	setIdeBridgeDeps(null);
	__testing.reset();
});

function selection(path: string, text = "chunk"): IdeSelectionChanged {
	return {
		workspaceId: "ws-1",
		path,
		text,
		selection: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 4 },
	};
}

test("getCurrentSelection reports what the editor last sent", async () => {
	applySelectionChanged(selection("/repo/a.ts", "hello"));
	const result = (await __testing.callTool("getCurrentSelection", {})) as Record<string, unknown>;
	expect(result.success).toBe(true);
	expect(result.filePath).toBe("/repo/a.ts");
	expect(result.text).toBe("hello");
});

test("with no selection yet, both selection tools decline rather than inventing one", async () => {
	expect(await __testing.callTool("getCurrentSelection", {})).toMatchObject({ success: false });
	expect(await __testing.callTool("getLatestSelection", {})).toMatchObject({ success: false });
});

test("getLatestSelection survives the document closing; getCurrentSelection does not", async () => {
	applySelectionChanged(selection("/repo/a.ts", "kept"));
	applyDocumentClosed({ workspaceId: "ws-1", path: "/repo/a.ts" });

	expect(await __testing.callTool("getCurrentSelection", {})).toMatchObject({ success: false });
	expect(await __testing.callTool("getLatestSelection", {})).toMatchObject({
		success: true,
		text: "kept",
	});
});

function presence(path: string): IdeSelectionChanged {
	return {
		workspaceId: "ws-1",
		path,
		text: "",
		selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
	};
}

test("presence moves the current file without pretending the user selected anything", async () => {
	applySelectionChanged(presence("/repo/readme.md"));

	expect(await __testing.callTool("getCurrentSelection", {})).toMatchObject({
		success: true,
		filePath: "/repo/readme.md",
		text: "",
	});
});

test("walking through files does not erase the last thing the user actually highlighted", async () => {
	applySelectionChanged(selection("/repo/a.ts", "the interesting bit"));
	applySelectionChanged(presence("/repo/readme.md"));

	expect(await __testing.callTool("getCurrentSelection", {})).toMatchObject({
		filePath: "/repo/readme.md",
	});
	expect(await __testing.callTool("getLatestSelection", {})).toMatchObject({
		success: true,
		filePath: "/repo/a.ts",
		text: "the interesting bit",
	});
});

test("closing an unrelated document leaves the current selection alone", async () => {
	applySelectionChanged(selection("/repo/a.ts"));
	applyDocumentClosed({ workspaceId: "ws-1", path: "/repo/other.ts" });
	expect(await __testing.callTool("getCurrentSelection", {})).toMatchObject({ success: true });
});

test("getWorkspaceFolders reports the folders the host published", async () => {
	setIdeBridgeDeps({ dispatch: () => {}, listWorkspaceFolders: () => ["/repo/one", "/repo/two"] });
	expect(await __testing.callTool("getWorkspaceFolders", {})).toEqual({
		folders: [
			{ name: "one", path: "/repo/one" },
			{ name: "two", path: "/repo/two" },
		],
	});
});

test("an action round-trips through the client and resolves with its value", async () => {
	const seen: IdeActionRequest[] = [];
	setIdeBridgeDeps({
		dispatch: (request) => {
			seen.push(request);
			settleAction({ id: request.id, result: { ok: true, value: { success: true } } });
		},
		listWorkspaceFolders: () => [],
	});
	applySelectionChanged(selection("/repo/a.ts"));

	const result = await __testing.callTool("openFile", { filePath: "/repo/b.ts", preview: true });
	expect(result).toEqual({ success: true });
	expect(seen[0]?.kind).toBe("openFile");
	expect(seen[0]?.workspaceId).toBe("ws-1");
	expect(seen[0]?.params).toMatchObject({ path: "/repo/b.ts", preview: true });
});

test("a client-reported failure surfaces as a rejection, not a silent success", async () => {
	setIdeBridgeDeps({
		dispatch: (request) =>
			settleAction({ id: request.id, result: { ok: false, error: "no such tab" } }),
		listWorkspaceFolders: () => [],
	});
	applySelectionChanged(selection("/repo/a.ts"));

	await expect(__testing.callTool("close_tab", { tab_name: "gone.ts" })).rejects.toThrow(
		"no such tab",
	);
});

test("a reply for an id nobody is waiting on is dropped, not thrown", () => {
	expect(() => settleAction({ id: "never-asked", result: { ok: true, value: 1 } })).not.toThrow();
});

test("an action with no client connected fails fast instead of hanging until the timeout", async () => {
	applySelectionChanged(selection("/repo/a.ts"));
	await expect(__testing.callTool("getOpenEditors", {})).rejects.toThrow("No ThinkRail client");
});

test("a write-side tool with no selection to infer a workspace from refuses", async () => {
	setIdeBridgeDeps({ dispatch: () => {}, listWorkspaceFolders: () => [] });
	await expect(__testing.callTool("openFile", { filePath: "/repo/a.ts" })).rejects.toThrow(
		"No active ThinkRail workspace",
	);
});

test("an unknown tool name is an error, never a silent no-op", async () => {
	await expect(__testing.callTool("deleteEverything", {})).rejects.toThrow("Unknown tool");
});

test("openDiff forwards the CLI's snake_case argument names as our own shape", async () => {
	const seen: IdeActionRequest[] = [];
	setIdeBridgeDeps({
		dispatch: (request) => {
			seen.push(request);
			settleAction({ id: request.id, result: { ok: true, value: {} } });
		},
		listWorkspaceFolders: () => [],
	});
	applySelectionChanged(selection("/repo/a.ts"));

	await __testing.callTool("openDiff", {
		old_file_path: "/repo/a.ts",
		new_file_path: "/repo/b.ts",
		new_file_contents: "next",
	});
	expect(seen[0]?.params).toEqual({
		oldPath: "/repo/a.ts",
		newPath: "/repo/b.ts",
		newContent: "next",
	});
});
