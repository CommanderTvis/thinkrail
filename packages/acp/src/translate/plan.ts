import type { PlanEntryPriority, PlanEntryStatus } from "@agentclientprotocol/sdk";
import type {
	AgentPlan,
	AgentPlanEntry,
	AgentPlanEntryPriority,
	AgentPlanEntryStatus,
} from "@thinkrail/contracts";
import { asArray, asFilledString, asRecord, isVariant } from "./guards";

export const PLAN_STATUSES: { readonly [K in PlanEntryStatus]: AgentPlanEntryStatus } = {
	pending: "pending",
	in_progress: "active",
	completed: "done",
};

export const PLAN_PRIORITIES: { readonly [K in PlanEntryPriority]: AgentPlanEntryPriority } = {
	high: "high",
	medium: "medium",
	low: "low",
};

export function toAgentPlan(update: unknown): AgentPlan {
	const raw = asRecord(update);
	const entries: AgentPlanEntry[] = [];
	for (const item of asArray(raw?.entries ?? asRecord(raw?.plan)?.entries)) {
		const entry = asRecord(item);
		if (entry === undefined) continue;
		const text = asFilledString(entry.content);
		if (text === undefined) continue;
		const status = entry.status;
		const priority = entry.priority;
		entries.push({
			text,
			status: isVariant(status, PLAN_STATUSES) ? PLAN_STATUSES[status] : "pending",
			...(isVariant(priority, PLAN_PRIORITIES) ? { priority: PLAN_PRIORITIES[priority] } : {}),
		});
	}
	return { entries };
}
