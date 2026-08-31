import { expect, test } from "bun:test";
import type { ChatBlock, ChatMessage } from "@thinkrail/contracts";
import { phaseLabel, streamStatus } from "./StreamIndicator";

function assistant(id: string, blocks: ChatBlock[]): ChatMessage {
	return { role: "assistant", id, timestamp: 0, blocks };
}

function toolCall(
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown> = {},
): ChatBlock {
	return {
		type: "toolCall",
		toolCallId,
		toolName,
		title: toolName,
		kind: "execute",
		status: "running",
		arguments: args,
	};
}

const user: ChatMessage = {
	role: "user",
	id: "u1",
	timestamp: 0,
	content: [{ type: "text", text: "hi" }],
};

test("no in-flight assistant message → working (the post-send gap)", () => {
	expect(streamStatus([user], null)).toEqual({ phase: "working" });
	expect(streamStatus([user], "a1")).toEqual({ phase: "working" });
});

test("an empty (content-less) in-flight message is still just working", () => {
	expect(streamStatus([assistant("a1", [])], "a1")).toEqual({ phase: "working" });
});

test("thinking / writing come from the active message's last block", () => {
	expect(streamStatus([assistant("a1", [{ type: "thinking", text: "hmm" }])], "a1")).toEqual({
		phase: "thinking",
	});
	expect(streamStatus([assistant("a1", [{ type: "text", text: "Here is" }])], "a1")).toEqual({
		phase: "writing",
	});
});

test("blank thinking/text hasn't really started → working (avoids a phantom label)", () => {
	expect(streamStatus([assistant("a1", [{ type: "thinking", text: "  " }])], "a1")).toEqual({
		phase: "working",
	});
	expect(streamStatus([assistant("a1", [{ type: "text", text: "" }])], "a1")).toEqual({
		phase: "working",
	});
});

test("a trailing tool call surfaces the tool name for the loader", () => {
	const message = assistant("a1", [
		{ type: "thinking", text: "let me look" },
		toolCall("t1", "bash", { command: "ls" }),
	]);
	expect(streamStatus([message], "a1")).toEqual({ phase: "running-tool", toolName: "bash" });
});

test("after message_end (no current id) the phase falls back to the round's trailing assistant message", () => {
	const message = assistant("a1", [toolCall("t1", "bash", { command: "ls" })]);
	expect(streamStatus([message], null)).toEqual({ phase: "running-tool", toolName: "bash" });
	expect(streamStatus([message, user], null)).toEqual({ phase: "working" });
});

test("status tracks the message named by currentAssistantId, not merely the last message", () => {
	const messages = [
		assistant("a1", [toolCall("t1", "read")]),
		assistant("a2", [{ type: "text", text: "answering" }]),
	];
	expect(streamStatus(messages, "a2")).toEqual({ phase: "writing" });
});

test("phaseLabel names every phase (and falls back to a generic tool label)", () => {
	expect(phaseLabel({ phase: "working" })).toBe("Working…");
	expect(phaseLabel({ phase: "thinking" })).toBe("Thinking…");
	expect(phaseLabel({ phase: "writing" })).toBe("Writing…");
	expect(phaseLabel({ phase: "running-tool", toolName: "bash" })).toBe("Running bash…");
	expect(phaseLabel({ phase: "running-tool" })).toBe("Running tool…");
});
