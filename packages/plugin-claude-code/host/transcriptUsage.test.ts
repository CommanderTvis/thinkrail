import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriptUsage } from "./transcriptUsage";

let dir: string;
let transcript: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "claude-usage-"));
	transcript = join(dir, "7fda7ad1-ae18-4418-a296-7ada892e93eb.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function assistant(id: string, output: number, extra: Record<string, number> = {}): string {
	return `${JSON.stringify({
		type: "assistant",
		isSidechain: false,
		message: {
			id,
			model: "claude-opus-5-5",
			usage: {
				input_tokens: 2,
				output_tokens: output,
				cache_read_input_tokens: 1000,
				cache_creation_input_tokens: 100,
				...extra,
			},
		},
	})}\n`;
}

test("one message written across several content-block lines counts once, at its last usage", () => {
	writeFileSync(
		transcript,
		`${JSON.stringify({ type: "user", message: { content: "hi" } })}\n${assistant("msg_a", 5)}${assistant("msg_a", 187)}${assistant("msg_b", 10)}`,
	);
	expect(createTranscriptUsage().read(transcript)).toEqual({
		input: 4,
		output: 197,
		cacheRead: 2000,
		cacheWrite: 200,
	});
});

test("reads continue from where they stopped, and a half-written line waits for its end", () => {
	const usage = createTranscriptUsage();
	const partial = assistant("msg_b", 40);
	writeFileSync(transcript, `${assistant("msg_a", 5)}${partial.slice(0, 30)}`);
	expect(usage.read(transcript).output).toBe(5);
	appendFileSync(transcript, `${partial.slice(30)}${assistant("msg_a", 9)}`);
	expect(usage.read(transcript).output).toBe(49);
});

test("subagent transcripts beside the session are its spending too", () => {
	writeFileSync(transcript, assistant("msg_a", 5));
	const subagents = join(transcript.replace(/\.jsonl$/, ""), "subagents");
	mkdirSync(subagents, { recursive: true });
	writeFileSync(join(subagents, "agent-aa3b7a364856011a3.jsonl"), assistant("msg_s", 20));
	writeFileSync(join(subagents, "agent-aa3b7a364856011a3.meta.json"), "{}");
	expect(createTranscriptUsage().read(transcript).output).toBe(25);
});

test("a missing transcript spends nothing, and forgetting starts the count over", () => {
	const usage = createTranscriptUsage();
	expect(usage.read(transcript)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	writeFileSync(transcript, assistant("msg_a", 5));
	expect(usage.read(transcript).output).toBe(5);
	usage.forget(transcript);
	writeFileSync(transcript, assistant("msg_z", 7));
	expect(usage.read(transcript).output).toBe(7);
});
