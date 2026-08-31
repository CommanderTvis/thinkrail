import type { AgentDescriptor } from "@thinkrail/contracts";

export type BuildKind = "source" | "binary" | "desktop";

export type AuthMethodKind = "agent" | "env-var" | "terminal" | "central";

export type SendMode = "prompt" | "steer" | "follow_up";

export type AnalyticsEvent =
	| { name: "app_installed" }
	| { name: "app_started" }
	| { name: "chat_started"; params: { agent: string } }
	| { name: "message_sent"; params: { mode: SendMode } }
	| { name: "provider_login"; params: { agent: string; method: AuthMethodKind } };

export const CUSTOM_BUCKET = "custom";

export function bucketAgent(agent: Pick<AgentDescriptor, "id" | "origin">): string {
	return agent.origin === "external" ? CUSTOM_BUCKET : agent.id;
}
