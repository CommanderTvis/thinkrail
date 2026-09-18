import { describe, expect, it } from "bun:test";
import { adoptedTitle } from "./terminalTitle";

describe("adoptedTitle", () => {
	it("removes bracketed ASCII status and its label without consuming the task or workspace", () => {
		for (const marker of ["[ ! ]", "[!]", "[ * ]"]) {
			const title = `${marker} Action Required | Describe the image | my-workspace`;
			expect(adoptedTitle(title)).toBe("Describe the image | my-workspace");
			expect(adoptedTitle(adoptedTitle(title))).toBe("Describe the image | my-workspace");
		}
	});

	it("preserves ordinary bracketed titles and status words in task names", () => {
		for (const title of [
			"[RFC] Action Required | Design",
			"Action Required | Design",
			"Task [ ! ] | Design",
		]) {
			expect(adoptedTitle(title)).toBe(title);
		}
	});

	it("drops Claude Code's leading spinner glyph, whichever frame it is on", () => {
		expect(adoptedTitle("✳ Claude Code")).toBe("Claude Code");
		expect(adoptedTitle("◑ Open WebUI to the network")).toBe("Open WebUI to the network");
		expect(adoptedTitle("· Thinking")).toBe("Thinking");
	});

	it("strips the same glyph run regardless of which agent (or none) owns the tab", () => {
		expect(adoptedTitle("⏺ pi coding session")).toBe("pi coding session");
	});

	it("leaves a title alone when it does not start with a lone symbol", () => {
		expect(adoptedTitle("Claude Code")).toBe("Claude Code");
		expect(adoptedTitle("3 files changed")).toBe("3 files changed");
		expect(adoptedTitle("~/src — zsh")).toBe("~/src — zsh");
	});

	it("strips null bytes and surrounding whitespace when there is no leading glyph", () => {
		expect(adoptedTitle("  vim\0 ")).toBe("vim");
	});
});
