import { expect, test } from "bun:test";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { EngineEvent } from "../engine";
import { SessionTranslator, toStopReason } from "./updates";

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function partial(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic",
		provider: "anthropic",
		model: "test-model",
		usage,
		stopReason: "stop",
		timestamp: 0,
	};
}

function assistantStart(): EngineEvent {
	return { type: "message_start", message: partial() };
}

function textDelta(delta: string): EngineEvent {
	return {
		type: "message_update",
		message: partial(),
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial: partial() },
	};
}

function thinkingDelta(delta: string): EngineEvent {
	return {
		type: "message_update",
		message: partial(),
		assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta, partial: partial() },
	};
}

test("text chunks of one assistant message share a messageId, a new message mints a new one", () => {
	const translator = new SessionTranslator("s1");
	translator.translate(assistantStart());
	const first = translator.translate(textDelta("he"));
	const second = translator.translate(textDelta("llo"));
	translator.translate(assistantStart());
	const third = translator.translate(textDelta("again"));

	const idOf = (updates: ReturnType<SessionTranslator["translate"]>): string | undefined => {
		const update = updates[0]?.update;
		return update !== undefined && "messageId" in update
			? (update.messageId ?? undefined)
			: undefined;
	};

	expect(idOf(first)).toBe(idOf(second) as string);
	expect(idOf(third)).not.toBe(idOf(first) as string);
});

test("a thinking delta becomes agent_thought_chunk on the same open message", () => {
	const translator = new SessionTranslator("s1");
	translator.translate(assistantStart());
	const [thought] = translator.translate(thinkingDelta("hmm"));
	expect(thought?.update).toMatchObject({
		sessionUpdate: "agent_thought_chunk",
		content: { type: "text", text: "hmm" },
	});
});

test("tool execution start sets the whole call, and end replaces only status/content/output", () => {
	const translator = new SessionTranslator("s1");
	const [started] = translator.translate({
		type: "tool_execution_start",
		toolCallId: "t1",
		toolName: "read",
		args: { path: "/repo/a.ts" },
	});
	expect(started?.update).toMatchObject({
		sessionUpdate: "tool_call",
		toolCallId: "t1",
		name: "read",
		kind: "read",
		status: "in_progress",
		locations: [{ path: "/repo/a.ts" }],
	});

	const [ended] = translator.translate({
		type: "tool_execution_end",
		toolCallId: "t1",
		toolName: "read",
		result: { content: [{ type: "text", text: "ok" }] },
		isError: false,
	});
	expect(ended?.update).toMatchObject({
		sessionUpdate: "tool_call_update",
		toolCallId: "t1",
		status: "completed",
		content: [{ type: "content", content: { type: "text", text: "ok" } }],
	});
});

test("a tool call announced by the model is upgraded rather than re-announced", () => {
	const translator = new SessionTranslator("s1");
	translator.translate(assistantStart());
	const [announced] = translator.translate({
		type: "message_update",
		message: partial(),
		assistantMessageEvent: {
			type: "toolcall_end",
			contentIndex: 0,
			toolCall: { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
			partial: partial(),
		},
	});
	expect(announced?.update).toMatchObject({ sessionUpdate: "tool_call", status: "pending" });

	const [upgraded] = translator.translate({
		type: "tool_execution_start",
		toolCallId: "t1",
		toolName: "bash",
		args: { command: "ls" },
	});
	expect(upgraded?.update).toEqual({
		sessionUpdate: "tool_call_update",
		toolCallId: "t1",
		status: "in_progress",
	});
});

test("queue depth, compaction and retry ride _meta on a no-op session_info_update", () => {
	const translator = new SessionTranslator("s1");
	const [queue] = translator.translate({
		type: "queue_update",
		steering: ["a"],
		followUp: ["b", "c"],
	});
	expect(queue?.update).toEqual({ sessionUpdate: "session_info_update" });
	expect(queue?.meta).toEqual({ queue: { steering: 1, followUp: 2 } });

	const [compaction] = translator.translate({ type: "compaction_start", reason: "threshold" });
	expect(compaction?.meta).toEqual({ compaction: { phase: "start", reason: "threshold" } });

	const [retry] = translator.translate({
		type: "auto_retry_start",
		attempt: 2,
		maxAttempts: 5,
		delayMs: 1_000,
		errorMessage: "overloaded",
	});
	expect(retry?.meta).toEqual({
		retry: {
			scope: "turn",
			phase: "scheduled",
			attempt: 2,
			maxAttempts: 5,
			delayMs: 1_000,
			error: "overloaded",
		},
	});
});

test("pi stop reasons map onto the ACP vocabulary, and an unknown one is undefined", () => {
	expect(toStopReason("stop")).toBe("end_turn");
	expect(toStopReason("length")).toBe("max_tokens");
	expect(toStopReason("aborted")).toBe("cancelled");
	expect(toStopReason("error")).toBeUndefined();
	expect(toStopReason(undefined)).toBeUndefined();
});
