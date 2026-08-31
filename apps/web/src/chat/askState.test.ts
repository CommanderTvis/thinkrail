import { expect, test } from "bun:test";
import type { AskUserQuestionResult, ChatMessage } from "@thinkrail/contracts";
import { deriveAskStates } from "./askState";

const askMessage = (id: string, toolCallId: string): ChatMessage => ({
	role: "assistant",
	id,
	timestamp: 0,
	blocks: [
		{
			type: "toolCall",
			toolCallId,
			toolName: "ask_user_question",
			title: "Ask a question",
			kind: "other",
			status: "pending",
			arguments: {},
		},
	],
});

const userMessage = (id: string): ChatMessage => ({
	role: "user",
	id,
	timestamp: 0,
	content: [{ type: "text", text: "hi" }],
});

const answerMarker = (
	id: string,
	toolCallId: string,
	result: AskUserQuestionResult,
): ChatMessage => ({
	role: "marker",
	id,
	timestamp: 0,
	marker: { kind: "questionAnswers", toolCallId, result },
});

const reply: AskUserQuestionResult = { answers: [], cancelled: false };

test("an ask call with neither reply nor later user message is awaiting", () => {
	const states = deriveAskStates([userMessage("u1"), askMessage("a1", "tc1")]);
	expect(states.tc1).toEqual({ superseded: false });
});

test("a questionAnswers marker marks the call answered (never superseded, even with a later user message)", () => {
	const states = deriveAskStates([
		askMessage("a1", "tc1"),
		answerMarker("m1", "tc1", reply),
		userMessage("u2"),
	]);
	expect(states.tc1).toEqual({ answer: reply, superseded: false });
});

test("a user message AFTER an unanswered call supersedes it; one before does not", () => {
	const states = deriveAskStates([
		userMessage("u1"),
		askMessage("a1", "tc1"),
		userMessage("u2"),
		askMessage("a2", "tc2"),
	]);
	expect(states.tc1).toEqual({ superseded: true });
	expect(states.tc2).toEqual({ superseded: false });
});

test("non-ask tool calls derive no state", () => {
	const messages: ChatMessage[] = [
		{
			role: "assistant",
			id: "a1",
			timestamp: 0,
			blocks: [
				{
					type: "toolCall",
					toolCallId: "b1",
					toolName: "bash",
					title: "Run a command",
					kind: "execute",
					status: "pending",
					arguments: {},
				},
			],
		},
	];
	expect(Object.keys(deriveAskStates(messages))).toHaveLength(0);
});
