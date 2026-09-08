import { expect, test } from "bun:test";
import { desktopContextMenu } from "./contextMenu";

test("plain text gets Copy alone; editable text gets the editing roles", () => {
	expect(desktopContextMenu({ editable: false })).toEqual([{ role: "copy" }]);
	expect(desktopContextMenu({ editable: true })).toEqual([
		{ role: "cut" },
		{ role: "copy" },
		{ role: "paste" },
		{ type: "separator" },
		{ role: "selectAll" },
	]);
});

test("a malformed payload is treated as plain text", () => {
	for (const payload of [null, undefined, "editable", 1, { editable: "true" }, []]) {
		expect(desktopContextMenu(payload)).toEqual([{ role: "copy" }]);
	}
});
