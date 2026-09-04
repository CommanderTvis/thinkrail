import { describe, expect, test } from "bun:test";
import { createMouseModeGuard } from "./mouseModeGuard";

const ESC = "";

describe("createMouseModeGuard", () => {
	test("passes plain output through unchanged", () => {
		const guard = createMouseModeGuard();
		expect(guard.transform("hello\r\n")).toBe("hello\r\n");
	});

	test("leaves mode sequences untouched when the app cleans up after itself", () => {
		const guard = createMouseModeGuard();
		const enter = `${ESC}[?1049h${ESC}[?1000h${ESC}[?1006hTUI content`;
		expect(guard.transform(enter)).toBe(enter);
		const exit = `${ESC}[?1006l${ESC}[?1000l${ESC}[?1049l$ `;
		expect(guard.transform(exit)).toBe(exit);
	});

	test("forces a mouse-mode reset when the alt screen exits with mouse tracking still on", () => {
		const guard = createMouseModeGuard();
		guard.transform(`${ESC}[?1049h${ESC}[?1000;1006hTUI content`);
		const result = guard.transform(`${ESC}[?1049l$ `);
		expect(result).toContain(`${ESC}[?1049l`);
		expect(result).toContain(`${ESC}[?1000l`);
		expect(result).toContain(`${ESC}[?1006l`);
		expect(result.indexOf(`${ESC}[?1049l`)).toBeLessThan(result.indexOf(`${ESC}[?1000l`));
	});

	test("does nothing on plain alt-screen exit without mouse tracking", () => {
		const guard = createMouseModeGuard();
		guard.transform(`${ESC}[?1049hTUI content`);
		const exit = `${ESC}[?1049l$ `;
		expect(guard.transform(exit)).toBe(exit);
	});

	test("only resets once per left-on episode", () => {
		const guard = createMouseModeGuard();
		guard.transform(`${ESC}[?1049h${ESC}[?1000hTUI content`);
		const first = guard.transform(`${ESC}[?1049l$ `);
		expect(first).toContain(`${ESC}[?1000l`);
		guard.transform(`${ESC}[?1049h more`);
		const second = guard.transform(`${ESC}[?1049l$ `);
		expect(second).not.toContain(`${ESC}[?1000l`);
	});

	test("resetIfEnabled is a no-op when mouse tracking was never on", () => {
		const guard = createMouseModeGuard();
		guard.transform("plain output");
		expect(guard.resetIfEnabled()).toBe("");
	});

	test("resetIfEnabled forces a reset for a TUI that enabled mouse tracking inline (no alt screen)", () => {
		const guard = createMouseModeGuard();
		guard.transform(`${ESC}[?1000;1006h inline TUI, no alt screen`);
		const reset = guard.resetIfEnabled();
		expect(reset).toContain(`${ESC}[?1000l`);
		expect(reset).toContain(`${ESC}[?1006l`);
		expect(guard.resetIfEnabled()).toBe("");
	});

	test("handles a mode sequence split across chunks", () => {
		const guard = createMouseModeGuard();
		guard.transform(`${ESC}[?1049h${ESC}[?1000hTUI`);
		const part1 = guard.transform(`${ESC}[?10`);
		const part2 = guard.transform("49l$ ");
		expect(part1 + part2).toContain(`${ESC}[?1049l`);
		expect(part1 + part2).toContain(`${ESC}[?1000l`);
	});
});
