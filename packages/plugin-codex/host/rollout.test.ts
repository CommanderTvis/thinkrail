import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRolloutReader } from "./rollout";

let dir: string;
let rollout: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "codex-rollout-"));
	rollout = join(dir, "rollout-2026-09-22T19-56-52-01a0ca43-721d-7a92-a55c-21d1381af545.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tokenCount(input: number, cached: number, output: number): string {
	const usage = {
		input_tokens: input,
		cached_input_tokens: cached,
		cache_write_input_tokens: 0,
		output_tokens: output,
		reasoning_output_tokens: 18,
		total_tokens: input + output,
	};
	return `${JSON.stringify({
		timestamp: "2026-09-22T17:57:24.457Z",
		ordinal: 15,
		type: "event_msg",
		payload: {
			type: "token_count",
			info: { total_token_usage: usage, last_token_usage: usage, model_context_window: 258400 },
			rate_limits: { limit_id: "codex" },
		},
	})}\n`;
}

function functionCall(name: string, args: unknown): string {
	return `${JSON.stringify({
		timestamp: "2026-09-22T17:57:25.000Z",
		type: "response_item",
		payload: {
			type: "function_call",
			id: "fc_1",
			name,
			arguments: JSON.stringify(args),
			call_id: "call_1",
		},
	})}\n`;
}

test("the session's totals are Codex's own last token_count, with cached input split out", () => {
	writeFileSync(rollout, `${tokenCount(1000, 400, 10)}${tokenCount(23611, 11008, 33)}`);
	expect(createRolloutReader().read(rollout)).toEqual({
		usage: { input: 12603, output: 33, cacheRead: 11008, cacheWrite: 0 },
	});
});

test("the plan is the last update_plan call, and other calls leave it alone", () => {
	writeFileSync(
		rollout,
		`${functionCall("update_plan", {
			explanation: "start",
			plan: [
				{ step: "Read the code", status: "completed" },
				{ step: "Fix it", status: "in_progress" },
				{ step: "Bogus", status: "someday" },
			],
		})}${functionCall("wait", { cell_id: "16" })}`,
	);
	expect(createRolloutReader().read(rollout).plan).toEqual([
		{ content: "Read the code", status: "completed" },
		{ content: "Fix it", status: "in_progress" },
	]);
});

test("reads pick up appended lines and hold a half-written one until it ends", () => {
	const reader = createRolloutReader();
	const later = tokenCount(5000, 1000, 50);
	writeFileSync(rollout, `${tokenCount(1000, 0, 10)}${later.slice(0, 40)}`);
	expect(reader.read(rollout).usage?.output).toBe(10);
	appendFileSync(rollout, later.slice(40));
	expect(reader.read(rollout).usage).toEqual({
		input: 4000,
		output: 50,
		cacheRead: 1000,
		cacheWrite: 0,
	});
});

test("a missing rollout or malformed plan says nothing", () => {
	const reader = createRolloutReader();
	expect(reader.read(rollout)).toEqual({});
	writeFileSync(rollout, `not json\n${functionCall("update_plan", "nope")}`);
	expect(reader.read(rollout)).toEqual({});
});
