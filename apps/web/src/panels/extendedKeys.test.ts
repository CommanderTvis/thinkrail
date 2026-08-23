import { describe, expect, test } from "bun:test";
import { createExtendedKeyState } from "./extendedKeys";

const ESC = "\u001b";
const shiftEnter = { key: "Enter", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false };
const plainEnter = { key: "Enter", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

describe("extended keys", () => {
	test("stays silent until a program asks — the whole point of negotiating", () => {
		const state = createExtendedKeyState();
		expect(state.mode()).toBe("off");
		expect(state.encode(shiftEnter)).toBeNull();
	});

	test("encodes CSI-u once the kitty protocol is pushed", () => {
		const state = createExtendedKeyState();
		state.pushKitty(1);
		expect(state.mode()).toBe("kitty");
		expect(state.encode(shiftEnter)).toBe(`${ESC}[13;2u`);
	});

	test("popping the kitty stack hands the keys back", () => {
		const state = createExtendedKeyState();
		state.pushKitty(1);
		state.popKitty();
		expect(state.encode(shiftEnter)).toBeNull();
	});

	test("falls back to modifyOtherKeys when that is what was requested", () => {
		const state = createExtendedKeyState();
		state.setModifyOtherKeys(2);
		expect(state.mode()).toBe("modify-other-keys");
		expect(state.encode(shiftEnter)).toBe(`${ESC}[27;2;13~`);
		state.setModifyOtherKeys(0);
		expect(state.encode(shiftEnter)).toBeNull();
	});

	test("an unmodified key keeps meaning what it always meant", () => {
		const state = createExtendedKeyState();
		state.pushKitty(1);
		expect(state.encode(plainEnter)).toBeNull();
	});

	test("modifiers follow the CSI-u bitmask", () => {
		const state = createExtendedKeyState();
		state.pushKitty(1);
		expect(state.encode({ ...shiftEnter, ctrlKey: true })).toBe(`${ESC}[13;6u`);
		expect(state.encode({ ...plainEnter, altKey: true })).toBe(`${ESC}[13;3u`);
	});

	test("leaves keys a terminal already encodes unambiguously alone", () => {
		const state = createExtendedKeyState();
		state.pushKitty(1);
		expect(
			state.encode({ key: "a", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }),
		).toBeNull();
	});

	test("an agent that negotiates nothing still gets its newline: Shift+Enter is ESC+CR", () => {
		const state = createExtendedKeyState();
		// Claude Code asks for no keyboard protocol, so this is the only way it can tell the two apart —
		// the same bytes its own /terminal-setup writes into iTerm2 and VS Code.
		expect(state.encode(shiftEnter, { agentNewline: true })).toBe(`${ESC}\r`);
		// Off by default: in a plain shell those bytes are meta-Enter and mean something else.
		expect(state.encode(shiftEnter)).toBeNull();
		expect(state.encode(plainEnter, { agentNewline: true })).toBeNull();
	});

	test("a negotiated protocol wins over the convention", () => {
		const state = createExtendedKeyState();
		state.pushKitty(1);
		expect(state.encode(shiftEnter, { agentNewline: true })).toBe(`${ESC}[13;2u`);
		state.popKitty();
		expect(state.encode(shiftEnter, { agentNewline: true })).toBe(`${ESC}\r`);
	});

	test("the convention is Shift+Enter only — other modified keys stay untouched", () => {
		const state = createExtendedKeyState();
		const ctrlEnter = {
			key: "Enter",
			shiftKey: false,
			ctrlKey: true,
			altKey: false,
			metaKey: false,
		};
		const shiftTab = { key: "Tab", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false };
		expect(state.encode(ctrlEnter, { agentNewline: true })).toBeNull();
		expect(state.encode(shiftTab, { agentNewline: true })).toBeNull();
	});
});
