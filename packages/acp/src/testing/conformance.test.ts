import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { ChatEvent, MessageId, PromptContent, SessionId } from "@thinkrail/contracts";
import type { ConnectAgentOptions, ProcessSpawner, SpawnedProcess } from "../connection";
import { connectAgent } from "../connection";
import type { UnknownRecord } from "../translate";
import { asRecord, asString } from "../translate";
import type { FixtureCorpus } from "./fixtures";
import { loadFixtures } from "./fixtures";
import type { ClassifiedFrame, FrameRecord } from "./frames";
import { classifyFrames } from "./frames";
import { ACP_RECORD_DIR_ENV, recordFrames, recordFramesFromEnv } from "./recorder";
import { deterministicClock, replayFile, replayRecords } from "./replay";
import type { ProtocolVocabulary } from "./schema";
import { PROTOCOL_VOCABULARIES, schemaVariants, validateFrame, vocabularyVariants } from "./schema";

const FIXTURES = loadFixtures();

function fixture(name: string): FixtureCorpus {
	const found = FIXTURES.find((entry) => entry.name === name);
	if (found === undefined) throw new Error(`no fixture named ${name}`);
	return found;
}

test("the fixture corpus is a corpus", () => {
	expect(FIXTURES.length).toBeGreaterThan(4);
	expect(FIXTURES.flatMap((entry) => entry.records).length).toBeGreaterThan(60);
});

test("every response frame is correlated to the request it answers", () => {
	const orphans: string[] = [];
	for (const entry of FIXTURES) {
		for (const frame of classifyFrames(entry.records)) {
			if (frame.kind === "response" && frame.method === undefined) {
				orphans.push(`${entry.name}: response ${String(frame.frame.id)}`);
			}
		}
	}
	expect(orphans).toEqual([]);
});

const REPORTED_ERRORS = 3;

test("every fixture frame validates against the SDK's own JSON Schema", () => {
	const failures: string[] = [];
	for (const entry of FIXTURES) {
		for (const frame of classifyFrames(entry.records)) {
			const result = validateFrame({
				direction: frame.direction,
				kind: frame.kind,
				method: frame.method,
				payload: frame.frame,
			});
			if (result.valid) continue;
			const named = result.errors.slice(0, REPORTED_ERRORS).join(" | ");
			failures.push(`${entry.name} ${frame.method ?? "?"} (${result.errors.length}): ${named}`);
		}
	}
	expect(failures).toEqual([]);
});

test("a frame the schema forbids is reported, so the validator is not vacuous", () => {
	const missingUpdate = validateFrame({
		direction: "in",
		kind: "notification",
		method: "session/update",
		payload: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "s" } },
	});
	expect(missingUpdate.valid).toBe(false);

	const unknownStopReason = validateFrame({
		direction: "in",
		kind: "response",
		method: "session/prompt",
		payload: { jsonrpc: "2.0", id: 1, result: { stopReason: "gave_up" } },
	});
	expect(unknownStopReason.valid).toBe(false);

	const unknownMethod = validateFrame({
		direction: "in",
		kind: "notification",
		method: "session/invented",
		payload: { jsonrpc: "2.0", method: "session/invented", params: {} },
	});
	expect(unknownMethod.valid).toBe(false);
});

test("schemaVariants refuses a definition or discriminator the schema no longer declares", () => {
	expect(() => schemaVariants("SessionUpdateThatMoved")).toThrow();
	expect(() => schemaVariants("SessionUpdate", "renamedDiscriminator")).toThrow();
});

test("the recorder stays inert until THINKRAIL_ACP_RECORD_DIR names a directory", () => {
	const inner: ProcessSpawner = () => {
		throw new Error("this spawner is never called");
	};
	expect(recordFramesFromEnv(inner, {})).toBe(inner);
	expect(recordFramesFromEnv(inner, { [ACP_RECORD_DIR_ENV]: "   " })).toBe(inner);
	expect(recordFramesFromEnv(inner, { [ACP_RECORD_DIR_ENV]: "/tmp/never-created" })).not.toBe(
		inner,
	);
});

const CORPUS_VOCABULARIES = [
	"sessionUpdate",
	"toolKind",
	"toolStatus",
	"toolContent",
	"contentBlock",
	"stopReason",
] as const satisfies readonly ProtocolVocabulary[];

type CorpusVocabulary = (typeof CORPUS_VOCABULARIES)[number];

