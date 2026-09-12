import { describe, expect, test } from "bun:test";
import { isFindChord, isSettingsChord, panelHotkeyCommand } from "./useGlobalHotkeys";

const key = (
	code: string,
	overrides: Partial<{
		ctrlKey: boolean;
		metaKey: boolean;
		altKey: boolean;
		shiftKey: boolean;
	}> = {},
) => ({
	code,
	ctrlKey: true,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...overrides,
});

const all = { projects: true, workspace: true, bottom: true } as const;

describe("find chord", () => {
	test("is the platform modifier plus F, physical key, no other modifier", () => {
		expect(isFindChord(key("KeyF"), "Linux")).toBe(true);
		expect(isFindChord(key("KeyF", { ctrlKey: false, metaKey: true }), "MacIntel")).toBe(true);
		expect(isFindChord(key("KeyF", { ctrlKey: false, metaKey: true }), "Linux")).toBe(false);
		expect(isFindChord(key("KeyF", { shiftKey: true }), "Linux")).toBe(false);
		expect(isFindChord(key("KeyF", { altKey: true }), "Linux")).toBe(false);
		expect(isFindChord(key("KeyG"), "Linux")).toBe(false);
	});
});

describe("panel hotkey routing", () => {
	test("keeps the existing physical-key chords and adds Mod+Shift+J for bottom", () => {
		expect(panelHotkeyCommand(key("KeyB"), all, false, "Linux")).toBe("projects");
		expect(panelHotkeyCommand(key("KeyJ"), all, false, "Linux")).toBe("workspace");
		expect(panelHotkeyCommand(key("KeyJ", { shiftKey: true }), all, false, "Linux")).toBe("bottom");
		expect(
			panelHotkeyCommand(
				key("KeyJ", { ctrlKey: false, metaKey: true, shiftKey: true }),
				all,
				false,
				"MacIntel",
			),
		).toBe("bottom");
		expect(panelHotkeyCommand(key("KeyK", { shiftKey: true }), all, false, "Linux")).toBeNull();
	});

	test("does not claim unavailable workspace commands or any panel chord behind a modal", () => {
		expect(
			panelHotkeyCommand(
				key("KeyJ", { shiftKey: true }),
				{ projects: true, workspace: false, bottom: false },
				false,
				"Linux",
			),
		).toBeNull();
		expect(panelHotkeyCommand(key("KeyB"), all, true, "Linux")).toBeNull();
		expect(panelHotkeyCommand(key("KeyJ"), all, true, "Linux")).toBeNull();
		expect(panelHotkeyCommand(key("KeyJ", { shiftKey: true }), all, true, "Linux")).toBeNull();
	});
});

describe("settings chord", () => {
	test("is macOS's own Preferences chord, and exists nowhere else", () => {
		const comma = (over: Partial<ReturnType<typeof key>> = {}) => ({
			...key("Comma", { ctrlKey: false, metaKey: true }),
			...over,
		});
		expect(isSettingsChord(comma(), "MacIntel")).toBe(true);
		expect(isSettingsChord(comma(), "Linux")).toBe(false);
		expect(isSettingsChord(comma(), "Win32")).toBe(false);
		// Control is not the modifier even on a Mac, and no other modifier may ride along.
		expect(isSettingsChord(key("Comma"), "MacIntel")).toBe(false);
		expect(isSettingsChord(comma({ shiftKey: true }), "MacIntel")).toBe(false);
		expect(isSettingsChord(comma({ altKey: true }), "MacIntel")).toBe(false);
		expect(isSettingsChord(key("KeyK", { ctrlKey: false, metaKey: true }), "MacIntel")).toBe(false);
	});
});
