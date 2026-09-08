import type { ApplicationMenuItemConfig } from "electrobun/main";

export function desktopContextMenu(payload: unknown): ApplicationMenuItemConfig[] {
	const editable =
		typeof payload === "object" && payload !== null && Reflect.get(payload, "editable") === true;
	if (!editable) return [{ role: "copy" }];
	return [
		{ role: "cut" },
		{ role: "copy" },
		{ role: "paste" },
		{ type: "separator" },
		{ role: "selectAll" },
	];
}