type Coverage = { readonly [K in CorpusVocabulary]: Set<string> };

function collectToolCall(update: UnknownRecord, coverage: Coverage): void {
	const kind = asString(update.kind);
	if (kind !== undefined) coverage.toolKind.add(kind);
	const status = asString(update.status);
	if (status !== undefined) coverage.toolStatus.add(status);
	if (!Array.isArray(update.content)) return;
	for (const entry of update.content) {
		const output = asRecord(entry);
		const type = asString(output?.type);
		if (output === undefined || type === undefined) continue;
		coverage.toolContent.add(type);
		if (type !== "content") continue;
		const block = asString(asRecord(output.content)?.type);
		if (block !== undefined) coverage.contentBlock.add(block);
	}
}

function collect(frames: readonly ClassifiedFrame[], coverage: Coverage): void {
	for (const frame of frames) {
		if (frame.direction !== "in") continue;
		if (frame.kind === "response" && frame.method === "session/prompt") {
			const stopReason = asString(asRecord(frame.frame.result)?.stopReason);
			if (stopReason !== undefined) coverage.stopReason.add(stopReason);
			continue;
		}
		if (frame.kind !== "notification" || frame.method !== "session/update") continue;
		const update = asRecord(asRecord(frame.frame.params)?.update);
		const variant = asString(update?.sessionUpdate);
		if (update === undefined || variant === undefined) continue;
		coverage.sessionUpdate.add(variant);
		if (variant.endsWith("_message_chunk") || variant === "agent_thought_chunk") {
			const block = asString(asRecord(update.content)?.type);
			if (block !== undefined) coverage.contentBlock.add(block);
			continue;
		}
		if (variant === "tool_call" || variant === "tool_call_update")
			collectToolCall(update, coverage);
	}
}

const COVERAGE: Coverage = {
	sessionUpdate: new Set(),
	toolKind: new Set(),
	toolStatus: new Set(),
	toolContent: new Set(),
	contentBlock: new Set(),
	stopReason: new Set(),
};
for (const entry of FIXTURES) collect(classifyFrames(entry.records), COVERAGE);

function sorted(values: Iterable<string>): string[] {
	return [...values].sort();
}

for (const name of CORPUS_VOCABULARIES) {
	test(`the corpus covers every ${PROTOCOL_VOCABULARIES[name].def} variant the protocol declares`, () => {
		expect(sorted(COVERAGE[name])).toEqual(sorted(vocabularyVariants(name)));
	});
}

const STOP_REASONS = new Set([
	"completed",
	"maxTokens",
	"maxRequests",
	"refused",
	"cancelled",
	"failed",
]);

interface OpenMessage {
	next: number;
	kinds: Map<number, string>;
	ended: boolean;
}

function streamViolations(events: readonly ChatEvent[]): string[] {
	const bad: string[] = [];
	const messages = new Map<MessageId, OpenMessage>();
	const tools = new Set<string>();
	let turnOpen = false;

	const writable = (messageId: MessageId, where: string): OpenMessage | undefined => {
		const open = messages.get(messageId);
		if (open === undefined) bad.push(`${where} names unstarted message ${messageId}`);
		else if (open.ended) bad.push(`${where} names ended message ${messageId}`);
		else return open;
		return undefined;
	};

	for (const event of events) {
		switch (event.type) {
			case "turn_start":
				if (turnOpen) bad.push("turn_start while a turn was already open");
				turnOpen = true;
				break;
			case "turn_settled": {
				if (!turnOpen) bad.push("turn_settled with no turn open");
				turnOpen = false;
				const marker = event.message.marker;
				if (!STOP_REASONS.has(marker.stopReason))
					bad.push(`unknown stop reason ${marker.stopReason}`);
				if (event.message.id.length === 0) bad.push("turn_settled marker with an empty id");
				break;
			}
			case "message_start": {
				const id = event.message.id;
				if (id.length === 0) bad.push("message_start with an empty id");
				messages.set(id, { next: 0, kinds: new Map(), ended: false });
				break;
			}
			case "message_end": {
				const open = writable(event.messageId, "message_end");
				if (open !== undefined) open.ended = true;
				break;
			}
			case "chunk": {
				const open = writable(event.messageId, "chunk");
				if (open === undefined) break;
				if (event.index === open.next) {
					open.kinds.set(event.index, event.kind);
					open.next += 1;
				} else if (open.kinds.get(event.index) !== event.kind) {
					bad.push(`chunk ${event.index} (${event.kind}) does not continue an open block`);
				}
				break;
			}
			case "block": {
				const open = writable(event.messageId, "block");
				if (open === undefined) break;
				if (event.index !== open.next) bad.push(`block index ${event.index} is not the next one`);
				open.kinds.set(event.index, event.block.type);
				open.next += 1;
				if (event.block.type === "toolCall") tools.add(event.block.toolCallId);
				break;
			}
			case "tool_call_update":
				if (!tools.has(event.toolCallId)) {
					bad.push(`tool_call_update for unannounced call ${event.toolCallId}`);
				}
				break;
			default:
				break;
		}
	}
	if (turnOpen) bad.push("the stream ends with a turn still open");
	return bad;
}

