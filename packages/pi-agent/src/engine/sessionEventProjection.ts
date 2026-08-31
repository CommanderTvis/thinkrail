import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { EngineSettlement } from "./types";

export type EngineEvent =
	| Exclude<AgentSessionEvent, { type: "agent_settled" } | { type: "compaction_end" }>
	| { type: "agent_settled"; terminal: EngineSettlement | null }
	| {
			type: "compaction_end";
			reason: "manual" | "threshold" | "overflow";
			result: { tokensBefore: number; estimatedTokensAfter?: number } | undefined;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  };

export function projectSessionEvent(
	event: AgentSessionEvent,
	terminal: EngineSettlement | null,
): EngineEvent {
	if (event.type === "agent_settled") return { type: "agent_settled", terminal };
	if (event.type === "compaction_end") {
		return {
			type: "compaction_end",
			reason: event.reason,
			result: event.result
				? {
						tokensBefore: event.result.tokensBefore,
						...(event.result.estimatedTokensAfter !== undefined
							? { estimatedTokensAfter: event.result.estimatedTokensAfter }
							: {}),
					}
				: undefined,
			aborted: event.aborted,
			willRetry: event.willRetry,
			...(event.errorMessage !== undefined ? { errorMessage: event.errorMessage } : {}),
		};
	}
	return event as EngineEvent;
}
