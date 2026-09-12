import { describe, expect, test } from "bun:test";
import { globalHotkeyCommand, isFindChord, isSettingsChord } from "./useGlobalHotkeys";

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

const all = {
	projects: true,
	workspace: true,
	bottom: true,
	newWorkspace: true,
	sessionSwitcher: true,
} as const;

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
		expect(globalHotkeyCommand(key("KeyB"), all, false, "Linux")).toBe("projects");
		expect(globalHotkeyCommand(key("KeyJ"), all, false, "Linux")).toBe("workspace");
		expect(globalHotkeyCommand(key("KeyJ", { shiftKey: true }), all, false, "Linux")).toBe(
			"bottom",
		);
		expect(
			globalHotkeyCommand(
				key("KeyJ", { ctrlKey: false, metaKey: true, shiftKey: true }),
				all,
				false,
				"MacIntel",
			),
		).toBe("bottom");
		expect(globalHotkeyCommand(key("KeyK", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyB", { altKey: true }), all, false, "Linux")).toBeNull();
	});

	test("routes Mod+K to session-switcher when available, suppressed behind modal", () => {
		expect(globalHotkeyCommand(key("KeyK"), all, false, "Linux")).toBe("session-switcher");
		expect(
			globalHotkeyCommand(key("KeyK", { ctrlKey: false, metaKey: true }), all, false, "MacIntel"),
		).toBe("session-switcher");
		expect(globalHotkeyCommand(key("KeyK"), all, true, "Linux")).toBeNull();
		expect(
			globalHotkeyCommand(key("KeyK"), { ...all, sessionSwitcher: false }, false, "Linux"),
		).toBeNull();
		expect(globalHotkeyCommand(key("KeyK", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyK", { altKey: true }), all, false, "Linux")).toBeNull();
	});

	test("routes Mod+N and the Mod+Alt+N alias to new-workspace, never with Shift, never when unavailable or behind a modal", () => {
		expect(globalHotkeyCommand(key("KeyN"), all, false, "Linux")).toBe("new-workspace");
		expect(
			globalHotkeyCommand(key("KeyN", { ctrlKey: false, metaKey: true }), all, false, "MacIntel"),
		).toBe("new-workspace");
		expect(globalHotkeyCommand(key("KeyN", { altKey: true }), all, false, "Linux")).toBe(
			"new-workspace",
		);
		expect(
			globalHotkeyCommand(
				key("KeyN", { ctrlKey: false, metaKey: true, altKey: true }),
				all,
				false,
				"MacIntel",
			),
		).toBe("new-workspace");
		expect(globalHotkeyCommand(key("KeyN", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(
			globalHotkeyCommand(key("KeyN"), { ...all, newWorkspace: false }, false, "Linux"),
		).toBeNull();
		expect(globalHotkeyCommand(key("KeyN"), all, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyN", { metaKey: false }), all, false, "MacIntel")).toBeNull();
	});

	test("does not claim unavailable workspace commands or any panel chord behind a modal", () => {
		expect(
			globalHotkeyCommand(
				key("KeyJ", { shiftKey: true }),
				{ projects: true, workspace: false, bottom: false, newWorkspace: false },
				false,
				"Linux",
			),
		).toBeNull();
		expect(globalHotkeyCommand(key("KeyB"), all, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyJ"), all, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyJ", { shiftKey: true }), all, true, "Linux")).toBeNull();
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
