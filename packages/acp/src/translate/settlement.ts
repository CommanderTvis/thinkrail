import type { StopReason as AcpStopReason, PromptResponse } from "@agentclientprotocol/sdk";
import type { StopReason, TurnSettlement } from "@thinkrail/contracts";
import { asRecord, asString, isVariant } from "./guards";

export const STOP_REASONS: { readonly [K in AcpStopReason]: StopReason } = {
	end_turn: "completed",
	max_tokens: "maxTokens",
	max_turn_requests: "maxRequests",
	refusal: "refused",
	cancelled: "cancelled",
};

export function settlementFromResponse(response: PromptResponse): TurnSettlement {
	const reason = response.stopReason;
	return { stopReason: isVariant(reason, STOP_REASONS) ? STOP_REASONS[reason] : "completed" };
}

export function settlementFromError(error: unknown): TurnSettlement {
	return { stopReason: "failed", error: describeError(error) };
}

export function describeError(error: unknown): string {
	if (typeof error === "string" && error.length > 0) return error;
	const raw = asRecord(error);
	if (raw !== undefined) {
		const message = asString(raw.message);
		const detail = detailText(raw.data);
		if (message !== undefined && message.length > 0) {
			return detail === undefined ? message : `${message}: ${detail}`;
		}
		if (detail !== undefined) return detail;
	}
	if (error instanceof Error && error.message.length > 0) return error.message;
	return "The agent failed to answer.";
}

function detailText(data: unknown): string | undefined {
	if (typeof data === "string" && data.length > 0) return data;
	const raw = asRecord(data);
	if (raw === undefined) return undefined;
	const details = asString(raw.details);
	if (details !== undefined && details.length > 0) return details;
	const message = asString(raw.message);
	return message !== undefined && message.length > 0 ? message : undefined;
}
