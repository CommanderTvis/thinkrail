import { expect, test } from "bun:test";
import type { ChatEvent } from "@thinkrail/contracts";
import { SessionAssembler } from "./assembler";

function harness(): {
	next: SessionAssembler;
	events: ChatEvent[];
	feed: (update: unknown) => void;
} {
	let id = 0;
	let now = 1000;
	const next = new SessionAssembler({ now: () => (now += 10), nextId: () => `m${id++}` });
	const events: ChatEvent[] = [];
	return {
		next,
		events,
		feed: (update) => {
			events.push(...next.apply({ sessionId: "s", update } as never));
		},
	};
}

function assistantBlocks(events: readonly ChatEvent[], messageId: string): string[] {
	const blocks: string[] = [];
	for (const event of events) {
		if (event.type === "chunk" && event.messageId === messageId) blocks[event.index] = event.kind;
		if (event.type === "block" && event.messageId === messageId)
			blocks[event.index] = event.block.type;
	}
	return blocks;
}

test("a tool call between two text chunks opens a third block", () => {
	const { events, feed } = harness();
	feed({
		sessionUpdate: "agent_message_chunk",
		messageId: "a",
		content: { type: "text", text: "one" },
	});
	feed({
		sessionUpdate: "tool_call",
		toolCallId: "t1",
		title: "Run",
		kind: "execute",
		status: "in_progress",
	});
	feed({
		sessionUpdate: "agent_message_chunk",
		messageId: "a",
		content: { type: "text", text: "two" },
	});
	const start = events.find((event) => event.type === "message_start");
	if (start?.type !== "message_start") throw new Error("no message");
	expect(assistantBlocks(events, start.message.id)).toEqual(["text", "toolCall", "text"]);
});

test("a new agent message id ends the previous message", () => {
	const { events, feed } = harness();
	feed({
		sessionUpdate: "agent_message_chunk",
		messageId: "a",
		content: { type: "text", text: "one" },
	});
	feed({
		sessionUpdate: "agent_message_chunk",
		messageId: "b",
		content: { type: "text", text: "two" },
	});
	expect(events.filter((event) => event.type === "message_start")).toHaveLength(2);
	expect(events.filter((event) => event.type === "message_end")).toHaveLength(1);
});

test("an empty chunk opens nothing", () => {
	const { events, feed } = harness();
	feed({
		sessionUpdate: "agent_message_chunk",
		messageId: "a",
		content: { type: "text", text: "" },
	});
	expect(events.filter((event) => event.type === "chunk")).toHaveLength(0);
});

test("a nameless tool call gets a namespaced name no built-in renderer claims", () => {
	const { events, feed } = harness();
	feed({
		sessionUpdate: "tool_call",
		toolCallId: "t1",
		title: "Run ls",
		kind: "execute",
		status: "in_progress",
	});
	const block = events.find((event) => event.type === "block");
	if (block?.type !== "block" || block.block.type !== "toolCall") throw new Error("no tool block");
	expect(block.block.toolName).toBe("acp:execute");
});

test("an update for an unseen tool synthesises the row rather than dropping it", () => {
	const { events, feed } = harness();
	feed({ sessionUpdate: "tool_call_update", toolCallId: "ghost", status: "completed" });
	const block = events.find((event) => event.type === "block");
	if (block?.type !== "block" || block.block.type !== "toolCall") throw new Error("no tool block");
	expect(block.block.toolCallId).toBe("ghost");
	expect(block.block.status).toBe("done");
});

test("settling abandons a tool call the turn outran", () => {
	const { next, events, feed } = harness();
	next.beginTurn([{ type: "text", text: "go" }]);
	feed({
		sessionUpdate: "tool_call",
		toolCallId: "t1",
		title: "Run",
		kind: "execute",
		status: "in_progress",
	});
	events.push(...next.settle({ stopReason: "cancelled" }));
	const swept = events.find((event) => event.type === "tool_call_update");
	if (swept?.type !== "tool_call_update") throw new Error("no sweep");
	expect(swept.patch.status).toBe("abandoned");
	const settled = events.find((event) => event.type === "turn_settled");
	if (settled?.type !== "turn_settled") throw new Error("no settlement");
	expect(settled.message.marker.stopReason).toBe("cancelled");
	expect(settled.message.marker.startedAt).toBeGreaterThan(0);
});

test("the agent's own version of a prompt reuses the echo's id instead of adding a bubble", () => {
	const { next, events, feed } = harness();
	const opened = next.beginTurn([{ type: "text", text: "/skill:x" }]);
	events.push(...opened.events);
	feed({
		sessionUpdate: "user_message_chunk",
		messageId: "u1",
		content: { type: "text", text: "<skill name=x/>" },
	});
	const starts = events.filter((event) => event.type === "message_start");
	expect(starts).toHaveLength(2);
	for (const start of starts) {
		if (start.type !== "message_start") throw new Error("bad");
		expect(start.message.id).toBe(opened.messageId);
	}
	expect(events.filter((event) => event.type === "chunk")).toHaveLength(1);
});
