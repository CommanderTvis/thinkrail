import type { SessionUpdate, StopReason } from "@agentclientprotocol/sdk";
import type { ThinkRailMeta } from "@thinkrail/acp/meta";
import type { EngineEvent } from "../engine";
import { partialResultContent, toolResultContent } from "./content";
import { toolKindOf, toolLocationsOf, toolTitleOf } from "./toolKind";

export interface TranslatedUpdate {
	update: SessionUpdate;
	meta?: ThinkRailMeta;
}

const PI_STOP_REASONS: { readonly [reason: string]: StopReason } = {
	stop: "end_turn",
	toolUse: "end_turn",
	deferred: "end_turn",
	length: "max_tokens",
	aborted: "cancelled",
};

export function toStopReason(reason: string | undefined): StopReason | undefined {
	return reason === undefined ? undefined : PI_STOP_REASONS[reason];
}

function signal(meta: ThinkRailMeta): TranslatedUpdate {
	return { update: { sessionUpdate: "session_info_update" }, meta };
}

/** One open assistant message at a time; ids are this translator's, not pi's — see SPEC. */
export class SessionTranslator {
	private messageSeq = 0;
	private messageId: string | null = null;
	private readonly toolNames = new Map<string, string>();

	constructor(private readonly sessionId: string) {}

	reset(): void {
		this.messageId = null;
		this.toolNames.clear();
	}

	translate(event: EngineEvent): TranslatedUpdate[] {
		switch (event.type) {
			case "message_start":
				return this.onMessageStart(event.message);
			case "message_update":
				return this.onMessageUpdate(event.assistantMessageEvent);
			case "tool_execution_start":
				return this.onToolStart(event.toolCallId, event.toolName, event.args);
			case "tool_execution_update":
				return this.onToolUpdate(event.toolCallId, event.partialResult);
			case "tool_execution_end":
				return this.onToolEnd(event.toolCallId, event.result, event.isError);
			case "session_info_changed":
				return [{ update: { sessionUpdate: "session_info_update", title: event.name ?? null } }];
			case "queue_update":
				return [
					signal({
						queue: { steering: event.steering.length, followUp: event.followUp.length },
					}),
				];
			case "compaction_start":
				return [signal({ compaction: { phase: "start", reason: event.reason } })];
			case "compaction_end":
				return [
					signal({
						compaction: {
							phase: "end",
							reason: event.reason,
							...(event.result?.tokensBefore !== undefined
								? { tokensBefore: event.result.tokensBefore }
								: {}),
							...(event.errorMessage !== undefined ? { error: event.errorMessage } : {}),
						},
					}),
				];
			case "auto_retry_start":
				return [
					signal({
						retry: {
							scope: "turn",
							phase: "scheduled",
							attempt: event.attempt,
							maxAttempts: event.maxAttempts,
							delayMs: event.delayMs,
							error: event.errorMessage,
						},
					}),
				];
			case "auto_retry_end":
				return [
					signal({
						retry: {
							scope: "turn",
							phase: "cleared",
							attempt: event.attempt,
							maxAttempts: event.attempt,
							delayMs: 0,
							...(event.finalError !== undefined ? { error: event.finalError } : {}),
						},
					}),
				];
			case "summarization_retry_scheduled":
				return [
					signal({
						retry: {
							scope: "summarization",
							phase: "scheduled",
							attempt: event.attempt,
							maxAttempts: event.maxAttempts,
							delayMs: event.delayMs,
							error: event.errorMessage,
						},
					}),
				];
			case "summarization_retry_finished":
				return [
					signal({
						retry: {
							scope: "summarization",
							phase: "cleared",
							attempt: 0,
							maxAttempts: 0,
							delayMs: 0,
						},
					}),
				];
			default:
				return [];
		}
	}

	private nextMessageId(): string {
		this.messageSeq += 1;
		return `${this.sessionId}:m${this.messageSeq}`;
	}

	private onMessageStart(message: { role: string; content?: unknown }): TranslatedUpdate[] {
		if (message.role === "assistant") {
			this.messageId = this.nextMessageId();
			return [];
		}
		if (message.role !== "user" && message.role !== "custom") return [];
		const text = userText(message.content);
		if (text.length === 0) return [];
		return [
			{
				update: {
					sessionUpdate: "user_message_chunk",
					messageId: this.nextMessageId(),
					content: { type: "text", text },
				},
			},
		];
	}

	private onMessageUpdate(event: {
		type: string;
		delta?: string;
		toolCall?: { id: string; name: string; arguments?: unknown };
	}): TranslatedUpdate[] {
		this.messageId ??= this.nextMessageId();
		const messageId = this.messageId;
		if (event.type === "text_delta" && event.delta !== undefined) {
			return [
				{
					update: {
						sessionUpdate: "agent_message_chunk",
						messageId,
						content: { type: "text", text: event.delta },
					},
				},
			];
		}
		if (event.type === "thinking_delta" && event.delta !== undefined) {
			return [
				{
					update: {
						sessionUpdate: "agent_thought_chunk",
						messageId,
						content: { type: "text", text: event.delta },
					},
				},
			];
		}
		if (event.type === "toolcall_end" && event.toolCall !== undefined) {
			const { id, name, arguments: args } = event.toolCall;
			this.toolNames.set(id, name);
			return [
				{
					update: {
						sessionUpdate: "tool_call",
						toolCallId: id,
						title: toolTitleOf(name, args),
						name,
						kind: toolKindOf(name),
						status: "pending",
						rawInput: args,
						locations: toolLocationsOf(args),
					},
				},
			];
		}
		return [];
	}

	private onToolStart(toolCallId: string, toolName: string, args: unknown): TranslatedUpdate[] {
		if (this.toolNames.has(toolCallId)) {
			this.toolNames.set(toolCallId, toolName);
			return [{ update: { sessionUpdate: "tool_call_update", toolCallId, status: "in_progress" } }];
		}
		this.toolNames.set(toolCallId, toolName);
		return [
			{
				update: {
					sessionUpdate: "tool_call",
					toolCallId,
					title: toolTitleOf(toolName, args),
					name: toolName,
					kind: toolKindOf(toolName),
					status: "in_progress",
					rawInput: args,
					locations: toolLocationsOf(args),
				},
			},
		];
	}

	private onToolUpdate(toolCallId: string, partialResult: unknown): TranslatedUpdate[] {
		const content = partialResultContent(partialResult);
		if (content.length === 0) return [];
		return [{ update: { sessionUpdate: "tool_call_update", toolCallId, content } }];
	}

	private onToolEnd(toolCallId: string, result: unknown, isError: boolean): TranslatedUpdate[] {
		this.toolNames.delete(toolCallId);
		return [
			{
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId,
					status: isError ? "failed" : "completed",
					content: toolResultContent(result),
					rawOutput: result,
				},
			},
		];
	}
}

function userText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const view = block as { type?: unknown; text?: unknown };
		if (view.type === "text" && typeof view.text === "string") parts.push(view.text);
	}
	return parts.join("");
}