test("every fixture replays into a well-formed chat event stream", () => {
	const violations: string[] = [];
	let total = 0;
	for (const entry of FIXTURES) {
		const events = replayRecords(entry.records);
		total += events.length;
		violations.push(...streamViolations(events).map((issue) => `${entry.name}: ${issue}`));
	}
	expect(violations).toEqual([]);
	expect(total).toBeGreaterThan(50);
});

test("a plan_update carries entries the protocol nests one level deeper than plan", () => {
	const events = replayRecords(fixture("session-signals.json").records);
	const plans = events.filter((event) => event.type === "plan");
	expect(plans.map((event) => event.plan?.entries.length ?? null)).toEqual([3, 3, 0, 0, null]);
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface TurnScript {
	promptId: string;
	frames: UnknownRecord[];
}

function scriptTurns(records: readonly FrameRecord[]): TurnScript[] {
	const turns: TurnScript[] = [];
	let open: TurnScript | undefined;
	for (const frame of classifyFrames(records)) {
		if (frame.direction === "out") {
			if (frame.kind === "request" && frame.method === "session/prompt") {
				open = { promptId: String(frame.frame.id), frames: [] };
				turns.push(open);
			}
			continue;
		}
		if (open === undefined) continue;
		open.frames.push(frame.frame);
		if (frame.kind === "response" && String(frame.frame.id) === open.promptId) open = undefined;
	}
	return turns;
}

function scriptSessionId(records: readonly FrameRecord[]): SessionId {
	for (const frame of classifyFrames(records)) {
		const sessionId = asString(asRecord(frame.frame.params)?.sessionId);
		if (sessionId !== undefined) return sessionId;
	}
	throw new Error("the fixture names no session");
}

class FixtureAgent {
	readonly process: SpawnedProcess;
	readonly #turns: TurnScript[];
	readonly #sessionId: SessionId;
	#taken = 0;
	#buffer = "";
	#queue: Promise<void> = Promise.resolve();
	#gone = false;
	readonly #stdout = new TransformStream<Uint8Array, Uint8Array>();
	readonly #stderr = new TransformStream<Uint8Array, Uint8Array>();
	readonly #writer = this.#stdout.writable.getWriter();
	#leave: (outcome: { code: number | null; signal: string | null }) => void = () => undefined;

	constructor(corpus: FixtureCorpus) {
		this.#turns = scriptTurns(corpus.records);
		this.#sessionId = scriptSessionId(corpus.records);
		const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
			this.#leave = resolve;
		});
		this.process = {
			stdin: new WritableStream<Uint8Array>({
				write: (chunk) => {
					this.#receive(decoder.decode(chunk));
				},
				close: () => {
					this.#exit();
				},
				abort: () => {
					this.#exit();
				},
			}),
			stdout: this.#stdout.readable,
			stderr: this.#stderr.readable,
			exited,
			kill: () => {
				this.#exit();
			},
		};
	}

	get spawner(): ProcessSpawner {
		return () => this.process;
	}

	get sessionId(): SessionId {
		return this.#sessionId;
	}

	get turnCount(): number {
		return this.#turns.length;
	}

	#exit(): void {
		if (this.#gone) return;
		this.#gone = true;
		this.#leave({ code: 0, signal: null });
		this.#queue = this.#queue.then(() => this.#writer.close().catch(() => undefined));
	}

	#send(frame: UnknownRecord): void {
		this.#queue = this.#queue.then(async () => {
			await this.#writer.write(encoder.encode(`${JSON.stringify(frame)}\n`));
		});
	}

	#answer(id: unknown, result: UnknownRecord): void {
		this.#send({ jsonrpc: "2.0", id, result });
	}

	#runTurn(id: unknown): void {
		const turn = this.#turns[this.#taken];
		this.#taken += 1;
		if (turn === undefined) {
			this.#answer(id, { stopReason: "end_turn" });
			return;
		}
		for (const frame of turn.frames) {
			if (String(frame.id) === turn.promptId) this.#send({ ...frame, id });
			else this.#send(frame);
		}
	}

	#dispatch(call: UnknownRecord): void {
		const method = asString(call.method);
		if (method === undefined || call.id === undefined) return;
		if (method === "initialize") {
			this.#answer(call.id, {
				protocolVersion: PROTOCOL_VERSION,
				agentInfo: { name: "fixture-agent", version: "1.2.3" },
			});
			return;
		}
		if (method === "session/new") {
			this.#answer(call.id, { sessionId: this.#sessionId });
			return;
		}
		if (method === "session/prompt") {
			this.#runTurn(call.id);
			return;
		}
		this.#answer(call.id, {});
	}

	#receive(chunk: string): void {
		this.#buffer += chunk;
		for (;;) {
			const newline = this.#buffer.indexOf("\n");
			if (newline < 0) break;
			const line = this.#buffer.slice(0, newline).trim();
			this.#buffer = this.#buffer.slice(newline + 1);
			if (line.length === 0) continue;
			const call = asRecord(JSON.parse(line) as unknown);
			if (call !== undefined) this.#dispatch(call);
		}
	}
}

