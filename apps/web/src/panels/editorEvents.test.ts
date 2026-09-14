import { describe, expect, it } from "bun:test";
import { emitEditorEvent, onEditorEvent } from "./editorEvents";

describe("editorEvents", () => {
	it("delivers to every subscriber and stops after unsubscribe", () => {
		const seen: string[] = [];
		const off = onEditorEvent((event) => seen.push(event.kind));
		emitEditorEvent({
			kind: "opened",
			editor: { id: "1", workspaceId: "w", path: "a.ts", kind: "file", dirty: false },
		});
		off();
		emitEditorEvent({
			kind: "closed",
			editor: { id: "1", workspaceId: "w", path: "a.ts", kind: "file", dirty: false },
		});
		expect(seen).toEqual(["opened"]);
	});
});
