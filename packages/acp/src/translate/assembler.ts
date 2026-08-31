import type { SessionNotification } from "@agentclientprotocol/sdk";
import type {
	ChatEvent,
	MessageId,
	PromptContent,
	TokenUsage,
	ToolCallId,
	ToolCallStatus,
	TurnSettlement,
} from "@thinkrail/contracts";
import { toPromptContent } from "./content";
import { asRecord, asString, assertNever, isVariant } from "./guards";
import { ancillaryEvents, metaEvents, SESSION_UPDATE_VARIANTS } from "./sessionUpdate";
import { synthesizeToolCall, toToolCallBlock, toToolCallPatch } from "./toolCall";

export interface AssemblerClock {
	now(): number;
	nextId(): MessageId;
}

interface OpenMessage {
	id: MessageId;
	role: "user" | "assistant";
	agentMessageId: string | null;
	blockCount: number;
	trailing: { kind: "text" | "thinking"; index: number } | null;
}

export class SessionAssembler {
	readonly #clock: AssemblerClock;
	#message: OpenMessage | null = null;
	#toolStatus = new Map<ToolCallId, ToolCallStatus>();
	#turnStartedAt: number | null = null;
	#echoMessageId: MessageId | null = null;
	#tokens: TokenUsage | undefined;

	constructor(clock: AssemblerClock) {
		this.#clock = clock;
	}

	get lastPromptMessageId(): MessageId | null {
		return this.#echoMessageId;
	}

	beginTurn(content: PromptContent[]): { messageId: MessageId; events: ChatEvent[] } {
		const events = this.#closeMessage();
		const id = this.#clock.nextId();
		const timestamp = this.#clock.now();
		this.#turnStartedAt = timestamp;
		this.#echoMessageId = id;
		this.#message = null;
		events.push({
			type: "message_start",
			message: { role: "user", id, timestamp, content },
		});
		events.push({ type: "turn_start" });
		return { messageId: id, events };
	}

	apply(notification: SessionNotification): ChatEvent[] {
		const update = notification.update;
		const events: ChatEvent[] = [];

		if (isVariant(update.sessionUpdate, SESSION_UPDATE_VARIANTS)) {
			switch (update.sessionUpdate) {
				case "user_message_chunk":
					events.push(...this.#chunk("user", update.content, agentMessageId(update), "text"));
					break;
				case "agent_message_chunk":
					events.push(...this.#chunk("assistant", update.content, agentMessageId(update), "text"));
					break;
				case "agent_thought_chunk":
					events.push(
						...this.#chunk("assistant", update.content, agentMessageId(update), "thinking"),
					);
					break;
				case "tool_call":
					events.push(...this.#toolCall(toToolCallBlock(update)));
					break;
				case "tool_call_update": {
					if (!this.#toolStatus.has(update.toolCallId)) {
						events.push(...this.#toolCall(synthesizeToolCall(update)));
						break;
					}
					const patch = toToolCallPatch(update);
					if (Object.keys(patch).length === 0) break;
					if (patch.status !== undefined) this.#toolStatus.set(update.toolCallId, patch.status);
					events.push({ type: "tool_call_update", toolCallId: update.toolCallId, patch });
					break;
				}
				case "plan":
				case "plan_update":
				case "plan_removed":
				case "available_commands_update":
				case "current_mode_update":
				case "config_option_update":
				case "session_info_update":
				case "usage_update":
					events.push(...ancillaryEvents(update, this.#tokens));
					break;
				default:
					assertNever(update);
			}
		}

		events.push(...metaEvents(notification));
		return events;
	}

	setTokens(tokens: TokenUsage | undefined): void {
		this.#tokens = tokens;
	}

	settle(settlement: TurnSettlement): ChatEvent[] {
		const events: ChatEvent[] = [];
		for (const [toolCallId, status] of this.#toolStatus) {
			if (status !== "pending" && status !== "running") continue;
			events.push({
				type: "tool_call_update",
				toolCallId,
				patch: { status: "abandoned", error: "The turn ended before this tool call finished." },
			});
		}
		events.push(...this.#closeMessage());
		const startedAt = this.#turnStartedAt;
		events.push({
			type: "turn_settled",
			message: {
				role: "marker",
				id: this.#clock.nextId(),
				timestamp: this.#clock.now(),
				marker: {
					kind: "turnSettled",
					...settlement,
					...(startedAt !== null ? { startedAt } : {}),
				},
			},
		});

		this.#toolStatus.clear();
		this.#turnStartedAt = null;
		this.#echoMessageId = null;
		return events;
	}

	reset(): void {
		this.#message = null;
		this.#toolStatus.clear();
		this.#turnStartedAt = null;
		this.#echoMessageId = null;
		this.#tokens = undefined;
	}

	#closeMessage(): ChatEvent[] {
		const open = this.#message;
		if (open === null) return [];
		this.#message = null;
		if (open.role !== "assistant") return [];
		return [{ type: "message_end", messageId: open.id, endedAt: this.#clock.now() }];
	}

	#openMessage(role: "user" | "assistant", agentId: string | null): ChatEvent[] {
		const events = this.#closeMessage();
		const reuse = role === "user" ? this.#echoMessageId : null;
		const id = reuse ?? this.#clock.nextId();
		if (reuse !== null) this.#echoMessageId = null;
		const timestamp = this.#clock.now();
		this.#message = { id, role, agentMessageId: agentId, blockCount: 0, trailing: null };
		events.push({
			type: "message_start",
			message:
				role === "user"
					? { role: "user", id, timestamp, content: [] }
					: { role: "assistant", id, timestamp, blocks: [] },
		});
		return events;
	}

	#continues(role: "user" | "assistant", agentId: string | null): boolean {
		const open = this.#message;
		if (open === null || open.role !== role) return false;
		if (agentId === null || open.agentMessageId === null) return true;
		return open.agentMessageId === agentId;
	}

	#chunk(
		role: "user" | "assistant",
		content: unknown,
		agentId: string | null,
		kind: "text" | "thinking",
	): ChatEvent[] {
		const events = this.#continues(role, agentId) ? [] : this.#openMessage(role, agentId);
		const open = this.#message;
		if (open === null) return events;
		const part = toPromptContent(content);
		if (part === undefined) return events;

		if (part.type !== "text") {
			const index = open.blockCount;
			open.blockCount += 1;
			open.trailing = null;
			events.push({ type: "block", messageId: open.id, index, block: part });
			return events;
		}
		if (part.text.length === 0) return events;

		if (open.trailing === null || open.trailing.kind !== kind) {
			open.trailing = { kind, index: open.blockCount };
			open.blockCount += 1;
		}
		events.push({
			type: "chunk",
			messageId: open.id,
			index: open.trailing.index,
			kind,
			delta: part.text,
		});
		return events;
	}

	#toolCall(call: ReturnType<typeof toToolCallBlock>): ChatEvent[] {
		if (this.#toolStatus.has(call.toolCallId)) {
			this.#toolStatus.set(call.toolCallId, call.status);
			const { type: _type, toolCallId, ...patch } = call;
			return [{ type: "tool_call_update", toolCallId, patch }];
		}
		const events = this.#continues("assistant", null) ? [] : this.#openMessage("assistant", null);
		const open = this.#message;
		if (open === null) return events;
		const index = open.blockCount;
		open.blockCount += 1;
		open.trailing = null;
		this.#toolStatus.set(call.toolCallId, call.status);
		events.push({ type: "block", messageId: open.id, index, block: call });
		return events;
	}
}

function agentMessageId(update: unknown): string | null {
	return asString(asRecord(update)?.messageId) ?? null;
}
