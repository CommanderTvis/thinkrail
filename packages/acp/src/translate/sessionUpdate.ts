import type { SessionNotification, SessionUpdate } from "@agentclientprotocol/sdk";
import type { ChatEvent, TokenUsage } from "@thinkrail/contracts";
import { readThinkRailMeta } from "../meta";
import { toSlashCommands } from "./commands";
import { toConfigOptions } from "./configOptions";
import type { DeclaredVariants } from "./guards";
import { asEpochMs, asString, unhandledVariant } from "./guards";
import { toAgentPlan } from "./plan";
import { usageFromUpdate } from "./usage";

export const SESSION_UPDATE_VARIANTS: DeclaredVariants<SessionUpdate["sessionUpdate"]> = {
	user_message_chunk: true,
	agent_message_chunk: true,
	agent_thought_chunk: true,
	tool_call: true,
	tool_call_update: true,
	plan: true,
	plan_update: true,
	plan_removed: true,
	available_commands_update: true,
	current_mode_update: true,
	config_option_update: true,
	session_info_update: true,
	usage_update: true,
};

export function ancillaryEvents(update: SessionUpdate, tokens?: TokenUsage): ChatEvent[] {
	switch (update.sessionUpdate) {
		case "user_message_chunk":
		case "agent_message_chunk":
		case "agent_thought_chunk":
		case "tool_call":
		case "tool_call_update":
			return [];
		case "plan":
		case "plan_update":
			return [{ type: "plan", plan: toAgentPlan(update) }];
		case "plan_removed":
			return [{ type: "plan", plan: null }];
		case "available_commands_update":
			return [{ type: "commands", commands: toSlashCommands(update.availableCommands) }];
		case "config_option_update":
			return [{ type: "config_options", options: toConfigOptions(update.configOptions) }];
		case "current_mode_update":
			return [];
		case "session_info_update": {
			const title = asString(update.title);
			const updatedAt = asEpochMs(update.updatedAt);
			if (title === undefined && updatedAt === undefined) return [];
			return [
				{
					type: "session_info",
					...(title !== undefined ? { title } : {}),
					...(updatedAt !== undefined ? { updatedAt } : {}),
				},
			];
		}
		case "usage_update":
			return [{ type: "usage", usage: usageFromUpdate(update, tokens) }];
		default:
			return unhandledVariant(update, []);
	}
}

export function metaEvents(notification: SessionNotification): ChatEvent[] {
	const meta = readThinkRailMeta(notification._meta);
	if (meta === undefined) return [];
	const events: ChatEvent[] = [];
	if (meta.retry !== undefined) {
		const retry = meta.retry;
		events.push(
			retry.phase === "cleared"
				? { type: "retry_cleared", scope: retry.scope }
				: {
						type: "retry_scheduled",
						scope: retry.scope,
						attempt: retry.attempt,
						maxAttempts: retry.maxAttempts,
						delayMs: retry.delayMs,
						...(retry.error !== undefined ? { error: retry.error } : {}),
					},
		);
	}
	if (meta.compaction !== undefined) {
		const compaction = meta.compaction;
		events.push(
			compaction.phase === "start"
				? { type: "compaction_start", reason: compaction.reason }
				: {
						type: "compaction_end",
						reason: compaction.reason,
						...(compaction.error !== undefined ? { error: compaction.error } : {}),
					},
		);
		if (compaction.phase === "end" && compaction.supersededMessageId !== undefined) {
			events.push({ type: "message_superseded", messageId: compaction.supersededMessageId });
		}
	}
	if (meta.queue !== undefined) {
		events.push({
			type: "queue_changed",
			steering: meta.queue.steering,
			followUp: meta.queue.followUp,
		});
	}
	return events;
}
