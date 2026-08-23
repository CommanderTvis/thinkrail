import type { ModelPickerIo, ModelPickerOutcome } from "./claudeModelPicker";
import { KILL_LINE, YANK_LINE } from "./claudeModelPicker";

/** The rungs of Claude Code's effort slider, in the order it draws them. */
export const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max", "ultracode"] as const;

export type ClaudeEffortLevel = (typeof CLAUDE_EFFORT_LEVELS)[number];

const ENTER_DELAY_MS = 250;
const POLL_MS = 150;
const OPEN_POLLS = 24;
const MOVE_POLLS = 8;
const MAX_STEPS = 8;

const MARKER = "▲";

/** Where each level's name sits on the labels line, by its middle column. */
function labelCenters(line: string): Map<ClaudeEffortLevel, number> {
	const centers = new Map<ClaudeEffortLevel, number>();
	let cursor = 0;
	for (const level of CLAUDE_EFFORT_LEVELS) {
		// In order, so `high` cannot be found inside the `xhigh` that follows it.
		const at = line.indexOf(level, cursor);
		if (at === -1) continue;
		centers.set(level, at + level.length / 2);
		cursor = at + level.length;
	}
	return centers;
}

/**
 * Which rung the slider is on.
 *
 * The picker marks the current level with a colour, which a terminal buffer does not carry — but it also
 * draws a `▲` under it on the track, and that survives as text. So the answer is geometric: the label
 * whose middle is nearest the marker's column. See lib/SPEC.md.
 */
export function effortHighlight(lines: readonly string[]): ClaudeEffortLevel | undefined {
	for (let i = lines.length - 1; i >= 0; i--) {
		const track = lines[i] ?? "";
		const marker = track.indexOf(MARKER);
		if (marker === -1) continue;
		const labels = lines[i + 1] ?? "";
		const centers = labelCenters(labels);
		if (centers.size < CLAUDE_EFFORT_LEVELS.length) continue;
		let nearest: ClaudeEffortLevel | undefined;
		let distance = Number.POSITIVE_INFINITY;
		for (const [level, center] of centers) {
			const gap = Math.abs(center - marker);
			if (gap < distance) {
				distance = gap;
				nearest = level;
			}
		}
		return nearest;
	}
	return undefined;
}

/**
 * Drive `/effort` to a level and take it for this session only.
 *
 * The same shape as the model picker — kill the draft, open, steer, press `s`, yank the draft back —
 * but the slider is steered with ←/→ by distance rather than walked down a list.
 */
export async function driveEffortPicker(
	io: ModelPickerIo,
	level: ClaudeEffortLevel,
): Promise<ModelPickerOutcome> {
	const target = CLAUDE_EFFORT_LEVELS.indexOf(level);
	if (target === -1) return "not-found";

	io.write(KILL_LINE);
	await io.delay(ENTER_DELAY_MS);
	io.write("/effort");
	await io.delay(ENTER_DELAY_MS);
	io.write("\r");

	let current: ClaudeEffortLevel | undefined;
	for (let poll = 0; poll < OPEN_POLLS && current === undefined; poll++) {
		await io.delay(POLL_MS);
		current = effortHighlight(io.readLines());
	}
	if (current === undefined) {
		io.write("\x1b");
		io.write(YANK_LINE);
		return "no-picker";
	}

	for (let step = 0; step < MAX_STEPS; step++) {
		const at = CLAUDE_EFFORT_LEVELS.indexOf(current);
		if (at === target) {
			io.write("s");
			await io.delay(POLL_MS);
			io.write(YANK_LINE);
			return "switched";
		}
		const before: ClaudeEffortLevel = current;
		io.write(at < target ? "\x1b[C" : "\x1b[D");
		for (let poll = 0; poll < MOVE_POLLS && current === before; poll++) {
			await io.delay(POLL_MS);
			current = effortHighlight(io.readLines()) ?? current;
		}
		// The slider clamps at its ends: a move that changed nothing is not going to start.
		if (current === before) break;
	}
	io.write("\x1b");
	io.write(YANK_LINE);
	return "not-found";
}
