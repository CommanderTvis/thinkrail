import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createInterruptWatch,
	INTERRUPT_CLOCK_SLACK_MS,
	transcriptInterruptedSince,
} from "./interruptWatch";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "interrupt-watch-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse("2026-09-14T10:00:00.000Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const prompt = (text: string, offsetMs: number) =>
	JSON.stringify({
		type: "user",
		message: { role: "user", content: text },
		timestamp: at(offsetMs),
	});
const assistant = (offsetMs: number) =>
	JSON.stringify({
		type: "assistant",
		message: { role: "assistant", content: [{ type: "text", text: "working" }] },
		timestamp: at(offsetMs),
	});
const interrupt = (offsetMs: number, suffix = "") =>
	JSON.stringify({
		type: "user",
		message: {
			role: "user",
			content: [{ type: "text", text: `[Request interrupted by user${suffix}]` }],
		},
		timestamp: at(offsetMs),
	});
const snapshot = () => JSON.stringify({ type: "file-history-snapshot", snapshot: {} });

function transcript(...lines: string[]): string {
	const path = join(dir, "session.jsonl");
	writeFileSync(path, `${lines.join("\n")}\n`);
	return path;
}

describe("transcriptInterruptedSince", () => {
	test("an interrupt marker as the last turn, after bookkeeping lines, counts", () => {
		const path = transcript(prompt("do it", 0), assistant(1000), interrupt(5000), snapshot());
		expect(transcriptInterruptedSince(path, T0)).toBe(true);
	});

	test("a tool-use interrupt counts too", () => {
		const path = transcript(prompt("do it", 0), interrupt(5000, " for tool use"), snapshot());
		expect(transcriptInterruptedSince(path, T0)).toBe(true);
	});

	test("a marker older than the turn being watched is a previous turn's", () => {
		const path = transcript(prompt("do it", 0), interrupt(5000));
		expect(transcriptInterruptedSince(path, T0 + 6000)).toBe(false);
	});

	test("a turn resumed after the marker is not interrupted", () => {
		const path = transcript(interrupt(0), snapshot(), prompt("try again", 5000));
		expect(transcriptInterruptedSince(path, T0)).toBe(false);
		const streaming = transcript(interrupt(0), prompt("try again", 5000), assistant(6000));
		expect(transcriptInterruptedSince(streaming, T0)).toBe(false);
	});

	test("a missing transcript or one without turns is not an interrupt", () => {
		expect(transcriptInterruptedSince(join(dir, "nope.jsonl"), T0)).toBe(false);
		expect(transcriptInterruptedSince(transcript(snapshot()), T0)).toBe(false);
	});

	test("only the tail is read, so a huge earlier line does not matter", () => {
		const path = transcript(prompt("x".repeat(64 * 1024), 0), assistant(1000), interrupt(5000));
		expect(transcriptInterruptedSince(path, T0)).toBe(true);
	});
});

describe("createInterruptWatch", () => {
	function harness(probeResult: () => boolean) {
		const state = { timers: 0, tick: () => {}, fired: [] as string[] };
		const watch = createInterruptWatch({
			probe: () => probeResult(),
			now: () => T0,
			schedule: (fn) => {
				state.timers += 1;
				state.tick = fn;
				return 1 as unknown as ReturnType<typeof setInterval>;
			},
			cancel: () => {
				state.timers -= 1;
			},
		});
		return { state, watch };
	}

	test("fires once for an interrupted turn and stops polling when nothing is tracked", () => {
		let interrupted = false;
		const { state, watch } = harness(() => interrupted);
		watch.track(
			"t1",
			() => "/transcript",
			() => state.fired.push("t1"),
		);
		expect(state.timers).toBe(1);
		state.tick();
		expect(state.fired).toEqual([]);
		interrupted = true;
		state.tick();
		state.tick();
		expect(state.fired).toEqual(["t1"]);
		expect(state.timers).toBe(0);
	});

	test("a turn whose transcript is not on disk yet is probed once it is", () => {
		let path: string | null = null;
		const probed: string[] = [];
		const watch = createInterruptWatch({
			probe: (p) => {
				probed.push(p);
				return false;
			},
			now: () => T0,
			schedule: (fn) => {
				fn();
				path = "/transcript";
				fn();
				return 1 as unknown as ReturnType<typeof setInterval>;
			},
			cancel: () => {},
		});
		watch.track(
			"t1",
			() => path,
			() => {},
		);
		expect(probed).toEqual(["/transcript"]);
	});

	test("the watch window starts slightly before the report arrived", () => {
		let since = 0;
		const watch = createInterruptWatch({
			probe: (_path, s) => {
				since = s;
				return false;
			},
			now: () => T0,
			schedule: (fn) => {
				fn();
				return 1 as unknown as ReturnType<typeof setInterval>;
			},
			cancel: () => {},
		});
		watch.track(
			"t1",
			() => "/transcript",
			() => {},
		);
		expect(since).toBe(T0 - INTERRUPT_CLOCK_SLACK_MS);
	});

	test("stopping a settled turn clears it before the poll sees it", () => {
		const { state, watch } = harness(() => true);
		watch.track(
			"t1",
			() => "/transcript",
			() => state.fired.push("t1"),
		);
		watch.stop("t1");
		expect(state.timers).toBe(0);
		state.tick();
		expect(state.fired).toEqual([]);
	});
});