const PROMPT: PromptContent[] = [
	{ type: "text", text: "run the recorded turn" },
	{ type: "image", data: "aW1n", mimeType: "image/png" },
	{ type: "resource", uri: "file:///tmp/a.md", name: "a.md", mimeType: "text/markdown" },
];

function unsupported(name: string): () => never {
	return () => {
		throw new Error(`${name} is not exercised by this test`);
	};
}

function options(
	spawn: ProcessSpawner,
	publish: (sessionId: SessionId, events: ChatEvent[]) => void,
): ConnectAgentOptions {
	return {
		agent: { id: "fixture", name: "Fixture", origin: "external" },
		launch: { command: "fixture-agent", args: [] },
		clock: deterministicClock(),
		spawn,
		handshakeTimeoutMs: 5_000,
		delegates: {
			readTextFile: unsupported("readTextFile"),
			writeTextFile: unsupported("writeTextFile"),
			createTerminal: unsupported("createTerminal"),
			terminalOutput: unsupported("terminalOutput"),
			waitForTerminalExit: unsupported("waitForTerminalExit"),
			killTerminal: unsupported("killTerminal"),
			releaseTerminal: unsupported("releaseTerminal"),
			requestPermission: unsupported("requestPermission"),
			createElicitation: unsupported("createElicitation"),
			completeElicitation: unsupported("completeElicitation"),
			openMcpEndpoint: unsupported("openMcpEndpoint"),
			publish,
		},
	};
}

async function recordFixture(corpus: FixtureCorpus, dir: string): Promise<ChatEvent[]> {
	const agent = new FixtureAgent(corpus);
	const live: ChatEvent[] = [];
	const connection = await connectAgent(
		options(recordFrames(agent.spawner, { dir }), (_sessionId, events) => {
			live.push(...events);
		}),
	);
	try {
		const session = await connection.newSession({ cwd: "/tmp/fixture-worktree" });
		expect(session.sessionId).toBe(agent.sessionId);
		for (let turn = 0; turn < agent.turnCount; turn += 1) {
			await connection.prompt({ sessionId: session.sessionId, content: PROMPT });
		}
	} finally {
		await connection.close();
	}
	return live.filter((event) => event.type !== "capabilities");
}

function recordedFile(dir: string): string {
	const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
	expect(files.length).toBe(1);
	return join(dir, files[0] ?? "");
}

const REPLAYABLE = [
	"message-blocks.json",
	"session-signals.json",
	"stop-reasons.json",
	"thinkrail-meta.json",
	"tool-calls.json",
];

for (const name of REPLAYABLE) {
	test(`${name}: recording a live session and replaying it yield the same chat events`, async () => {
		const dir = mkdtempSync(join(tmpdir(), "thinkrail-acp-record-"));
		try {
			const live = await recordFixture(fixture(name), dir);
			expect(live.length).toBeGreaterThan(0);
			expect(streamViolations(live)).toEqual([]);
			const replayed = replayFile(recordedFile(dir), { clock: deterministicClock() });
			expect(replayed).toEqual(live);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}
