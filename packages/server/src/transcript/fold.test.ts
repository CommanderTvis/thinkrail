import { expect, test } from "bun:test";
import type { ChatEvent } from "@thinkrail/contracts";
import { createFold, deriveCorpus, ingest, recordOf, repairOnOpen, replay } from "./fold";
import type { LogEntry, LogHead } from "./format";

const HEAD: LogHead = {
	t: "head",
	v: 1,
	sessionId: "s1",
	workspaceId: "w1",
	cwd: "/tmp/wt",
	agentId: "thinkrail-pi",
	createdAt: 1000,
};

function run(events: ChatEvent[]): { entries: LogEntry[]; fold: ReturnType<typeof createFold> } {
	const fold = createFold(HEAD);
	const entries: LogEntry[] = [];
	let now = 1000;
	for (const event of events) {
		now += 10;
		for (const planned of ingest(fold, event, now).entries) {
			if (planned.durable) entries.push(planned.entry);
		}
	}
	return { entries, fold };
}

const user = (text: string, id: string): ChatEvent => ({
	type: "message_start",
	message: { role: "user", id, timestamp: 1000, content: [{ type: "text", text }] },
});

const assistant = (id: string): ChatEvent => ({
	type: "message_start",
	message: { role: "assistant", id, timestamp: 1010, blocks: [] },
});

const runningTool = (id: string, toolCallId: string, index: number): ChatEvent => ({
	type: "block",
	messageId: id,
	index,
	block: {
		type: "toolCall",
		toolCallId,
		toolName: "bash",
		title: "Run",
		kind: "execute",
		status: "running",
		arguments: { command: "ls" },
	},
});

test("chunks append into one block and a replayed log reproduces the live fold", () => {
	const { entries, fold } = run([
		user("hello", "u1"),
		assistant("a1"),
		{ type: "chunk", messageId: "a1", index: 0, kind: "thinking", delta: "hm" },
		{ type: "chunk", messageId: "a1", index: 1, kind: "text", delta: "Hel" },
		{ type: "chunk", messageId: "a1", index: 1, kind: "text", delta: "lo" },
		runningTool("a1", "t1", 2),
		{
			type: "tool_call_update",
			toolCallId: "t1",
			patch: { status: "done", output: [{ type: "text", text: "final" }] },
		},
		{ type: "message_end", messageId: "a1", endedAt: 1200 },
		{
			type: "turn_settled",
			message: {
				role: "marker",
				id: "s1m",
				timestamp: 1300,
				marker: { kind: "turnSettled", stopReason: "completed" },
			},
		},
	]);

	const message = fold.messages[1];
	if (message?.role !== "assistant") throw new Error("expected an assistant message");
	expect(message.blocks.map((block) => block.type)).toEqual(["thinking", "text", "toolCall"]);
	expect(message.blocks[1]).toEqual({ type: "text", text: "Hello" });

	const replayed = replay(HEAD, entries);
	expect(replayed.messages).toEqual(fold.messages);
	expect(recordOf(replayed)).toEqual(recordOf(fold));
	expect(recordOf(fold).lastSettlement).toEqual({ stopReason: "completed" });
});

test("in-flight tool output shapes the fold but never reaches the log", () => {
	const { entries, fold } = run([
		assistant("a1"),
		runningTool("a1", "t1", 0),
		{
			type: "tool_call_update",
			toolCallId: "t1",
			patch: { output: [{ type: "text", text: "partial" }] },
		},
	]);
	const message = fold.messages[0];
	if (message?.role !== "assistant") throw new Error("expected an assistant message");
	const block = message.blocks[0];
	if (block?.type !== "toolCall") throw new Error("expected a tool call block");
	expect(block.output).toEqual([{ type: "text", text: "partial" }]);
	expect(JSON.stringify(entries)).not.toContain("partial");
});

test("a settled turn abandons a tool call it outran", () => {
	const { fold } = run([
		user("go", "u1"),
		assistant("a1"),
		runningTool("a1", "t1", 0),
		{
			type: "turn_settled",
			message: {
				role: "marker",
				id: "s1m",
				timestamp: 1300,
				marker: { kind: "turnSettled", stopReason: "cancelled" },
			},
		},
	]);
	const message = fold.messages[1];
	if (message?.role !== "assistant") throw new Error("expected an assistant message");
	const block = message.blocks[0];
	if (block?.type !== "toolCall") throw new Error("expected a tool call block");
	expect(block.status).toBe("abandoned");
	expect(message.endedAt).toBeGreaterThan(0);
});

test("reopening after a host stop settles the turn and abandons the orphan", () => {
	const { entries } = run([user("go", "u1"), assistant("a1"), runningTool("a1", "t1", 0)]);
	const reopened = replay(HEAD, entries);
	repairOnOpen(reopened, 9999, () => "repair");
	const message = reopened.messages[1];
	if (message?.role !== "assistant") throw new Error("expected an assistant message");
	const block = message.blocks[0];
	if (block?.type !== "toolCall") throw new Error("expected a tool call block");
	expect(block.status).toBe("abandoned");
	expect(reopened.lastSettlement?.stopReason).toBe("failed");
});

test("the corpus keys on message identity and skips control traffic", () => {
	const { fold } = run([
		user("[thinkrail:todo-nudge] wake", "u0"),
		user("real prompt", "u1"),
		assistant("a1"),
		{ type: "chunk", messageId: "a1", index: 0, kind: "text", delta: "reply" },
	]);
	expect(deriveCorpus(fold)).toEqual([
		{ messageId: "u1", role: "user", text: "real prompt", timestamp: 1000 },
		{ messageId: "a1", role: "assistant", text: "reply", timestamp: 1010 },
	]);
	expect(recordOf(fold).promptCount).toBe(1);
});

test("re-announcing a message id replaces it rather than adding a second bubble", () => {
	const { fold } = run([
		user("/skill:x", "u1"),
		{
			type: "message_start",
			message: {
				role: "user",
				id: "u1",
				timestamp: 1000,
				content: [{ type: "text", text: "<skill name=x/>" }],
			},
		},
	]);
	expect(fold.messages).toHaveLength(1);
	const message = fold.messages[0];
	if (message?.role !== "user") throw new Error("expected a user message");
	expect(message.content).toEqual([{ type: "text", text: "<skill name=x/>" }]);
	expect(recordOf(fold).promptCount).toBe(1);
});
