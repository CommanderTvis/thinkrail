import { beforeEach, expect, test } from "bun:test";
import type { ChatEvent, ToolCallBlock, ToolCallStatus } from "@thinkrail/contracts";
import { forgetTodoToolCalls, isTodoToolEnd } from "./toolWatch";

beforeEach(forgetTodoToolCalls);

function call(
	toolCallId: string,
	toolName: string,
	status: ToolCallStatus = "running",
): ToolCallBlock {
	return {
		type: "toolCall",
		toolCallId,
		toolName,
		title: toolName,
		kind: "other",
		status,
		arguments: {},
	};
}

function block(b: ToolCallBlock): ChatEvent {
	return { type: "block", messageId: "m1", index: 0, block: b };
}

test("a todo_* tool call that arrives already settled is an end", () => {
	expect(isTodoToolEnd(block(call("t1", "todo_add", "done")))).toBe(true);
});

test("a todo_* tool call is remembered while running and reported when its update settles", () => {
	expect(isTodoToolEnd(block(call("t1", "todo_update")))).toBe(false);
	expect(isTodoToolEnd({ type: "tool_call_update", toolCallId: "t1", patch: {} })).toBe(false);
	expect(
		isTodoToolEnd({ type: "tool_call_update", toolCallId: "t1", patch: { status: "done" } }),
	).toBe(true);
});

test("the settled call is forgotten — a second terminal update never fires twice", () => {
	isTodoToolEnd(block(call("t1", "todo_add")));
	expect(
		isTodoToolEnd({ type: "tool_call_update", toolCallId: "t1", patch: { status: "done" } }),
	).toBe(true);
	expect(
		isTodoToolEnd({ type: "tool_call_update", toolCallId: "t1", patch: { status: "done" } }),
	).toBe(false);
});

test("an update that names a non-todo tool drops the id, even if a block had claimed it", () => {
	isTodoToolEnd(block(call("t1", "todo_add")));
	expect(
		isTodoToolEnd({ type: "tool_call_update", toolCallId: "t1", patch: { toolName: "bash" } }),
	).toBe(false);
	expect(
		isTodoToolEnd({ type: "tool_call_update", toolCallId: "t1", patch: { status: "done" } }),
	).toBe(false);
});

test("an update naming a todo tool is enough on its own — no preceding block required", () => {
	expect(
		isTodoToolEnd({
			type: "tool_call_update",
			toolCallId: "t9",
			patch: { toolName: "todo_remove", status: "done" },
		}),
	).toBe(true);
});

test("a settled error still ends the call — artifacts reconcile against what is on disk", () => {
	isTodoToolEnd(block(call("t1", "todo_add")));
	expect(
		isTodoToolEnd({ type: "tool_call_update", toolCallId: "t1", patch: { status: "error" } }),
	).toBe(true);
});

test("nothing else in the event stream is a todo tool end", () => {
	expect(isTodoToolEnd(block(call("t2", "bash", "done")))).toBe(false);
	expect(isTodoToolEnd({ type: "turn_start" })).toBe(false);
	expect(
		isTodoToolEnd({ type: "chunk", messageId: "m1", index: 0, kind: "text", delta: "todo_add" }),
	).toBe(false);
});
