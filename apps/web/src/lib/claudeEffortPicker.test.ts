import { describe, expect, test } from "bun:test";
import {
	CLAUDE_EFFORT_LEVELS,
	type ClaudeEffortLevel,
	driveEffortPicker,
	effortHighlight,
} from "./claudeEffortPicker";
import type { ModelPickerIo } from "./claudeModelPicker";

const LABELS = "         low    medium    high    xhigh    max    ultracode";

/** The picker as the buffer carries it: a track with the marker, then the labels under it. */
function renderEffort(level: ClaudeEffortLevel): string[] {
	const at = LABELS.indexOf(level, level === "high" ? LABELS.indexOf("medium") : 0);
	const center = Math.floor(at + level.length / 2);
	return [
		"    Faster                                            Smarter",
		`${"─".repeat(center)}▲${"─".repeat(20)}`,
		LABELS,
		"                                              xhigh + workflows",
		" ←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel",
	];
}

describe("effortHighlight", () => {
	test("reads the rung from where the marker sits, not from colour the buffer drops", () => {
		for (const level of CLAUDE_EFFORT_LEVELS) {
			expect(effortHighlight(renderEffort(level))).toBe(level);
		}
	});

	test("`high` is not found inside the `xhigh` beside it", () => {
		expect(effortHighlight(renderEffort("xhigh"))).toBe("xhigh");
		expect(effortHighlight(renderEffort("high"))).toBe("high");
	});

	test("anything that is not the slider reads as nothing", () => {
		expect(effortHighlight(["$ /effort", "zsh: command not found"])).toBeUndefined();
		expect(effortHighlight(["▲ a stray marker", "with no labels under it"])).toBeUndefined();
		expect(effortHighlight([])).toBeUndefined();
	});
});

interface FakeSlider {
	io: ModelPickerIo;
	writes: string[];
}

function fakeSlider(start: ClaudeEffortLevel): FakeSlider {
	const writes: string[] = [];
	let open = false;
	let index = CLAUDE_EFFORT_LEVELS.indexOf(start);
	return {
		writes,
		io: {
			write: (data) => {
				writes.push(data);
				if (data === "\r") open = true;
				if (!open) return;
				if (data === "\x1b[C") {
					index = Math.min(CLAUDE_EFFORT_LEVELS.length - 1, index + 1);
				}
				if (data === "\x1b[D") index = Math.max(0, index - 1);
			},
			readLines: () =>
				open ? renderEffort(CLAUDE_EFFORT_LEVELS[index] as ClaudeEffortLevel) : ["❯ /effort"],
			delay: () => Promise.resolve(),
		},
	};
}

describe("driveEffortPicker", () => {
	test("steers right to the rung asked for and takes it for the session", async () => {
		const slider = fakeSlider("low");
		await expect(driveEffortPicker(slider.io, "xhigh")).resolves.toBe("switched");
		expect(slider.writes).toEqual(["", "/effort", "\r", "\x1b[C", "\x1b[C", "\x1b[C", "s", ""]);
	});

	test("steers left, and takes the current rung without moving at all", async () => {
		const down = fakeSlider("max");
		await expect(driveEffortPicker(down.io, "medium")).resolves.toBe("switched");
		expect(down.writes.filter((write) => write === "\x1b[D")).toHaveLength(3);
		expect(down.writes).not.toContain("\x1b[C");

		const already = fakeSlider("high");
		await expect(driveEffortPicker(already.io, "high")).resolves.toBe("switched");
		expect(already.writes).toEqual(["", "/effort", "\r", "s", ""]);
	});

	test("no slider, or a level nobody has, gives up without losing the draft", async () => {
		const writes: string[] = [];
		const io: ModelPickerIo = {
			write: (data) => writes.push(data),
			readLines: () => ["$ /effort", "zsh: no such file or directory"],
			delay: () => Promise.resolve(),
		};
		await expect(driveEffortPicker(io, "high")).resolves.toBe("no-picker");
		expect(writes).toEqual(["", "/effort", "\r", "\x1b", ""]);

		const slider = fakeSlider("low");
		await expect(driveEffortPicker(slider.io, "turbo" as ClaudeEffortLevel)).resolves.toBe(
			"not-found",
		);
		expect(slider.writes).toEqual([]);
	});
});
