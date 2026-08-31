import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { AskUserQuestionResult } from "@thinkrail/contracts";

export interface EngineModel {
	id: string;
	name: string;
	provider: string;
	contextWindow: number;
	reasoning: boolean;
	thinkingLevels: ThinkingLevel[];
}

export type ModelRef = Pick<EngineModel, "provider" | "id">;

export interface RefreshedModels {
	models: EngineModel[];
	complete: boolean;
}

export interface EngineSettlement {
	stopReason: string;
	errorMessage?: string;
}

export interface EngineSessionSummary {
	sessionId: string;
	cwd: string;
	title: string | null;
	model: EngineModel | null;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	messageCount: number;
	updatedAt: number;
	live: boolean;
	lastSettlement?: EngineSettlement | null;
}

export const ASK_USER_ANSWERS_CUSTOM_TYPE = "ask-user-answers";

export interface AskUserAnswersDetails {
	toolCallId: string;
	result: AskUserQuestionResult;
}

export interface AskUserAnswersMessage {
	role: "custom";
	customType: typeof ASK_USER_ANSWERS_CUSTOM_TYPE;
	content: string;
	display: boolean;
	details: AskUserAnswersDetails;
}

export interface AskUserQuestionAckDetails {
	kind: "ack";
}

export function isAskUserAnswersMessage(message: unknown): message is AskUserAnswersMessage {
	if (typeof message !== "object" || message === null) return false;
	const view = message as { role?: unknown; customType?: unknown; details?: unknown };
	if (view.role !== "custom" || view.customType !== ASK_USER_ANSWERS_CUSTOM_TYPE) return false;
	const details = view.details as Partial<AskUserAnswersDetails> | undefined;
	return (
		typeof details?.toolCallId === "string" &&
		!!details.result &&
		Array.isArray(details.result.answers) &&
		typeof details.result.cancelled === "boolean"
	);
}

export type { AgentMessage, Model, ThinkingLevel };
