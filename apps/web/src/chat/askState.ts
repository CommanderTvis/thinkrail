import type { AskUserQuestionResult, ChatMessage } from "@thinkrail/contracts";
import { createContext, useContext } from "react";

const ASK_USER_QUESTION_TOOL = "ask_user_question";

export interface AskState {
	answer?: AskUserQuestionResult;
	superseded: boolean;
}

export function deriveAskStates(messages: ChatMessage[]): Record<string, AskState> {
	const callMessageIndex: Record<string, number> = {};
	const answers: Record<string, AskUserQuestionResult> = {};
	let lastUserIndex = -1;
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (!message) continue;
		if (message.role === "user") {
			lastUserIndex = i;
		} else if (message.role === "assistant") {
			for (const block of message.blocks) {
				if (block.type === "toolCall" && block.toolName === ASK_USER_QUESTION_TOOL) {
					callMessageIndex[block.toolCallId] = i;
				}
			}
		} else if (message.marker.kind === "questionAnswers") {
			answers[message.marker.toolCallId] = message.marker.result;
		}
	}
	const states: Record<string, AskState> = {};
	for (const [toolCallId, messageIndex] of Object.entries(callMessageIndex)) {
		const answer = answers[toolCallId];
		states[toolCallId] = {
			...(answer ? { answer } : {}),
			superseded: !answer && lastUserIndex > messageIndex,
		};
	}
	return states;
}

export interface AskContextValue {
	states: Record<string, AskState>;
	focusScope: object;
}

export const AskStatesContext = createContext<AskContextValue | null>(null);

export function useAskState(toolCallId: string): AskState | undefined {
	return useContext(AskStatesContext)?.states[toolCallId];
}

export function useAskFocusScope(): object | null {
	return useContext(AskStatesContext)?.focusScope ?? null;
}
